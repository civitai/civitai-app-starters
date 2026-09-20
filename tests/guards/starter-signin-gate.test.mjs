/**
 * Guards the SIGN-IN SEAM between the starter dev harnesses and the block code
 * they run — the one place where "each half is fine on its own" was exactly
 * what hid the defect.
 *
 * Two rules, and they are a PAIR. Either one alone is satisfiable while the
 * combination is broken:
 *
 *   A. Every starter dev harness that hand-builds a `BlockInitPayload` must
 *      construct its `viewer` with the SAME KEY SET the production host sends —
 *      and that key set is READ OUT OF `createMockHost`'s `DEFAULT_VIEWER`, not
 *      retyped here. This guard pins a RELATIONSHIP (harness ≡ mock host), so
 *      moving one side without the other is what goes red.
 *   B. The two reference block apps (`civitai-block-starter`, `hello-world`)
 *      must gate sign-in on `viewer?.signedIn === true` — the gate the SDK
 *      documents and the host supports.
 *
 * WHY THIS EXISTS
 * ===============
 * At 66f9e09 the seven starter harnesses each posted
 *
 *     viewer: { id: 2, username: 'dev-viewer', status: 'active' }
 *
 * which is wrong in BOTH directions at once against what civitai/civitai `main`
 * actually puts on the wire (`withSignedInFlag` in
 * `src/components/AppBlocks/projectBlockInit.ts`, key set pinned as exactly
 * `['id', 'signedIn', 'username']` by that repo's own contract test):
 *
 *   - `status` is sent that production NEVER sends. The platform withholds the
 *     viewer's ban/mute moderation state from third-party iframes (civitai
 *     #2521). A block that read `viewer.status` would work in every local run
 *     and get `undefined` in production.
 *   - `signedIn` is MISSING that production always sends. This is the half that
 *     made rule B unshippable: switching a starter to the documented
 *     `viewer?.signedIn === true` gate would have rendered "anonymous" in its
 *     own `dev:harness` — a correct block failing against its own dev loop.
 *
 * Nothing caught it because the harness and the block app were each internally
 * consistent. The `createMockHost` path (`test/blockInitV2.test.ts`) had a
 * fence on its DEFAULT viewer the whole time; these harnesses do not go through
 * `createMockHost` at all — they build the payload themselves — so that fence
 * could not see them. That gap is the thing this file closes.
 *
 * 🔴 KNOWN LIMITS:
 *   - It reads SOURCE TEXT; the starters ship no test runner (adding one to a
 *     `tiged`-able template would cost every consumer). So it can see the key
 *     set a harness writes and the gate expression an app writes, but it does
 *     not RENDER either. The behavioural rendering of `signedIn` through
 *     `useBlockContext` is covered by `blockInitV2.test.ts` in blocks-react.
 *   - Rule B is checked as an expression, not semantically: a gate written some
 *     third way (`Boolean(viewer?.signedIn)`) would fail this guard even though
 *     it is correct. That is deliberate — the reference starters are COPIED,
 *     so one canonical spelling is the product, and a false failure here is a
 *     one-line fix with a loud message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The in-repo source of truth for the viewer the real host sends. Rule A
 * compares every harness against THIS rather than against a literal typed into
 * this test, so the mock host and the harnesses cannot drift apart silently.
 *
 * `DEFAULT_VIEWER`'s own correctness (that it matches civitai/civitai) is
 * pinned by `packages/civitai-blocks-react/test/blockInitV2.test.ts`.
 */
const MOCK_HOST = 'packages/civitai-blocks-react/src/internal/mockHost.ts';
const DEFAULT_VIEWER_DECL = /const\s+DEFAULT_VIEWER\s*:\s*ViewerInfo\s*=\s*\{([^}]*)\}/;

/** The two reference block apps a new author copies from. */
const REFERENCE_APPS = [
  'starters/civitai-block-starter/src/App.tsx',
  'starters/examples/hello-world/src/App.tsx',
];

/** The canonical sign-in gate. One spelling, because these files get copied. */
const CANONICAL_GATE = 'viewer?.signedIn === true';

/** A `viewer: { … }` literal inside a hand-built `BlockInitPayload`. */
const HARNESS_VIEWER_LITERAL = /viewer:\s*\{([^}]*)\}/;

/**
 * Pull the KEY SET out of a `{ a: 1, b: 'x' }` object-literal body.
 *
 * Deliberately keys-only: rule A is about which FIELDS cross the wire, and the
 * values legitimately differ (the mock host's viewer is id 2 / `dev-viewer`,
 * a harness may pick anything). Exported so the controls below can drive it.
 */
export function keysOfObjectLiteralBody(body) {
  // 🔴 STRIP COMMENTS FIRST, BEFORE splitting on `,`. A first draft filtered
  // comment-looking PARTS after the split, and a `// …` line sitting directly
  // above a property put both into the SAME comma-delimited chunk — so the
  // filter silently swallowed the property too, and the extractor reported a
  // key set missing `id`. Caught by the positive control below, which is why
  // that control feeds a commented literal rather than a clean one.
  const uncommented = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return uncommented
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(':')[0].trim().replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean)
    .sort();
}

