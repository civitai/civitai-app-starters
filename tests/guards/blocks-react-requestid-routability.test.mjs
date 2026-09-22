/**
 * #395 — **no `requestId` routability or wire-shape decision is open-coded**
 * anywhere in `packages/civitai-blocks-react/src` outside
 * `src/transport/requestId.ts`.
 *
 * Before this guard, "a reply with no `requestId` is unroutable" was asserted in
 * prose and implemented at 64 sites in five spellings. Measured on `e993cf0`:
 * 33 x `p.requestId !== undefined && typeof p.requestId !== 'string'`,
 * 1 x `!isNonEmptyString(p.requestId)`, 26 x `typeof requestId !== 'string'`,
 * 2 x `typeof <expr>.requestId === 'string'`, and
 * 2 x `...(requestId ? { requestId } : {})`. They agreed about `null` and
 * disagreed about `''`.
 *
 * ## The rule is a SHAPE, not a spelling
 *
 * 🔴 A guard that greps for `requestId !== undefined` is walkable by writing
 * `!= undefined`, or a truthiness test, or `typeof … === 'string'` — which is
 * this issue's own failure mode one level up. So the detector does not match
 * spellings. It finds every `requestId` IDENTIFIER in the comment-stripped
 * source and asks whether a DECISION OPERATOR is adjacent to it: a `typeof`
 * immediately before the operand, a comparison / logical / ternary operator
 * immediately after it, a negation or comparison immediately before it, or a
 * boolean-coercing call wrapping it. Reading `requestId` as data — putting it in
 * an object literal, passing it as an argument, using it as a `Map` key — is
 * invisible to it; deciding anything on its shape is not.
 *
 * Each rule below is mutation-tested in `## Mutation battery` at the bottom of
 * this file: every retired spelling, plus `!= undefined`, truthiness and
 * `typeof`, is re-introduced into a copy of the real source text and the
 * detector must catch it THERE — not merely "a test went red".
 *
 * ## What it CAN see
 *
 *   • `typeof x.requestId === 'string'` / `!== 'string'`  (either quote style)
 *   • `requestId !== undefined`, `!= undefined`, `=== undefined`, `== undefined`
 *   • `requestId === ''`, `!== ''`, and comparison against anything else
 *   • truthiness: `requestId ? … : …`, `!requestId`, `requestId && …`,
 *     `… || requestId`, `Boolean(requestId)`, `isNonEmptyString(requestId)`
 *   • all of the above through an arbitrary member path or optional chain
 *     (`p.requestId`, `typed.payload?.requestId`, `msg['requestId']`)
 *
 * ## What it CANNOT see — known limits, stated rather than implied
 *
 *   • **An ALIAS.** `const rid = payload.requestId; if (typeof rid === 'string')`
 *     is invisible: the decision operator sits next to `rid`, not next to
 *     `requestId`. Chasing aliases needs a type-aware pass, which this
 *     text-reading guard is not. This is the widest hole and the likeliest way
 *     the rule gets walked.
 *   • **`??`**, deliberately. `requestId ?? ''` is a nullish DEFAULT on an emit
 *     path — nobody branches on the result, it goes straight onto the wire — and
 *     `liveHost.ts` has 37 of them. Flagging them would force a 37-site
 *     behaviour change to satisfy a guard. They are instead an ASSERTED COUNT
 *     below, so a 38th cannot appear without someone deciding.
 *   • **Another package.** It reads only `civitai-blocks-react/src`.
 *   • **Whether the predicate is CORRECT.** It proves the decision is made in
 *     one place; that the place is right is
 *     `packages/civitai-blocks-react/test/requestId.test.ts`.
 *   • **A decision inside a comment**, on purpose — comments are stripped, so a
 *     docblock quoting a retired spelling (several do) neither trips the rule
 *     nor satisfies it.
 *
 * ## Why a call LEDGER as well as a no-open-coding rule
 *
 * "No open-coded checks" is satisfied by deleting every check. The ledger below
 * asserts the exact per-file COUNT of helper calls, so removing one fails here
 * even when nothing open-coded replaces it — the same reason
 * `blocks-react-hook-return-types.test.mjs` asserts set equality rather than a
 * one-directional "a type exists".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from './lib/strip-comments.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SRC = join(REPO_ROOT, 'packages', 'civitai-blocks-react', 'src');

/** The one module allowed to decide anything about a `requestId`'s shape. */
const HELPER_REL = 'transport/requestId.ts';

