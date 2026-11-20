/**
 * The idempotency-key format rule has ONE definition, and every surface that
 * tells a developer about it actually says the constraining part.
 *
 * WHY THIS EXISTS
 * ===============
 * Two production defects, one week, same cause — a rule the host enforces that
 * nothing in this repo modelled or documented:
 *
 *   1. A block composed `sheetId:panelId:nonce`. 201 local tests green; every
 *      save 400'd with `invalid_format` /
 *      `must match pattern /^[A-Za-z0-9_-]{1,64}$/`.
 *   2. `TipButton` — FIRST-PARTY, exported code — composed
 *      `${useId()}:${toUserId}:${amount}:${entityType}:${entityId}` and always
 *      supplies a key, so every tip it posted was rejected the same way.
 *
 * And a third surface that would have caused a fourth: `useTip`'s own `@example`
 * recommended `React.useId()` as the key, whose value is colon- or
 * guillemet-wrapped on most of the React versions the peer range admits.
 *
 * 🔴 THE PRE-EXISTING TEST COVERED THE HALF THAT CANNOT FAIL.
 * `transport-helpers.test.ts` already held a thorough comment naming the host
 * constant and a `SERVER_CHARSET` regex — but it was a LOCAL const asserted only
 * against the SDK's own generator, and `crypto.randomUUID()` / the
 * `idem-<base36>` fallback both conform by construction. So it could not fail,
 * and read as coverage while providing none.
 *
 * WHAT THIS PINS, and what it deliberately does not
 * =================================================
 * Rule 1 is STRUCTURAL: exactly one definition of the pattern in shipped source.
 * Rule 2 is a DOC-CONTENT rule over the three public `idempotencyKey` JSDocs.
 *
 * 🔴 RULE 2 IS A GUARD ON WORDS, AND IS THEREFORE WALKABLE BY REWORDING. It
 * cannot tell a correct explanation from a plausible-sounding one; it only fails
 * when the constraining FACTS stop being mentioned at all. That is still worth
 * having — the measured starting state was 6/12/6 mentions of "idempotency"
 * across those three blocks against **zero** mentions of the charset — but do
 * not read a green here as "the docs are right". The behavioural claims live in
 * `packages/civitai-blocks-react/test/transport-helpers.test.ts`,
 * `test/mockHostIdempotency.test.tsx` and `test/TipButton.test.tsx`.
 *
 * It also does NOT scan: `CHANGELOG.md` or `.changeset/*.md` (history, which
 * must not be rewritten to satisfy a guard), `claudedocs/`, `tests/` (this file
 * spells the pattern as test data), or the vendoring module's own body.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The single site allowed to spell the pattern. */
const VENDOR_MODULE = 'packages/civitai-app-sdk/src/blocks/idempotency.ts';

/** Packages whose shipped source is scanned for a duplicate definition. */
const SCANNED_SRC = [
  'packages/civitai-app-sdk/src',
  'packages/civitai-blocks-react/src',
  'packages/civitai-components/src',
  'packages/civitai-components-react/src',
  'packages/civitai-theme/src',
];

/**
 * A REGEX LITERAL equal to the host rule, in any of the spellings someone would
 * plausibly re-type it in. Matches the literal only — prose quoting the pattern
 * inside a comment is how the rule gets EXPLAINED, which is the thing rule 2
 * requires, so banning that would make the two rules contradict each other.
 */
const PATTERN_LITERAL = /\/\^\[A-Za-z0-9_-\]\{1,\s*64\}\$\//;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments, so a literal inside an explanatory comment is not a definition. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

test('CONTROL — the pattern matcher can say both yes and no', () => {
  assert.ok(PATTERN_LITERAL.test('const X = /^[A-Za-z0-9_-]{1,64}$/;'), 'must match the real literal');
  assert.ok(PATTERN_LITERAL.test('/^[A-Za-z0-9_-]{1, 64}$/'), 'must match a spaced variant');
  assert.ok(!PATTERN_LITERAL.test('const X = /^[A-Za-z0-9_-]+$/;'), 'the orchestrator pattern is a DIFFERENT rule');
  assert.ok(!PATTERN_LITERAL.test('nothing here'), 'must be able to answer no');
});

test('CONTROL — the comment stripper removes comments and keeps code', () => {
  assert.equal(codeOnly('/* /^[A-Za-z0-9_-]{1,64}$/ */ const a = 1;').includes('A-Za-z'), false);
  assert.equal(codeOnly('// /^[A-Za-z0-9_-]{1,64}$/\nconst a = 1;').includes('A-Za-z'), false);
  assert.ok(codeOnly('const X = /^[A-Za-z0-9_-]{1,64}$/;').includes('A-Za-z'));
});