/** Every `src/**` file named `Harness.tsx` under `starters/`. */
function harnessFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
          continue;
        }
        walk(full);
      } else if (entry.isFile() && entry.name === 'Harness.tsx') {
        out.push(full);
      }
    }
  };
  walk(join(REPO_ROOT, 'starters'));
  return out.sort();
}

function productionViewerKeys() {
  const src = readFileSync(join(REPO_ROOT, MOCK_HOST), 'utf8');
  const match = src.match(DEFAULT_VIEWER_DECL);
  assert.ok(
    match,
    `could not find \`const DEFAULT_VIEWER: ViewerInfo = { … }\` in ${MOCK_HOST} — ` +
      `this guard reads the canonical key set from there and is now wired to nothing`,
  );
  return keysOfObjectLiteralBody(match[1]);
}

test('POSITIVE CONTROL — the key-set extractor sees a wrong key set as wrong', () => {
  // The exact literal all seven harnesses carried at 66f9e09. If this ever
  // compares EQUAL to the production key set, the extractor is broken and every
  // "match" below is meaningless.
  const stale = keysOfObjectLiteralBody(" id: 2, username: 'dev-viewer', status: 'active' ");
  assert.deepEqual(stale, ['id', 'status', 'username']);
  assert.notDeepEqual(
    stale,
    productionViewerKeys(),
    'the stale harness viewer compares EQUAL to the production key set — the extractor is inert',
  );

  // And it must see the CORRECT one as correct, through a comment block, which
  // is how the fixed harnesses are actually written.
  const fixed = keysOfObjectLiteralBody(
    "\n      // a leading comment line\n      id: 2, username: 'dev-viewer', signedIn: true,\n    ",
  );
  assert.deepEqual(fixed, ['id', 'signedIn', 'username']);
});

test('COVERAGE FLOOR — every starter dev harness is found', () => {
  const found = harnessFiles().map((f) => relative(REPO_ROOT, f));
  // Seven at 66f9e09. A GROWING set is fine (a new starter is covered
  // automatically); a SHRINKING one means the walk stopped seeing them.
  assert.ok(
    found.length >= 7,
    `expected at least 7 starter harnesses, found ${found.length}:\n  ${found.join('\n  ')}`,
  );
  for (const required of [
    'starters/civitai-block-starter/src/dev/Harness.tsx',
    'starters/examples/hello-world/src/Harness.tsx',
  ]) {
    assert.ok(found.includes(required), `walk did not reach ${required}`);
  }
});

test('RULE A — every harness viewer has the key set the production host sends', () => {
  const expected = productionViewerKeys();
  assert.deepEqual(
    expected,
    ['id', 'signedIn', 'username'],
    `${MOCK_HOST}'s DEFAULT_VIEWER no longer matches the host contract pinned by ` +
      `civitai/civitai's __tests__/projectBlockInit.test.ts (['id','signedIn','username']). ` +
      `Fix the mock host first — every harness is compared against it.`,
  );

  const mismatches = [];
  for (const file of harnessFiles()) {
    const src = readFileSync(file, 'utf8');
    const match = src.match(HARNESS_VIEWER_LITERAL);
    if (!match) continue; // a harness that does not build a viewer is not in scope
    const keys = keysOfObjectLiteralBody(match[1]);
    if (keys.join(',') === expected.join(',')) continue;
    mismatches.push(`${relative(REPO_ROOT, file)} — has [${keys}], host sends [${expected}]`);
  }
  assert.deepEqual(
    mismatches,
    [],
    `A starter dev harness sends a viewer production does not.\n` +
      `A harness that omits \`signedIn\` breaks every block using the documented\n` +
      `\`viewer?.signedIn === true\` gate; one that adds \`status\` lets a block read a\n` +
      `field the platform withholds from third-party iframes (civitai #2521).\n\n` +
      `    ${mismatches.join('\n    ')}\n`,
  );
});

test('RULE B — the reference block apps gate sign-in on `viewer?.signedIn === true`', () => {
  const offenders = [];
  for (const rel of REFERENCE_APPS) {
    const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
    if (!src.includes(CANONICAL_GATE)) {
      offenders.push(`${rel} — no \`${CANONICAL_GATE}\` gate found`);
      continue;
    }
    // A leftover truthiness gate in the RENDERED output, which is what the two
    // starters actually had: `{viewer ? 'signed in' : 'anonymous'}`.
    const truthinessGate = /\{\s*viewer\s*\?\s*['"]/.exec(src);
    if (truthinessGate) {
      offenders.push(`${rel} — still renders a bare truthiness gate: ${truthinessGate[0].trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `A reference starter does not demonstrate the documented sign-in gate.\n` +
      `These two files are what a new block author copies, so the gate they show is\n` +
      `the gate the ecosystem writes.\n\n` +
      `    ${offenders.join('\n    ')}\n`,
  );
});
