/**
 * Guards the COPY of `hostToRunUrl` in `starters/civitai-block-starter/src/directLoad.ts`
 * against the original in `packages/civitai-blocks-react/src/transport/directLoad.ts`.
 *
 * WHY A COPY EXISTS: the starter is framework-free, and the only export of this
 * function lives in `@civitai/blocks-react`, which requires React. Exporting it
 * from a framework-agnostic package needs a release before a `tiged` copy of
 * the starter could import it, so the starter carries its own copy for now.
 * The copy decides which URL a directly-opened block offers as "Open on
 * Civitai", so a drift is a wrong (or missing) link, silently.
 *
 * WHAT THIS CHECKS: both implementations, run over one input table that covers
 * each rule of the function (suffix match on a dot boundary, first-label slug,
 * DNS-label charset, case folding, trailing-dot trimming, whitespace trimming,
 * empty/absent input), must return identical results. Two literal rows are
 * pinned too, so a change that breaks BOTH copies the same way is still caught.
 *
 * WHERE THIS RUNS: `pnpm test:guards`, before `pnpm install` in CI's Starter
 * job — so it imports the two TypeScript SOURCES directly (Node >= 22.18 strips
 * types natively; CI runs Node 24). Both files import nothing, which is what
 * makes that possible: if either gains an import this guard will fail to load,
 * loudly, rather than pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STARTER_COPY = join(REPO_ROOT, 'starters/civitai-block-starter/src/directLoad.ts');
const ORIGINAL = join(REPO_ROOT, 'packages/civitai-blocks-react/src/transport/directLoad.ts');

const INPUTS = [
  'my-app.civit.ai',
  'model-benchmarking.civit.ai',
  'a1.civit.ai',
  'My-App.Civit.AI',
  'my-app.civit.ai.',
  'my-app.civit.ai...',
  '  my-app.civit.ai  ',
  'deep.sub.civit.ai',
  'civit.ai',
  '.civit.ai',
  'evilcivit.ai',
  'civit.ai.evil.example',
  'bad_label.civit.ai',
  'ünï.civit.ai',
  'localhost',
  '127.0.0.1',
  'civitai.com',
  '',
  null,
  undefined,
];

const load = async (path) => (await import(pathToFileURL(path).href)).hostToRunUrl;

test('starter hostToRunUrl matches @civitai/blocks-react on every input', async () => {
  const [copy, original] = await Promise.all([load(STARTER_COPY), load(ORIGINAL)]);
  assert.equal(typeof copy, 'function', 'starter directLoad.ts must export hostToRunUrl');
  assert.equal(typeof original, 'function', 'blocks-react directLoad.ts must export hostToRunUrl');

  const diffs = [];
  for (const input of INPUTS) {
    const a = copy(input);
    const b = original(input);
    if (a !== b) diffs.push(`${JSON.stringify(input)}: starter=${JSON.stringify(a)} blocks-react=${JSON.stringify(b)}`);
  }
  assert.deepEqual(diffs, [], `starter copy of hostToRunUrl drifted:\n  ${diffs.join('\n  ')}`);

  // The table must exercise BOTH outcomes, or parity over it proves nothing
  // about one of them.
  const outcomes = INPUTS.map((i) => original(i));
  assert.ok(outcomes.some((o) => o === null), 'table has no null-producing input');
  assert.ok(outcomes.filter((o) => o !== null).length >= 3, 'table has too few URL-producing inputs');
});

test('literal pins, so a shared regression in both copies is still caught', async () => {
  const copy = await load(STARTER_COPY);
  assert.equal(copy('My-App.civit.ai.'), 'https://civitai.com/apps/run/my-app');
  assert.equal(copy('localhost'), null);
});
