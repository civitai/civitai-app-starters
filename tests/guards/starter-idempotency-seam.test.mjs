/**
 * Seam guard for the Generate idempotency key in every standalone starter:
 * each generate route must check the key with `readIdempotencyKey` (400 on a
 * bad one) and pass it to `submitGeneration`, which must put it on the REAL
 * submit as `externalId` with `withExternalId`, and the estimate path must
 * never carry it. `tests/idempotency.test.mjs` tests those two functions
 * behaviourally (one byte-identical module and test per starter:
 * `starter-shared-modules-parity.test.mjs`); without this, those tests could
 * stay green over functions no route calls.
 *
 * 🔴 STRUCTURAL, NOT BEHAVIOURAL. It reads source text, so it proves the calls
 * exist, not that a request is answered correctly. What the four forms SEND
 * (the key on the submit, the same key on a retry, a new key after an edit,
 * a finished workflow or Reset, no key on the estimate) is checked
 * behaviourally by each starter's `tests/GenerateForm.test.ts`.
 *
 * It lives HERE, not in a starter's own `tests/`, because a starter is copied
 * out verbatim by `npx tiged`: a source-text match shipped there would go red
 * on a developer's first legitimate edit of their own copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STARTERS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'starters');
const read = (starter, rel) => readFileSync(resolve(STARTERS, starter, rel), 'utf8');

/** The body of the exported function `name` in `src`: from its signature to the next top-level `}`. */
export function functionBody(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `no export function ${name}`);
  const end = src.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `no end of ${name}`);
  return src.slice(start, end + 2);
}

const STARTER_FILES = {
  'next-app': {
    civitai: 'src/lib/civitai.ts',
    submitRoute: 'src/app/api/generate/route.ts',
    estimateRoute: 'src/app/api/generate/estimate/route.ts',
    form: 'src/components/GenerateForm.tsx',
    kind: 'react',
  },
  'sveltekit-app': {
    civitai: 'src/lib/civitai.ts',
    submitRoute: 'src/routes/api/generate/+server.ts',
    estimateRoute: 'src/routes/api/generate/estimate/+server.ts',
    form: 'src/lib/components/GenerateForm.svelte',
    kind: 'svelte',
  },
  'react-pwa': {
    civitai: 'server/civitai.ts',
    submitRoute: 'server/app.ts',
    estimateRoute: null,
    form: 'src/components/GenerateForm.tsx',
    kind: 'react',
  },
  'svelte-pwa': {
    civitai: 'server/civitai.ts',
    submitRoute: 'server/app.ts',
    estimateRoute: null,
    form: 'src/components/GenerateForm.svelte',
    kind: 'svelte',
  },
};

/** The `app.post('<path>', …)` handler in a Hono BFF, up to the next route. */
function honoRoute(src, path) {
  const start = src.indexOf(`app.post('${path}',`);
  assert.notEqual(start, -1, `no route ${path}`);
  const end = src.indexOf('\n});\n', start);
  return src.slice(start, end + 5);
}

for (const [starter, f] of Object.entries(STARTER_FILES)) {
  test(`${starter}: only the real submit puts the key on the workflow as externalId`, () => {
    const src = read(starter, f.civitai);
    assert.equal(src.match(/withExternalId\(/g)?.length, 1, 'withExternalId is called exactly once');
    assert.match(functionBody(src, 'submitGeneration'), /withExternalId\(\s*buildTextToImageBody\([\s\S]*?\),\s*idempotencyKey,?\s*\)/);
    assert.doesNotMatch(functionBody(src, 'estimateGenerationCost'), /withExternalId|externalId|idempotencyKey/);
  });

  test(`${starter}: the generate route refuses a bad key and passes a good one on`, () => {
    const src = read(starter, f.submitRoute);
    const submit = f.estimateRoute ? src : honoRoute(src, '/api/generate');
    assert.match(submit, /const key = readIdempotencyKey\((body|parsed\.input)\);/);
    assert.match(submit, /if \(!key\.ok\) return [\s\S]{0,40}\{ error: key\.error \},\s*(\{ status: 400 \}|400)\);/);
    assert.match(submit, /submitGeneration\([^)]*, key\.key\)/);
    const estimate = f.estimateRoute ? read(starter, f.estimateRoute) : honoRoute(src, '/api/generate/estimate');
    assert.doesNotMatch(estimate, /idempotencyKey|IdempotencyKey|externalId/);
  });

  test(`${starter}: GenerateForm keeps one attempt key and sends it on the submit only`, () => {
    const src = read(starter, f.form);
    assert.match(src, /import \{ attemptFor, type Attempt \} from '[^']*attempt-key';/);
    assert.equal(src.match(/idempotencyKey: next\.key/g)?.length, 1, 'the key is sent from one place');
    // The estimate prices the prompt alone.
    assert.match(src, /\{ prompt: ticket\.prompt \}/);
    // Dropped on a finished workflow, on Reset and on an edit: three clears.
    const clears = kindClears(f.kind, src);
    assert.equal(clears, 3, 'the attempt is cleared in exactly three places');
  });
}

function kindClears(kind, src) {
  return (kind === 'react' ? src.match(/attemptRef\.current = null;/g) : src.match(/attempt = null/g))?.length ?? 0;
}

// --- negative control: the body extractor can go red -----------------------

test('control: an estimate function that sets externalId is caught', () => {
  const src = read('react-pwa', 'server/civitai.ts').replace(
    /(export function estimateGenerationCost\([\s\S]*?return estimateWorkflow\(\s*getClient\(session\),\s*)/,
    '$1withExternalId(',
  );
  assert.notEqual(src, read('react-pwa', 'server/civitai.ts'), 'the control edit must change the text');
  assert.match(functionBody(src, 'estimateGenerationCost'), /withExternalId/);
});
