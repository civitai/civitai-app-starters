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
 *   B. No starter block app open-codes the sign-in gate. Every starter source
 *      that reads `viewer` off `useBlockContext()` must import `isSignedIn`
 *      from `@civitai/app-sdk/blocks` and answer through it.
 *
 * WHY A IS HERE
 * =============
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
 *   - `signedIn` is MISSING that production always sends — so a block written
 *     to the documented gate rendered "anonymous" in its own `dev:harness`.
 *
 * Nothing caught it because the harness and the block app were each internally
 * consistent. The `createMockHost` path (`test/blockInitV2.test.ts`) had a
 * fence on its DEFAULT viewer the whole time; these harnesses do not go through
 * `createMockHost` at all — they build the payload themselves — so that fence
 * could not see them. That gap is the thing rule A closes.
 *
 * WHY B IS SHAPED THE WAY IT IS
 * =============================
 * 🔴 AN EARLIER RULE B WAS WALKABLE, AND WAS WALKED. It asserted
 * `src.includes('viewer?.signedIn === true')` plus a probe for one leftover
 * spelling, `/\{\s*viewer\s*\?\s*['"]/`. Both reference apps MENTION the gate
 * in their own JSDoc, so `includes` was satisfied by PROSE — reverting both
 * RENDERED gates to `{viewer !== null ? 'signed in'` while leaving the doc
 * comments untouched left the rule GREEN. Its docstring said it "pins the
 * reference apps' gate expression"; its body could not tell the gate from a
 * mention of it. The mutation battery that certified it built only the one
 * shape the probe could see.
 *
 * Two changes follow from that, and they are the reason this rule is now worth
 * having at all:
 *
 *   1. IT READS CODE, NOT PROSE. {@link stripComments} removes every comment
 *      before anything is matched, so no sentence in a doc block can satisfy or
 *      evade a rule. The controls below feed it a file whose ONLY gate is in a
 *      comment and require that to be reported as a violation.
 *   2. IT PINS A CALL, NOT A SPELLING. The gate itself now lives in the SDK
 *      (`isSignedIn`), so this rule no longer has an opinion about `viewer !==
 *      null` versus `viewer?.signedIn === true` — the SDK adjudicates that, in
 *      one function, with its own unit tests. What is left is a structural
 *      claim: a `tiged`-copied template must not carry its own copy of that
 *      decision. Both of the old spellings are therefore violations HERE even
 *      though one of them is what `isSignedIn` does internally.
 *
 * 🔴 KNOWN LIMITS:
 *   - It reads SOURCE TEXT; the starters ship no test runner (adding one to a
 *     `tiged`-able template would cost every consumer). So it can see the key
 *     set a harness writes and the call an app makes, but it does not RENDER
 *     either. `isSignedIn`'s behaviour is covered by
 *     `packages/civitai-app-sdk/test/blocks/viewer-signed-in.test.ts`, and its
 *     behaviour on real payloads by `blockInitV2.test.ts` section 4.
 *   - {@link stripComments} tracks string and template literals so a `//` in a
 *     URL is not mistaken for a comment, but it does NOT track regex literals.
 *     No starter source contains one; a future one that does could have a `/`…`/`
 *     body misread. That direction is a false POSITIVE (text gets removed that
 *     should not), i.e. it fails loud rather than passing quietly.
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

/** The one predicate the gate is allowed to be spelled as. */
const GATE_CALL = /\bisSignedIn\s*\(\s*viewer\s*\)/;