test('RULE 1 — the host pattern is DEFINED in exactly one shipped module', () => {
  const offenders = [];
  let vendorSeen = false;

  for (const root of SCANNED_SRC) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, file);
      if (!PATTERN_LITERAL.test(codeOnly(readFileSync(file, 'utf8')))) continue;
      if (rel === VENDOR_MODULE) {
        vendorSeen = true;
        continue;
      }
      offenders.push(rel);
    }
  }

  // POSITIVE CONTROL. Without it a rename of the vendor module makes this test
  // pass by finding nothing at all — the reassuring zero this repo keeps getting
  // bitten by.
  assert.ok(
    vendorSeen,
    `${VENDOR_MODULE} does not define ${PATTERN_LITERAL} — either it moved (update\n` +
      `VENDOR_MODULE) or the rule stopped being vendored. Until this is true, the\n` +
      `assertion below is vacuous.`,
  );

  assert.deepEqual(
    offenders,
    [],
    `the idempotency-key pattern is defined in more than one place:\n\n` +
      `    ${offenders.join('\n    ')}\n\n` +
      `The host owns this rule and the SDK cannot change it, so a second copy can only\n` +
      `ever DRIFT from it — which is the defect this whole arc is about (a block's own\n` +
      `copy of a composite-key convention 400'd every save, with 201 tests green).\n` +
      `Import { BLOCK_IDEMPOTENCY_KEY_REGEX, isValidBlockIdempotencyKey } from\n` +
      `'@civitai/app-sdk/blocks' instead.\n\n` +
      `NOTE a coincidentally-identical regex governing a DIFFERENT concern is not a\n` +
      `duplicate and must not be merged into this one — see\n` +
      `packages/civitai-components-chat/src/tools/host.ts, whose \`NAME\` constrains LLM\n` +
      `TOOL NAMES. If you are adding such a case, give it its own name and bound and\n` +
      `add its package to an explicit exemption here, with the reason.`,
  );
});

/**
 * The three PUBLIC `idempotencyKey` option JSDocs. These are what
 * `civitai-developer-docs` generates its hook reference from, so a constraint
 * absent here cannot reach the published docs at all.
 */
const DOCUMENTED_OPTION_SITES = [
  ['packages/civitai-blocks-react/src/hooks/useBuzzWorkflow.ts', 'SubmitWorkflowOptions'],
  ['packages/civitai-blocks-react/src/hooks/useGoodPurchase.ts', 'GoodPurchaseOptions'],
  ['packages/civitai-blocks-react/src/hooks/useTip.ts', 'TipOptions'],
];

/** The JSDoc block immediately preceding `idempotencyKey?: string;` in `src`. */
function idempotencyKeyDoc(src) {
  const at = src.indexOf('idempotencyKey?: string;');
  if (at === -1) return null;
  const open = src.lastIndexOf('/**', at);
  const close = src.indexOf('*/', open);
  if (open === -1 || close === -1 || close > at) return null;
  return src.slice(open, close);
}

test('RULE 2 — every public idempotencyKey JSDoc states the CONSTRAINING facts', () => {
  for (const [rel, iface] of DOCUMENTED_OPTION_SITES) {
    const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
    const doc = idempotencyKeyDoc(src);
    assert.ok(doc, `${rel}: could not locate the idempotencyKey JSDoc (${iface}) — did the field move?`);

    // Each fact is asserted SEPARATELY so the failure names the missing one.
    // Measured starting state: all three mentioned "idempotency" repeatedly
    // (6/12/6) and the charset ZERO times.
    const facts = [
      ['the allowed character class', /A-Za-z0-9_-/],
      ['the 64-character bound', /\b64\b/],
      ['that colons are excluded', /colon/i],
      ['that the host rejects otherwise (a 400)', /\b400\b/],
    ];
    for (const [what, re] of facts) {
      assert.ok(
        re.test(doc),
        `${rel} — ${iface}.idempotencyKey's JSDoc does not state ${what}.\n\n` +
          `This block is GENERATED INTO the public developer docs, so a constraint missing\n` +
          `here is missing for every app author. State: letters/digits/underscore/hyphen\n` +
          `only, at most 64 characters, NO COLONS, and that the host answers 400 otherwise.\n` +
          `Use the error envelope that matches the path (the bridge answers\n` +
          `\`invalid_format\`; the REST routes answer \`"Invalid request body"\` + a zod\n` +
          `flatten()).`,
      );
    }
  }
});

test('RULE 3 — no JSDoc @example recommends React.useId() as an idempotency key', () => {
  // The measured defect: `useTip`'s own example said
  // `const key = React.useId(); // stable across this component's retries`.
  // `useId()` is colon-wrapped on React 18.3.1 (":R0:") and guillemet-wrapped on
  // early React 19 — both fail the charset — so anyone copying it shipped a
  // guaranteed 400. React 19.2.6 happens to return `_r_0_`, which is exactly why
  // this was invisible in-repo and needs a guard rather than a test run.
  const offenders = [];
  for (const root of SCANNED_SRC) {
    for (const file of walk(join(REPO_ROOT, root))) {
      const src = readFileSync(file, 'utf8');
      // Only inside comments — a component legitimately CALLING useId() (as
      // TipButton does, for a seed it then normalises) is not the hazard.
      for (const block of src.match(/\/\*\*[\s\S]*?\*\//g) ?? []) {
        if (!/useId\s*\(/.test(block)) continue;
        if (!/idempotencyKey/i.test(block)) continue;
        // An explicit warning ABOUT the hazard is the fix, not the defect.
        if (/never|not|defect|fails|instead|do not|wrong/i.test(block)) continue;
        offenders.push(relative(REPO_ROOT, file));
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `a JSDoc example pairs useId() with idempotencyKey without warning against it:\n\n` +
      `    ${offenders.join('\n    ')}\n\n` +
      `useId()'s value is colon- or guillemet-wrapped on most React versions this\n` +
      `package's peer range admits, so it fails the host charset and 400s. Recommend a\n` +
      `stable domain id, or generateIdempotencyKey(). Do NOT recommend post-processing\n` +
      `useId() into shape — sanitising an idempotency key is the thing this SDK refuses\n` +
      `to do, because a rewritten key breaks the identity it exists to carry.`,
  );
});