/** The predicates that module exports. A call to either EXEMPTS its argument. */
const HELPERS = ['isRoutableRequestId', 'isWireRequestIdShape'];

/**
 * Sites that read `requestId` as DATA and are still adjacent to an operator, so
 * the detector flags them. Each is a recorded decision with a reason, keyed by
 * `<file>:<line>:<the comment-stripped source line, normalised>` — the line TEXT
 * is part of the key on purpose, so editing the line into something else
 * invalidates the exemption instead of silently carrying it forward.
 */
const EXEMPT = [
  {
    file: 'hooks/useImageUpload.ts',
    line: "if (!entry || entry.requestId !== requestId) return;",
    why:
      'EQUALITY between two ids, not a shape decision. It asks "is this scan verdict ' +
      "mine?\" — both operands are already-routable ids (one from `sendTypedRequest`'s " +
      'reply, one from the validated `IMAGE_SCAN_RESOLVED` push, which requires a ' +
      'non-empty `requestId` via `isValidImageScanResolved`). Routing it through ' +
      'the helper would answer a different question.',
  },
];

/** Every `.ts` / `.tsx` file under `src`, as repo-relative-to-SRC paths. */
function sourceFiles(dir = SRC, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}

const relToSrc = (full) => relative(SRC, full).split('\\').join('/');

/**
 * An operand chain that can sit between an operator and the `requestId` token:
 * a member path, an optional chain, a bracket access, a quoted key. Deliberately
 * EXCLUDES `(` and `)` so a function call between the operator and the token
 * breaks the chain — that is what keeps `!isRoutableRequestId(p.requestId)` from
 * reading as "a `!` applied to `requestId`".
 */
const CHAIN = "[A-Za-z0-9_$.?!\\[\\]'\"]*";

/** `typeof` immediately before the operand. */
const RE_TYPEOF_BEFORE = new RegExp(`\\btypeof\\s+${CHAIN}$`);

/**
 * A decision operator immediately AFTER the token.
 *
 * `\\?(?![.?:])` is the ternary: `?.` is an optional chain, `??` a nullish
 * default (see the limits above), and `?:` the TYPE-LEVEL optional-property
 * marker in `{ requestId?: unknown }` — none of the three is a branch.
 */
const RE_OP_AFTER = /^\s*(===|!==|==(?!=)|!=(?!=)|&&|\|\||\?(?![.?:]))/;

/** A negation or comparison immediately BEFORE the operand. */
const RE_OP_BEFORE = new RegExp(`(!(?!=)|===|!==|==|!=|&&|\\|\\|)\\s*${CHAIN}$`);

/** A boolean-coercing call wrapping the operand. */
const RE_COERCE_BEFORE = new RegExp(`\\b(isNonEmptyString|Boolean)\\(\\s*${CHAIN}$`);

/** A call to one of the consolidated helpers — its argument is EXEMPT. */
const RE_HELPER_CALL = new RegExp(`\\b(${HELPERS.join('|')})\\(\\s*${CHAIN}$`);

/**
 * Every place `text` decides something about a `requestId`'s shape.
 *
 * Exported shape: `{ line, text, rule }`, where `line` is 1-based and `text` is
 * the comment-stripped source line, trimmed and whitespace-collapsed.
 */
export function findOpenCodedDecisions(text) {
  const stripped = stripComments(text);
  const lines = stripped.split('\n');
  const hits = [];
  const token = /\brequestId\b/g;
  let m;
  while ((m = token.exec(stripped)) !== null) {
    const i = m.index;
    const before = stripped.slice(Math.max(0, i - 80), i);
    const after = stripped.slice(i + 'requestId'.length, i + 'requestId'.length + 80);
    if (RE_HELPER_CALL.test(before)) continue;

    let rule = null;
    if (RE_TYPEOF_BEFORE.test(before)) rule = 'typeof-before';
    else if (RE_COERCE_BEFORE.test(before)) rule = 'coerce-before';
    else if (RE_OP_AFTER.test(after)) rule = 'operator-after';
    else if (RE_OP_BEFORE.test(before)) rule = 'operator-before';
    if (!rule) continue;

    const line = stripped.slice(0, i).split('\n').length;
    hits.push({ line, text: (lines[line - 1] ?? '').trim().replace(/\s+/g, ' '), rule });
  }
  return hits;
}