/** `import { …, isSignedIn, … } from '@civitai/app-sdk/blocks'` in CODE. */
const GATE_IMPORT = /import\s*\{[^}]*\bisSignedIn\b[^}]*\}\s*from\s*['"]@civitai\/app-sdk\/blocks['"]/;

/**
 * Open-coded sign-in gates — every way `viewer` itself has been, or could be,
 * consulted instead of calling the predicate.
 *
 * The first two are not hypothetical: they are the two spellings this repo has
 * actually shipped in a reference app, and reverting to either is the mutation
 * the previous Rule B could not see.
 */
const OPEN_CODED_GATES = [
  { pattern: /\bviewer\s*(?:!==|===|!=|==)\s*(?:null|undefined)/, label: 'a null/undefined comparison' },
  { pattern: /\bviewer\s*\?(?!\?)/, label: 'optional chaining or a ternary on `viewer`' },
  { pattern: /!\s*viewer\b/, label: 'a `!viewer` negation' },
  { pattern: /\bviewer\s*(?:&&|\|\|)/, label: 'a truthiness test on `viewer`' },
  { pattern: /\bBoolean\s*\(\s*viewer\b/, label: 'Boolean(viewer)' },
  { pattern: /\bviewer\.(?:id|username|signedIn|status)\b/, label: 'a direct field read' },
];

/** A `viewer: { … }` literal inside a hand-built `BlockInitPayload`. */
const HARNESS_VIEWER_LITERAL = /viewer:\s*\{([^}]*)\}/g;

/**
 * Does this file take `viewer` OFF THE BLOCK CONTEXT?
 *
 * 🔴 NOT a bare `\bviewer\b` search, which is what a first draft used. It put
 * `starters/examples/settings/src/App.tsx` in scope on the strength of
 * `forScope="viewer"` and the JSX text "(viewer scope)" — that example has a
 * SETTINGS scope named `viewer` and never reads the context field at all. A
 * rule that demands an unused import from a file that does not have the problem
 * is exactly the cry-wolf failure that gets a guard deleted, so the scope
 * predicate is bound to the destructuring that actually produces the value.
 */
const VIEWER_FROM_CONTEXT = [
  /\{[^{}]*\bviewer\b[^{}]*\}\s*=\s*useBlockContext\s*\(/,
  /\buseBlockContext\s*\([^)]*\)\s*\.viewer\b/,
];

function readsViewerFromContext(code) {
  return VIEWER_FROM_CONTEXT.some((p) => p.test(code));
}

/**
 * Remove every comment, replacing it with equivalent whitespace so line numbers
 * survive. String and template literals are tracked so a `//` inside a URL or a
 * quoted example is NOT treated as a comment.
 *
 * 🔴 THIS FUNCTION IS THE FIX FOR THE WALKABLE RULE B. Everything rule B
 * matches, it matches against the OUTPUT of this. A gate quoted in a doc
 * comment is therefore invisible to the "does it call the predicate" check and,
 * equally, cannot trip the "does it open-code one" check — which is what makes
 * the two halves mean what they say.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
      continue;
    }
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === ch) break;
        // An unterminated single/double-quoted string cannot span a newline;
        // bail so a stray apostrophe in prose can't eat the rest of the file.
        if (ch !== '`' && src[j] === '\n') break;
        j += 1;
      }
      out += src.slice(i, Math.min(j + 1, src.length));
      i = Math.min(j + 1, src.length);
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

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
  const uncommented = stripComments(body);
  return uncommented
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(':')[0].trim().replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean)
    .sort();
}

/** Recursively enumerate files under `dir`, skipping build/vendor trees. */
function walkStarters(predicate) {
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
      } else if (entry.isFile() && predicate(entry.name, full)) {
        out.push(full);
      }
    }
  };
  walk(join(REPO_ROOT, 'starters'));
  return out.sort();
}

/** Every `src/**` file named `Harness.tsx` under `starters/`. */
function harnessFiles() {
  return walkStarters((name) => name === 'Harness.tsx');
}

/**
 * Every starter source that takes `viewer` from the block context — the set
 * rule B applies to. It GROWS on its own when a new example is added, which is
 * the point: a hand-written list would have to be remembered.
 */
function viewerReadingApps() {
  const out = [];
  for (const file of walkStarters((name) => name.endsWith('.tsx') || name.endsWith('.ts'))) {
    if (file.endsWith('Harness.tsx')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!readsViewerFromContext(code)) continue;
    out.push(file);
  }
  return out;
}

