#!/usr/bin/env node
/**
 * test-readme-snippet-gate.mjs
 * ----------------------------
 * The NEGATIVE CONTROLS for `typecheck-readme-snippets.mjs`.
 *
 * 🔴 WHY THIS EXISTS. That runner's whole job is to answer "does this README
 * snippet compile?", and for TYPE-ONLY identifiers it used to answer "yes"
 * without looking. Its auto-import map was built from `SymbolFlags.Value`
 * exports only, so every `interface`/`type` in the SDK fell through to the
 * free-identifier fallback — `declare const X: any; type X = any;` — and any
 * snippet naming an SDK type it had not imported was checked against `any`
 * rather than against the type. A verdict nobody has watched go red is a claim
 * about the command line, so the fix ships with the controls that prove it can.
 *
 * Each control mutates a real doc in place, runs the REAL gate, restores the
 * file byte-for-byte, and asserts the verdict.
 *
 * WHAT IT ASSERTS
 *   POSITIVE  the unmodified tree passes AND the runner reports a NON-ZERO count
 *             of BOTH value and type-only exports. A zero on either half means
 *             that half resolved nothing and every name it should have covered
 *             is silently shimmed to `any` again — indistinguishable, from the
 *             "0 failed" line alone, from a healthy run.
 *   NC1       a documented type name that does not exist FAILS, naming the bogus
 *             identifier. This one holds because the snippet carries an explicit
 *             `import type` — an unresolvable IMPORT is a hard error. It is the
 *             mechanised check that the consent snippet's import is real.
 *   NC2       an SDK type used WITHOUT an import, with a value the real type
 *             forbids, FAILS. This is the one the type-export map bought:
 *             measured on this repo, the pre-fix runner reported `43 passed · 0
 *             failed` for exactly this input.
 *
 * WHAT THIS GATE STILL DOES NOT COVER — printed by the run, so nobody over-reads
 * a pass. The runner deliberately AUTO-IMPORTS a known SDK export a snippet
 * references but does not import, so that one-line reference fragments still
 * validate. A MISSING `import` LINE IS THEREFORE NOT A FAILURE, and neither is a
 * nonexistent type name that is also not imported (nothing resolves it, so it
 * still falls back to the `any` shim). The gate proves a name RESOLVES TO A REAL
 * EXPORT AND IS USED CORRECTLY; it does not prove a fenced block is
 * copy-pasteable on its own.
 *
 * USAGE
 *   node scripts/test-readme-snippet-gate.mjs
 *   Requires the packages to be BUILT (same prerequisite as the gate itself).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const GATE = join(repoRoot, 'scripts/typecheck-readme-snippets.mjs');

const TARGET = join(repoRoot, 'packages/civitai-blocks-react/README.md');
const REL = TARGET.replace(repoRoot + '/', '');
const REAL_NAME = 'ConsentUnavailablePayload';
const BOGUS_NAME = 'ConsentUnavailablePayloadDOESNOTEXIST';

function runGate() {
  try {
    const out = execFileSync(process.execPath, [GATE], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

const failures = [];
function check(label, cond, detail = '') {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

/** Mutate TARGET with `fn`, run the gate, restore byte-for-byte, return the run. */
function withMutation(fn) {
  const original = readFileSync(TARGET, 'utf8');
  try {
    writeFileSync(TARGET, fn(original));
    return runGate();
  } finally {
    writeFileSync(TARGET, original);
    if (readFileSync(TARGET, 'utf8') !== original) {
      console.error(`FATAL: could not restore ${REL}`);
      process.exit(2);
    }
  }
}

// ---------------------------------------------------------------- positive
console.log('positive control — the unmodified tree');
const positive = runGate();
check('gate passes on the unmodified tree', positive.ok, positive.out.slice(-2000));

const counts = positive.out.match(/Resolved (\d+) SDK value exports and (\d+) type-only exports/);
check('runner reports its resolved-export counts', counts !== null);
if (counts) {
  check(
    `value-export map is non-empty (${counts[1]})`,
    Number(counts[1]) > 0,
    'a zero here means auto-import resolved nothing',
  );
  check(
    `type-only export map is non-empty (${counts[2]})`,
    Number(counts[2]) > 0,
    'a zero here means every type name is still falling back to an `any` shim',
  );
}

// ------------------------------------------------------------------- NC1
console.log(`\nNC1 — a documented type name that does not exist must FAIL`);
const original = readFileSync(TARGET, 'utf8');
const occurrences = original.split(REAL_NAME).length - 1;
check(`\`${REAL_NAME}\` appears in ${REL} (${occurrences}×)`, occurrences > 0);
if (occurrences > 0) {
  const nc1 = withMutation((s) => s.split(REAL_NAME).join(BOGUS_NAME));
  check('gate FAILS on the nonexistent type name', !nc1.ok);
  check(
    'the failure NAMES the bogus identifier',
    nc1.out.includes(BOGUS_NAME),
    'went red for an unrelated reason — the control proves nothing',
  );
}

// ------------------------------------------------------------------- NC2
// A self-contained fenced block appended to the doc: it names a REAL SDK type it
// never imports, and assigns a `reason` the real literal union forbids. Against
// the pre-fix `any` shim this compiled; against the injected `import type` it
// cannot.
console.log(`\nNC2 — an un-imported SDK type must be checked against the REAL type`);
const NC2_BLOCK = [
  '',
  '<!-- test-readme-snippet-gate.mjs scratch block -->',
  '```ts',
  `const probe: ${REAL_NAME} = { reason: 'NOT_A_REAL_REASON', scopes: [] };`,
  '```',
  '',
].join('\n');
const nc2 = withMutation((s) => s + NC2_BLOCK);
check('gate FAILS on a value the real type forbids', !nc2.ok);
check(
  'the failure names the forbidden literal',
  nc2.out.includes('NOT_A_REAL_REASON'),
  'went red for an unrelated reason — the control proves nothing',
);

// ------------------------------------------------------- documented non-gap
// Informational, NOT an assertion: if someone later tightens the runner so a
// missing import IS a failure, this line changes and no control breaks.
const nc3 = withMutation((s) =>
  s.replace(`import type { ${REAL_NAME} } from '@civitai/app-sdk/blocks';\n`, ''),
);
console.log(
  `\nINFO  removing the snippet's own \`import type\` line: gate says ` +
    `${nc3.ok ? 'PASS' : 'FAIL'} — by design the runner auto-imports a known SDK ` +
    `export, so a missing import line is NOT gated. Copy-pasteability is a review\n` +
    `      concern, not a gate concern.`,
);

console.log(
  `\nreadme-snippet gate self-test: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`,
);
if (failures.length) process.exit(1);