const FILES = sourceFiles();
const READ = new Map(FILES.map((f) => [relToSrc(f), readFileSync(f, 'utf8')]));

test('the detector is pointed at real files (harness positive control)', () => {
  assert.ok(FILES.length > 50, `expected the blocks-react src tree, found ${FILES.length} files`);
  assert.ok(READ.has(HELPER_REL), `${HELPER_REL} not found — the helper module is the rule's anchor`);
  // The tree really does mention `requestId`, so a clean result below is a
  // verdict and not a mis-pointed reader.
  const mentions = [...READ.values()].filter((t) => /\brequestId\b/.test(t)).length;
  assert.ok(mentions >= 8, `only ${mentions} files mention requestId — reader looks mis-pointed`);
});

test('no routability or wire-shape decision is open-coded outside the helper', () => {
  const exemptKeys = new Set(EXEMPT.map((e) => `${e.file}::${e.line}`));
  const found = [];
  const matchedExemptions = new Set();
  for (const [rel, text] of READ) {
    if (rel === HELPER_REL) continue;
    for (const hit of findOpenCodedDecisions(text)) {
      const key = `${rel}::${hit.text}`;
      if (exemptKeys.has(key)) {
        matchedExemptions.add(key);
        continue;
      }
      found.push(`${rel}:${hit.line} [${hit.rule}] ${hit.text}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    `open-coded requestId decision(s) — route them through ${HELPER_REL}:\n  ${found.join('\n  ')}`,
  );
  // A stale exemption is a lie about the code: fail when one stops matching.
  assert.deepEqual(
    [...exemptKeys].filter((k) => !matchedExemptions.has(k)),
    [],
    'EXEMPT entry no longer matches any source line — delete it or re-derive it',
  );
});

/**
 * Per-file call counts. A SET EQUALITY over files AND an exact count per file,
 * so this fails when a call site is deleted as well as when one appears in a
 * file that had none.
 */
const HELPER_CALL_LEDGER = {
  'internal/liveHost.ts': 14,
  'internal/mockHost.ts': 14,
  'transport/iframeTransport.ts': 2,
  'transport/validate.ts': 34,
};

test('every consolidated call site is accounted for (asserted ledger)', () => {
  const actual = {};
  for (const [rel, text] of READ) {
    if (rel === HELPER_REL) continue;
    const stripped = stripComments(text);
    // Calls only — the `import { … } from './requestId.js'` line is not one.
    const n = (stripped.match(new RegExp(`\\b(?:${HELPERS.join('|')})\\(`, 'g')) ?? []).length;
    if (n > 0) actual[rel] = n;
  }
  assert.deepEqual(actual, HELPER_CALL_LEDGER);
});

/**
 * The `requestId ?? ''` emit-path defaults the detector deliberately ignores.
 * Asserted so the set cannot grow unnoticed — see the limits above.
 */
const NULLISH_DEFAULT_LEDGER = { 'internal/liveHost.ts': 37 };

test('the ignored `requestId ??` emit-path defaults are an asserted count', () => {
  const actual = {};
  for (const [rel, text] of READ) {
    if (rel === HELPER_REL) continue;
    const n = (stripComments(text).match(/\brequestId\s*\?\?/g) ?? []).length;
    if (n > 0) actual[rel] = n;
  }
  assert.deepEqual(actual, NULLISH_DEFAULT_LEDGER);
});

// ─────────────────────────── Mutation battery ────────────────────────────
//
// 🔴 EVERY MUTANT IS ASSERTED TO HAVE APPLIED before its result is read. A
// mutant whose anchor text was not found substitutes nothing, produces an
// unchanged file, and reports as a clean pass — a SURVIVED result that is really
// "the mutation never ran". The `applied` assertion below is what separates the
// two, and it is checked FIRST in every case.
//
// The mutants are spliced into the REAL text of `transport/validate.ts` (a file
// that is clean today and whose `isWireRequestIdShape` call this replaces), so
// each is exercised in the surrounding syntax it would really appear in — not
// in a textbook fixture the detector might treat differently.

const VALIDATE_REL = 'transport/validate.ts';
const ANCHOR = 'if (!isWireRequestIdShape(p.requestId)) return false;';

/** Every retired spelling, plus the variants a spelling-based guard would miss. */
const MUTANTS = [
  ["!== undefined (the 33-site spelling)", "if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;"],
  ['!= undefined (loose equality)', "if (p.requestId != undefined && typeof p.requestId != 'string') return false;"],
  ['=== undefined', 'if (p.requestId === undefined) return false;'],
  ["typeof === 'string'", "if (typeof p.requestId === 'string') return false;"],
  ['typeof with double quotes', 'if (typeof p.requestId !== "string") return false;'],
  ['truthiness (negation)', 'if (!p.requestId) return false;'],
  ['truthiness (ternary)', "const rid = p.requestId ? p.requestId : '';"],
  ['truthiness (&&)', 'if (p.requestId && true) return false;'],
  ['truthiness (||)', 'if (p.requestId || false) return false;'],
  ['Boolean() coercion', 'if (!Boolean(p.requestId)) return false;'],
  ['isNonEmptyString()', 'if (!isNonEmptyString(p.requestId)) return false;'],
  ["comparison against ''", "if (p.requestId === '') return false;"],
  ['optional chain through a payload', "if (typeof msg?.payload?.requestId !== 'string') return false;"],
  ['bracket access', "if (typeof p['requestId'] !== 'string') return false;"],
];

test('mutation battery: every re-introduced spelling is caught BY THIS DETECTOR', () => {
  const base = READ.get(VALIDATE_REL);
  assert.ok(base.includes(ANCHOR), `anchor missing from ${VALIDATE_REL} — the battery cannot splice`);

  // NEGATIVE CONTROL: the unmutated file must be clean, or every "caught"
  // below would be caught for the wrong reason.
  assert.deepEqual(findOpenCodedDecisions(base), []);

  for (const [label, spelling] of MUTANTS) {
    const mutated = base.replace(ANCHOR, spelling);
    // 🔴 APPLIED?  Length equality would be a false negative for a same-length
    // spelling, so assert on CONTENT and on the occurrence count moving.
    assert.notEqual(mutated, base, `${label}: mutation did not apply`);
    assert.ok(mutated.includes(spelling), `${label}: mutant text absent after splice`);
    assert.equal(
      (mutated.match(new RegExp(ANCHOR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length,
      32,
      `${label}: expected exactly one of the 33 anchors to be replaced`,
    );

    const hits = findOpenCodedDecisions(mutated);
    assert.ok(
      hits.length > 0,
      `${label}: SURVIVED — the detector cannot see \`${spelling}\``,
    );
    assert.ok(
      hits.some((h) => h.text.includes(spelling.trim().replace(/\s+/g, ' '))),
      `${label}: the detector flagged something, but not the mutant line — ` +
        `caught for the wrong reason:\n  ${hits.map((h) => `${h.line}: ${h.text}`).join('\n  ')}`,
    );
  }
});

test('mutation battery: the ALIAS limit is real, and is the stated hole', () => {
  // Not a passing feature — a documented blind spot, pinned so the docblock
  // above cannot drift into claiming coverage it does not have.
  const base = READ.get(VALIDATE_REL);
  const aliased = base.replace(
    ANCHOR,
    "const rid = p.requestId; if (typeof rid !== 'string') return false;",
  );
  assert.notEqual(aliased, base, 'alias mutation did not apply');
  const hits = findOpenCodedDecisions(aliased);
  assert.deepEqual(
    hits,
    [],
    'the alias mutant was CAUGHT — good news, but the docblock now understates ' +
      'the guard; update the "What it CANNOT see" section.',
  );
});

test('comments are invisible to the detector (a retired spelling quoted in prose)', () => {
  // Several docblocks quote `...(requestId ? { requestId } : {})` verbatim. If
  // comments were not stripped, this guard would be permanently red on prose.
  const quoted = `/* ...(requestId ? { requestId } : {}) and typeof p.requestId !== 'string' */\nconst x = 1;\n`;
  assert.deepEqual(findOpenCodedDecisions(quoted), []);
  // POSITIVE CONTROL for the same input: uncommented, it IS seen.
  const uncommented = "const ok = typeof p.requestId !== 'string';\n";
  assert.equal(findOpenCodedDecisions(uncommented).length, 1);
});