function productionViewerKeys() {
  const src = stripComments(readFileSync(join(REPO_ROOT, MOCK_HOST), 'utf8'));
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

test('POSITIVE CONTROL — stripComments removes prose and keeps code', () => {
  // 🔴 THE MUTANT THAT DEFEATED THE PREVIOUS RULE B, in miniature: the gate
  // appears ONLY in a doc comment while the rendered expression is open-coded.
  // The old rule read this as compliant. Both halves of the new rule must see
  // it for what it is.
  const walker = [
    '/**',
    ' * The gate is `isSignedIn(viewer)` — see the SDK.',
    ' */',
    "import { isModelSlotContext } from '@civitai/app-sdk/blocks';",
    "export const A = () => <p>{viewer !== null ? 'signed in' : 'anonymous'}</p>;",
  ].join('\n');
  const code = stripComments(walker);
  assert.ok(!GATE_CALL.test(code), 'a gate quoted in a COMMENT still satisfies the call check');
  assert.ok(!GATE_IMPORT.test(code), 'the import check fired on a file that does not import it');
  assert.ok(
    OPEN_CODED_GATES.some((g) => g.pattern.test(code)),
    'the open-coded-gate scan missed `viewer !== null` in real code',
  );

  // And the mirror image: real code must SURVIVE stripping, including a `//`
  // that is inside a string rather than starting a comment. The assertion on
  // that case looks for a MARKER inside the URL rather than the URL itself —
  // `.includes('https://…')` is the shape CodeQL reports as incomplete URL
  // sanitization, and a required gate that is red for a reason unrelated to
  // what it checks is worse than no gate.
  const real = [
    "import { isSignedIn } from '@civitai/app-sdk/blocks';",
    "const docs = 'https://example.com/SLASHES-MUST-SURVIVE'; // isSignedIn(viewer) mentioned here",
    'export const B = () => isSignedIn(viewer);',
  ].join('\n');
  const realCode = stripComments(real);
  assert.ok(GATE_CALL.test(realCode), 'stripComments removed a real `isSignedIn(viewer)` call');
  assert.ok(GATE_IMPORT.test(realCode), 'stripComments removed a real import');
  assert.ok(
    realCode.includes('SLASHES-MUST-SURVIVE'),
    'a `//` inside a string literal was treated as a comment',
  );
  assert.ok(
    !realCode.includes('mentioned here'),
    'a trailing `//` comment survived stripping',
  );
  // Offsets are preserved, so a future failure message can cite a line number.
  assert.equal(realCode.length, real.length);
  assert.equal(realCode.split('\n').length, real.split('\n').length);
});

test('POSITIVE CONTROL — every open-coded-gate pattern fires on its own shape', () => {
  // Each pattern gets a case it MUST flag. A pattern that has stopped matching
  // is invisible in the real scan below, which only ever reports zero.
  const shapes = {
    'a null/undefined comparison': "{viewer !== null ? 'signed in' : 'anonymous'}",
    'optional chaining or a ternary on `viewer`': "{viewer?.signedIn === true ? 'in' : 'out'}",
    'a `!viewer` negation': 'const isAnon = ready && !viewer;',
    'a truthiness test on `viewer`': 'const ok = viewer && ready;',
    'Boolean(viewer)': 'const ok = Boolean(viewer);',
    'a direct field read': "<span>{viewer.username ?? 'anon'}</span>",
  };
  for (const [label, shape] of Object.entries(shapes)) {
    const gate = OPEN_CODED_GATES.find((g) => g.label === label);
    assert.ok(gate, `no pattern is labelled "${label}" — the control and the rule have drifted`);
    assert.ok(gate.pattern.test(shape), `pattern for "${label}" did not fire on: ${shape}`);
  }

  // NEGATIVE CONTROL — the compliant forms must not trip any of them, or the
  // rule is unsatisfiable and gets deleted by the next person who hits it.
  for (const clean of [
    'const { ready, context, viewer, theme } = useBlockContext();',
    "{isSignedIn(viewer) ? 'signed in' : 'anonymous'}",
    'const isAnon = ready && !isSignedIn(viewer);',
    "import { isModelSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';",
    'const name = viewer ?? fallback;',
  ]) {
    const hit = OPEN_CODED_GATES.find((g) => g.pattern.test(clean));
    assert.ok(!hit, `open-coded-gate pattern "${hit?.label}" over-reported on: ${clean}`);
  }
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

test('CONTROL — rule B scopes on the context read, not the word `viewer`', () => {
  // POSITIVE: the three shapes a starter actually uses to obtain the value.
  for (const inScope of [
    'const { ready, context, viewer, theme, blockInstanceId } = useBlockContext();',
    'const { ready, viewer, theme } = useBlockContext();',
    'const v = useBlockContext().viewer;',
  ]) {
    assert.ok(readsViewerFromContext(inScope), `scope predicate missed a real read: ${inScope}`);
  }

  // NEGATIVE: verbatim from `starters/examples/settings/src/App.tsx`, which a
  // bare `\bviewer\b` scope check pulled in. Its `viewer` is a SETTINGS SCOPE
  // NAME; the file never touches the context field. Demanding an unused import
  // there is the cry-wolf failure that gets a guard clicked through.
  const settingsShape = [
    'const { ready, settings, theme } = useBlockContext();',
    '<div>Your settings (viewer scope)</div>',
    '<SettingsForm forScope="viewer" />',
  ].join('\n');
  assert.ok(
    !readsViewerFromContext(settingsShape),
    'the scope predicate over-reported on a file whose only `viewer` is a settings scope name',
  );
});

test('COVERAGE FLOOR — rule B reaches both reference apps', () => {
  const found = viewerReadingApps().map((f) => relative(REPO_ROOT, f));
  for (const required of REFERENCE_APPS) {
    assert.ok(
      found.includes(required),
      `rule B's scope does not include ${required} — the two files a new block author ` +
        `copies from are the whole reason it exists. Scope found:\n  ${found.join('\n  ')}`,
    );
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
    const rel = relative(REPO_ROOT, file);
    const code = stripComments(readFileSync(file, 'utf8'));
    HARNESS_VIEWER_LITERAL.lastIndex = 0;
    const matches = [...code.matchAll(HARNESS_VIEWER_LITERAL)];
    if (matches.length === 0) continue; // a harness that does not build a viewer is not in scope

    // 🔴 ASSERT THE ASSUMPTION RATHER THAN RELYING ON IT. Taking the FIRST
    // `viewer: { … }` is correct only while a harness has exactly one — true
    // today for all seven, and silently wrong the day one also mocks a
    // `GET_VIEWER` reply (whose viewer legitimately DOES carry `status`, so
    // comparing every literal against the BLOCK_INIT key set would be wrong
    // too). Fail loudly and make whoever adds the second one anchor the
    // extraction on the `BlockInitPayload` instead of silently checking the
    // wrong object.
    if (matches.length > 1) {
      mismatches.push(
        `${rel} — ${matches.length} \`viewer: { … }\` literals; this guard can only ` +
          `identify the BLOCK_INIT one while there is exactly one. Anchor the extraction ` +
          `on the \`BlockInitPayload\` declaration before adding another.`,
      );
      continue;
    }

    const keys = keysOfObjectLiteralBody(matches[0][1]);
    if (keys.join(',') === expected.join(',')) continue;
    mismatches.push(`${rel} — has [${keys}], host sends [${expected}]`);
  }
  assert.deepEqual(
    mismatches,
    [],
    `A starter dev harness sends a viewer production does not.\n` +
      `A harness that omits \`signedIn\` makes the harness disagree with the host the\n` +
      `block will actually run against; one that adds \`status\` lets a block read a\n` +
      `field the platform withholds from third-party iframes (civitai #2521).\n\n` +
      `    ${mismatches.join('\n    ')}\n`,
  );
});

test('RULE B — no starter block app open-codes the sign-in gate', () => {
  const offenders = [];
  for (const file of viewerReadingApps()) {
    const rel = relative(REPO_ROOT, file);
    const code = stripComments(readFileSync(file, 'utf8'));

    for (const { pattern, label } of OPEN_CODED_GATES) {
      const hit = pattern.exec(code);
      if (!hit) continue;
      const line = code.slice(0, hit.index).split('\n').length;
      offenders.push(`${rel}:${line} — ${label}: \`${hit[0].trim()}\``);
    }
    if (!GATE_IMPORT.test(code)) {
      offenders.push(`${rel} — does not import \`isSignedIn\` from '@civitai/app-sdk/blocks'`);
    }
  }

  // The two copied templates must additionally CALL it — importing without
  // calling would satisfy the import check while demonstrating nothing.
  for (const rel of REFERENCE_APPS) {
    const code = stripComments(readFileSync(join(REPO_ROOT, rel), 'utf8'));
    if (!GATE_CALL.test(code)) {
      offenders.push(`${rel} — no \`isSignedIn(viewer)\` call in CODE (a mention in a comment is not one)`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `A starter answers "is someone signed in?" itself instead of asking the SDK.\n` +
      `Call \`isSignedIn(viewer)\` from '@civitai/app-sdk/blocks'. Which spelling is\n` +
      `correct has already changed once and is adjudicated in that one function; a\n` +
      `starter is COPIED, so a gate open-coded here becomes the gate the ecosystem\n` +
      `writes and every copy has to be found again when the wire contract moves.\n` +
      `Need the viewer's identity rather than their presence? Call \`useViewer()\`.\n\n` +
      `    ${offenders.join('\n    ')}\n`,
  );
});
