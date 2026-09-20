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
 *   B. No starter block app open-codes the sign-in gate. Every starter
 *      `.ts`/`.tsx` source that BINDS a `viewer` — off `useBlockContext()`
 *      directly, through a named context binding, or as a component prop —
 *      must import `isSignedIn` from `@civitai/app-sdk/blocks` and answer
 *      through it. The precise scope, and the shapes it does NOT reach, are
 *      enumerated on {@link viewerReadingApps}; read that before quoting this
 *      rule as coverage.
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
 *     URL is not mistaken for a comment. It does NOT parse JSX or regex
 *     literals, and an earlier revision's handling of that turned a quote
 *     character it could not pair up into a licence to copy the REST OF THE
 *     LINE through unstripped — which made `<p>Here's the viewer</p>; //
 *     isSignedIn(viewer)` read as a real call. A lone quote is now emitted as
 *     an ordinary character and scanning resumes, so that walk is closed and
 *     pinned by the control below.
 *
 *     🔴 WHAT IS STILL OPEN, AND IN WHICH DIRECTION — the earlier note here
 *     claimed the only failure mode was a loud false POSITIVE. That was wrong,
 *     and a maintainer who believed it would have left the walk above in
 *     place. Both directions exist:
 *       · FALSE NEGATIVE (quiet — a comment survives and can satisfy a
 *         positive check): two quote characters on ONE line that are not a
 *         string but pair up anyway — `<p>Here's Bob's file</p>` — make the
 *         span between them opaque, so a `//` INSIDE that span is not
 *         stripped. The trailing comment after the pair still is.
 *       · FALSE POSITIVE (loud — real code is blanked and the rule fires): a
 *         regex literal whose body contains `//` or `/*`, or an odd number of
 *         quote characters arranged so a real string's opening quote is
 *         consumed as the partner of a prose apostrophe.
 *     Neither shape exists in `starters/` today. The honest scope of this
 *     function is "good enough for the shapes a starter is written in", not
 *     "a lexer" — if a starter ever needs one, replace it rather than widening
 *     the regex-by-regex patchwork.
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

/**
 * The `viewer:` field of a hand-built `BlockInitPayload`, in every shape a
 * harness can write it: an INLINE `{ … }` literal, a reference to a hoisted
 * `const`, or an explicit `null` / `undefined` for an anonymous viewer.
 *
 * 🔴 IT MUST MATCH THE REFERENCE FORM, NOT ONLY THE LITERAL. An earlier
 * revision matched `viewer:\s*\{ … \}` alone and then did `if (matches.length
 * === 0) continue;` — so hoisting the object one line up
 * (`const DEV_VIEWER = { id: 2, username: 'dev-viewer', status: 'active' };`
 * … `viewer: DEV_VIEWER,`) took the file silently OUT of scope and restored
 * the exact 66f9e09 defect with the suite green. Rule A now RESOLVES the
 * reference, and the accounting assertion below refuses to pass while any
 * harness went uncompared.
 */
const HARNESS_VIEWER_FIELD =
  /(?<![\w$])viewer\s*:\s*(\{[^{}]*\}|null\b|undefined\b|[A-Za-z_$][\w$]*)/g;

/**
 * `const NAME = { … }` / `const NAME: T = { … }` — how a harness that hoists
 * its viewer declares it. Built per-identifier so only the one actually
 * referenced by `viewer:` is read.
 */
const hoistedObjectDecl = (name) =>
  new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::[^=;]*)?=\\s*\\{([^{}]*)\\}`);

/**
 * Harnesses that deliberately post `viewer: null` (an ANONYMOUS viewer) and so
 * have no key set to compare. A NAMED allowlist, not a silent `continue`:
 * being on it exempts a harness only while the file really does post
 * `null`/`undefined`, so it cannot be used to wave through a shape rule A
 * failed to parse.
 *
 * Empty today — all seven harnesses post a present viewer.
 */
const ANONYMOUS_HARNESSES = new Set([]);

/**
 * Does this file HANDLE a host viewer — i.e. is it a place the sign-in gate
 * could be open-coded?
 *
 * 🔴 NOT a bare `\bviewer\b` search, which is what a first draft used. It put
 * `starters/examples/settings/src/App.tsx` in scope on the strength of
 * `forScope="viewer"` and the JSX text "(viewer scope)" — that example has a
 * SETTINGS scope named `viewer` and never reads the context field at all. A
 * rule that demands an unused import from a file that does not have the problem
 * is exactly the cry-wolf failure that gets a guard deleted, so the scope
 * predicate is bound to a BINDING named `viewer`, never to a mention of the
 * word.
 *
 * 🔴 AND NOT ONLY THE DESTRUCTURE, which is what the revision before this one
 * matched. Two measured survivors:
 *   - `const ctx = useBlockContext(); const viewer = ctx.viewer;` — the same
 *     read through a named binding, invisible to a pattern anchored on `{ … }
 *     = useBlockContext()`.
 *   - a SIBLING component (`ViewerBadge.tsx`) taking `viewer` as a prop and
 *     open-coding `viewer !== null` there, while `App.tsx` stayed clean.
 *     Extracting a component is the first thing a growing starter does, and
 *     rule B exists precisely because a `tiged`-copied template must not carry
 *     its own copy of the gate decision — which half of the template carries it
 *     is beside the point.
 */
const VIEWER_BINDINGS = [
  {
    pattern: /\{[^{}]*\bviewer\b[^{}]*\}\s*=\s*useBlockContext\s*\(/,
    label: 'destructured off `useBlockContext()`',
  },
  {
    pattern: /\buseBlockContext\s*\([^)]*\)\s*\.viewer\b/,
    label: 'read straight off `useBlockContext()`',
  },
  {
    // `function Badge({ viewer }: Props)` / `({ viewer, theme }) =>` — a
    // component or helper that RECEIVES the viewer.
    pattern: /\(\s*\{[^{}]*\bviewer\b[^{}]*\}\s*[:,)]/,
    label: 'a destructured `viewer` parameter',
  },
  {
    // `viewer: ViewerInfo | null` — a declared prop or field of the host type.
    pattern: /\bviewer\s*\??\s*:\s*(?:null\s*\|\s*)?ViewerInfo\b/,
    label: 'a `viewer: ViewerInfo` declaration',
  },
  {
    // `const viewer = …` — any local binding by that name, whatever the source.
    pattern: /\b(?:const|let|var)\s+viewer\b\s*[:=]/,
    label: 'a local binding named `viewer`',
  },
];

/**
 * `const ctx = useBlockContext(); … ctx.viewer` — the context read through a
 * named binding. Resolved per-identifier rather than by a `\w+\.viewer` regex,
 * so an unrelated `foo.viewer` on some other object does not pull a file in.
 */
function readsViewerOffContextAlias(code) {
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*useBlockContext\s*\(/g)) {
    if (new RegExp(`\\b${m[1]}\\s*\\.\\s*viewer\\b`).test(code)) return true;
  }
  return false;
}

function readsViewerFromContext(code) {
  return VIEWER_BINDINGS.some((b) => b.pattern.test(code)) || readsViewerOffContextAlias(code);
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
      let closed = false;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === ch) {
          closed = true;
          break;
        }
        // A single/double-quoted string cannot span a newline, so a quote with
        // no partner before the line ends is not a string at all.
        if (ch !== '`' && src[j] === '\n') break;
        j += 1;
      }
      // 🔴 AN UNPAIRED QUOTE IS ORDINARY TEXT, NOT A ONE-LINE STRING. An
      // earlier revision stopped the scan at the newline but still COPIED
      // everything up to it verbatim, so a lone apostrophe in JSX prose
      // (`<p>Here's the viewer</p>`) or in a regex literal (`/it's/`) shielded
      // every `//` later on that line from being stripped — and a gate
      // mentioned in such a comment then satisfied rule B's call check. Emit
      // the quote as a plain character and resume scanning from the next one
      // so the rest of the line is still examined.
      if (!closed) {
        out += ch;
        i += 1;
        continue;
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

/**
 * Read the `viewer` a harness posts in its `BlockInitPayload`, from SOURCE
 * TEXT that has already been through {@link stripComments}.
 *
 * Returns one of:
 *   `{ kind: 'keys', keys }`      — a key set to compare against the host's.
 *   `{ kind: 'anonymous' }`       — an explicit `viewer: null` / `undefined`.
 *   `{ kind: 'unreadable', why }` — this guard cannot tell what is posted.
 *
 * 🔴 THERE IS NO FOURTH OUTCOME, and that is the whole point. A shape it does
 * not understand is reported as UNREADABLE, never skipped: the caller counts
 * the harnesses it actually compared and fails when that number is short.
 *
 * Exported so the controls can drive it with literals — no starter hoists its
 * viewer today, so the reference-resolving branch has no in-tree exercise and
 * would otherwise be an unreachable guard.
 */
export function readHarnessViewer(code) {
  HARNESS_VIEWER_FIELD.lastIndex = 0;
  const matches = [...code.matchAll(HARNESS_VIEWER_FIELD)];

  if (matches.length === 0) {
    return {
      kind: 'unreadable',
      why:
        'no `viewer:` field this guard can read. It accepts an inline `{ … }` literal, a ' +
        'reference to a hoisted `const`, or `null`. Anything else (a factory call, a spread) ' +
        'would leave the file UNCHECKED, which is how the 66f9e09 viewer came back once already.',
    };
  }

  // 🔴 ASSERT THE ASSUMPTION RATHER THAN RELYING ON IT. Taking the FIRST
  // `viewer:` is correct only while a harness has exactly one — true today for
  // all seven, and silently wrong the day one also mocks a `GET_VIEWER` reply
  // (whose viewer legitimately DOES carry `status`, so comparing every one
  // against the BLOCK_INIT key set would be wrong too).
  if (matches.length > 1) {
    return {
      kind: 'unreadable',
      why:
        `${matches.length} \`viewer:\` fields; this guard can only identify the BLOCK_INIT ` +
        `one while there is exactly one. Anchor the extraction on the \`BlockInitPayload\` ` +
        `declaration before adding another.`,
    };
  }

  const value = matches[0][1].trim();
  if (value === 'null' || value === 'undefined') return { kind: 'anonymous' };
  if (value.startsWith('{')) {
    return { kind: 'keys', keys: keysOfObjectLiteralBody(value.slice(1, -1)) };
  }

  const decl = code.match(hoistedObjectDecl(value));
  if (!decl) {
    return {
      kind: 'unreadable',
      why:
        `\`viewer: ${value}\`, but no \`const ${value} = { … }\` object literal in the same ` +
        `file. Inline the literal or declare it as one so its key set can be compared ` +
        `against the host's.`,
    };
  }
  return { kind: 'keys', keys: keysOfObjectLiteralBody(decl[1]) };
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

/**
 * Every `src/**` file named `Harness.tsx` under `starters/` — the set rule A
 * applies to, and the denominator its coverage accounting is checked against.
 *
 * 🔴 THE SET IS CHOSEN BY FILENAME, so a dev harness under any other name
 * (`DevHarness.tsx`, `main.dev.tsx`) is not merely unchecked, it is INVISIBLE:
 * the accounting below can only reconcile the files this returns. Measured — a
 * `DevHarness.tsx` posting the 66f9e09 viewer leaves the suite green. The
 * mitigation is the convention, not this guard: every starter's `dev:harness`
 * entry point is named `Harness.tsx`, and the COVERAGE FLOOR test fails if
 * that stops producing at least seven files.
 */
function harnessFiles() {
  return walkStarters((name) => name === 'Harness.tsx');
}

/**
 * Every starter `.ts`/`.tsx` source that BINDS a `viewer` — the set rule B
 * applies to. It grows on its own as examples and components are added: no
 * hand-written list to remember.
 *
 * 🔴 THE SCOPE IS EXACTLY {@link VIEWER_BINDINGS} PLUS
 * {@link readsViewerOffContextAlias}, NO WIDER. Say the uncovered shapes out
 * loud, because a scope predicate that reads as "everything" while matching
 * five patterns is the defect this revision exists to fix:
 *   - A RENAMED binding. `const { viewer: v } = useBlockContext()` puts the
 *     file in scope (the destructure still matches) but every open-coded gate
 *     is then written on `v`, which no pattern here looks at. MEASURED both
 *     ways: in a {@link REFERENCE_APPS} file the rename is still caught,
 *     because those must CALL `isSignedIn(viewer)` by name; in any other
 *     in-scope file (`kv-storage/src/App.tsx` renamed to `v` and gated on
 *     `v === null`) the suite stays green. The import check applies
 *     everywhere; the open-coding check does not survive a rename.
 *   - A viewer that reaches a component under any other parameter name
 *     (`user`, `me`, `props.v`).
 *   - `.svelte` files. The walk takes `.ts`/`.tsx` only; the two Svelte
 *     starters are OAuth apps with no `useBlockContext`, so there is nothing
 *     to cover today — but a Svelte block starter would be UNCOVERED, not
 *     merely unvisited.
 *   - Anything outside `starters/`. The packages have their own tests.
 * What is covered is the shape a starter is actually written in, and the two
 * that were measured walking straight past the previous revision.
 */
export function viewerReadingApps() {
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

test('POSITIVE CONTROL — readHarnessViewer follows a HOISTED viewer and refuses what it cannot read', () => {
  // 🔴 THE MUTANT THAT TOOK A HARNESS OUT OF SCOPE. The 66f9e09 viewer, moved
  // one line up out of the payload. Rule A used to see no `viewer: { … }` and
  // `continue`; it must now resolve the reference and report the real key set.
  const hoisted = [
    "    const DEV_VIEWER = { id: 2, username: 'dev-viewer', status: 'active' };",
    '    const payload: BlockInitPayload = {',
    '      viewer: DEV_VIEWER,',
    "      theme: 'dark',",
    '    };',
  ].join('\n');
  assert.deepEqual(readHarnessViewer(hoisted), {
    kind: 'keys',
    keys: ['id', 'status', 'username'],
  });

  // Typed and `let`-declared spellings of the same hoist.
  assert.deepEqual(
    readHarnessViewer(
      "let V: ViewerInfo = { id: 2, username: 'dev-viewer', signedIn: true };\nviewer: V,",
    ),
    { kind: 'keys', keys: ['id', 'signedIn', 'username'] },
  );

  // The inline form still works, and `setViewer:` / `myviewer:` must not be
  // mistaken for the field.
  assert.deepEqual(readHarnessViewer("viewer: { id: 2, signedIn: true, username: 'x' },"), {
    kind: 'keys',
    keys: ['id', 'signedIn', 'username'],
  });
  assert.equal(readHarnessViewer('onViewer: handler,').kind, 'unreadable');

  // An anonymous viewer is a distinct outcome, not a comparison.
  assert.deepEqual(readHarnessViewer('viewer: null,'), { kind: 'anonymous' });

  // 🔴 AND THE SHAPES IT CANNOT READ MUST SAY SO rather than return nothing.
  for (const [label, code] of [
    ['a factory call', 'viewer: makeViewer(),'],
    ['a reference with no literal in the file', 'viewer: IMPORTED_VIEWER,'],
    ['no viewer at all', "const payload = { theme: 'dark' };"],
    ['two viewer fields', "viewer: { id: 1 },\nviewer: { id: 2, status: 'active' },"],
  ]) {
    assert.equal(
      readHarnessViewer(code).kind,
      'unreadable',
      `readHarnessViewer silently accepted ${label}: ${code}`,
    );
  }
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

test('POSITIVE CONTROL — an unpaired quote does not shield the rest of the line', () => {
  // 🔴 THE SECOND WALK AROUND RULE B. A quote character that is not a string
  // delimiter — an apostrophe in JSX prose, one inside a regex literal —
  // used to stop the comment scanner for the rest of the line, so a `//`
  // after it survived and the gate MENTIONED there satisfied the call check.
  // Each row is `[source, what must be true of the stripped output]`.
  const shielded = [
    "<p>Hello</p>; // isSignedIn(viewer)",
    "<p>Here's the viewer</p>; // isSignedIn(viewer)",
    "const re = /it's/; // isSignedIn(viewer)",
    "const label = <em>Here's your block</em>; // the gate: isSignedIn(viewer)",
    'const q = "don\'t"; // isSignedIn(viewer)',
  ];
  for (const line of shielded) {
    const code = stripComments(line);
    assert.ok(
      !GATE_CALL.test(code),
      `a gate in a trailing \`//\` comment survived stripping, so PROSE satisfies rule B:\n  ${line}\n  -> ${code}`,
    );
    assert.equal(code.length, line.length, `offsets drifted while stripping: ${line}`);
  }

  // NEGATIVE CONTROL — the fix must not start eating code. A `//` that is
  // genuinely inside a quoted string still survives, apostrophe or not.
  const kept = [
    ["const u = 'https://example.com/KEEP-ME';", 'KEEP-ME'],
    ['const u = "https://example.com/KEEP-ME"; // isSignedIn(viewer)', 'KEEP-ME'],
    ["const s = 'it\\'s https://example.com/KEEP-ME';", 'KEEP-ME'],
    ['const t = `https://example.com/KEEP-ME`;', 'KEEP-ME'],
  ];
  for (const [line, marker] of kept) {
    const code = stripComments(line);
    assert.ok(code.includes(marker), `a \`//\` inside a string literal was stripped: ${line}`);
  }
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

test('CONTROL — rule B scopes on a `viewer` BINDING, not the word `viewer`', () => {
  // POSITIVE: every shape a starter can obtain or receive the value in. The
  // last three are the survivors the previous revision's scope walked past —
  // each is asserted individually so one of them regressing cannot hide behind
  // the others.
  for (const inScope of [
    'const { ready, context, viewer, theme, blockInstanceId } = useBlockContext();',
    'const { ready, viewer, theme } = useBlockContext();',
    'const v = useBlockContext().viewer;',
    // the named-binding indirection
    'const ctx = useBlockContext();\nconst viewer = ctx.viewer;',
    'let c = useBlockContext();\nif (c.viewer) return null;',
    // a sibling component receiving it as a prop
    'export function ViewerBadge({ viewer }: { viewer: ViewerInfo | null }) {',
    'export const Badge = ({ viewer, theme }) => <b>{theme}</b>;',
    'type Props = { viewer: ViewerInfo | null };',
    'function f(viewer?: ViewerInfo) {}',
  ]) {
    assert.ok(readsViewerFromContext(inScope), `scope predicate missed a real binding: ${inScope}`);
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

  // NEGATIVE: the identifiers the widened patterns are most likely to
  // over-reach onto. All three are real shapes in `starters/examples/`.
  for (const outOfScope of [
    'const viewerMessage = snap.status === "failed" ? failure(snap) : undefined;',
    '...(viewerMessage ? { viewerMessage } : {})',
    'const viewerPresent = Date.now() - startedAt < MAX;',
    "// the viewer is whoever the host says it is — const viewer = never happens here",
    'const url = `${base}/viewer/${id}`;',
  ]) {
    assert.ok(
      !readsViewerFromContext(stripComments(outOfScope)),
      `scope predicate over-reported on: ${outOfScope}`,
    );
  }

  // 🔴 AND THE ALIAS RESOLUTION MUST BE BOUND TO THE RIGHT OBJECT. A
  // `.viewer` read off something that is not the block context does not put a
  // file in scope, or every starter with a `props.viewer`-shaped API is
  // dragged in.
  assert.ok(
    !readsViewerFromContext('const ctx = useBlockContext();\nconst n = other.viewer;'),
    'the alias resolver matched `.viewer` on an unrelated object',
  );
});

test('COVERAGE FLOOR — rule B reaches both reference apps', () => {
  const found = viewerReadingApps().map((f) => relative(REPO_ROOT, f));
  // Rule B reports `[]` identically whether it scanned three files or none, so
  // the size of its scope is asserted rather than assumed. Three today; a
  // GROWING set is the point, a SHRINKING one means the predicate stopped
  // seeing a shape the starters are written in.
  assert.ok(
    found.length >= 3,
    `rule B's scope is down to ${found.length} file(s) — it used to reach three. ` +
      `Scope found:\n  ${found.join('\n  ')}`,
  );
  for (const required of [...REFERENCE_APPS, 'starters/examples/kv-storage/src/App.tsx']) {
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

  const harnesses = harnessFiles();
  const mismatches = [];
  const unreadable = [];
  const compared = [];
  const anonymous = [];

  for (const file of harnesses) {
    const rel = relative(REPO_ROOT, file);
    const read = readHarnessViewer(stripComments(readFileSync(file, 'utf8')));

    if (read.kind === 'unreadable') {
      unreadable.push(`${rel} — ${read.why}`);
      continue;
    }
    if (read.kind === 'anonymous') {
      // Legitimate, but it is the one shape with no key set to compare, so it
      // has to be NAMED rather than silently skipped.
      if (!ANONYMOUS_HARNESSES.has(rel)) {
        unreadable.push(
          `${rel} — posts \`viewer: null\` (an anonymous viewer). That is legitimate, but ` +
            `it is the one shape with no key set to compare, so it must be listed in ` +
            `ANONYMOUS_HARNESSES in this file to stay in the accounting.`,
        );
        continue;
      }
      anonymous.push(rel);
      continue;
    }

    compared.push(rel);
    if (read.keys.join(',') === expected.join(',')) continue;
    mismatches.push(`${rel} — has [${read.keys}], host sends [${expected}]`);
  }

  // 🔴 THE COVERAGE CLAIM, ASSERTED FIRST. The key-set comparison below reports
  // `[]` identically whether it compared seven harnesses or zero, so the number
  // it looked at has to be a checked fact rather than an assumption.
  assert.deepEqual(
    unreadable,
    [],
    `Rule A could not read a harness's viewer, so that harness was NOT compared\n` +
      `against the host contract. Silence here is indistinguishable from compliance.\n\n` +
      `    ${unreadable.join('\n    ')}\n`,
  );
  assert.equal(
    compared.length + anonymous.length,
    harnesses.length,
    `Rule A compared ${compared.length} harness viewers (+${anonymous.length} allowlisted ` +
      `anonymous) but the walk found ${harnesses.length} harnesses. Compared:\n  ` +
      `${compared.join('\n  ')}`,
  );
  assert.equal(
    compared.length,
    harnesses.length - ANONYMOUS_HARNESSES.size,
    `ANONYMOUS_HARNESSES lists ${ANONYMOUS_HARNESSES.size} exemption(s) but ` +
      `${harnesses.length - compared.length} harness(es) went uncompared. An entry that no ` +
      `longer posts \`viewer: null\` must be removed from the allowlist.`,
  );

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
