#!/usr/bin/env node
/**
 * test-readme-snippet-gate.mjs
 * ----------------------------
 * The CONTROLS for `typecheck-readme-snippets.mjs`.
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
 * 🔴 NO TRACKED FILE IS EVER WRITTEN. An earlier revision mutated
 * `packages/civitai-blocks-react/README.md` in place and restored it in a
 * `finally`. `finally` does not run on SIGINT, and this suite takes minutes, so
 * a Ctrl-C left the tracked doc modified with a bogus identifier — measured:
 * `kill -INT` mid-run left 3 occurrences behind, and the old "could not restore"
 * guard never printed because it lives in the block that did not run. Each
 * control now COPIES the doc into an OS temp dir, mutates the copy, and points
 * the gate at it with `README_SNIPPET_DOCS`. An interrupt can now lose nothing
 * but a temp file. (A doc's location does not change its verdict — snippets are
 * compiled in a scratch dir either way — so the copy is a faithful substitute.)
 *
 * WHAT IT ASSERTS, and WHICH CONTROLS ACTUALLY DISCRIMINATE THE FIX
 *   POSITIVE  the unmodified tree passes AND the runner reports a NON-ZERO count
 *             of BOTH value and type-only exports. A zero on either half means
 *             that half resolved nothing and every name it should have covered
 *             is silently shimmed to `any` again — indistinguishable, from the
 *             "0 failed" line alone, from a healthy run.
 *
 *   NC1       an INVARIANT GUARD, *not* regression coverage. A documented type
 *             name that does not exist, in a snippet that IMPORTS it, must FAIL
 *             — but it fails at the PRE-FIX gate too (measured: pre-fix
 *             `1 failed`, post-fix `1 failed`), because an unresolvable IMPORT
 *             was always a hard error. It pins that the consent snippet's
 *             `import type` line is real; it says nothing about the type map.
 *
 *   NC2       DISCRIMINATING. A real SDK `interface` used WITHOUT an import,
 *             with a value the real type forbids. Green at the pre-fix gate
 *             (`45 found · 44 passed · 0 failed`), red here. This is the one the
 *             type-export map bought.
 *
 *   NC3       DISCRIMINATING, and constructed differently from NC2 on purpose.
 *             Same shape but on a `type` ALIAS (`ConsentUnavailableReason`)
 *             rather than an `interface`. `SymbolFlags.Type` covers both, so a
 *             narrowing that dropped either half would leave the other green —
 *             NC2 alone cannot see an interface-only regression and NC3 alone
 *             cannot see an alias-only one.
 *
 * WHAT THIS GATE STILL DOES NOT COVER — asserted, not merely narrated, by NC4
 * and NC5 below, so the non-guarantee cannot silently become a guarantee (or
 * silently stay one). The runner deliberately AUTO-IMPORTS a known SDK export a
 * snippet references but does not import, so one-line reference fragments still
 * validate. A MISSING `import` LINE IS THEREFORE NOT A FAILURE (NC4), and
 * neither is a nonexistent type name that is ALSO not imported — nothing
 * resolves it, so it still falls back to the `any` shim (NC5). The gate proves a
 * name it RESOLVES is used correctly; it does not prove a fenced block is
 * copy-pasteable on its own.
 *
 * USAGE
 *   node scripts/test-readme-snippet-gate.mjs
 *   Requires the packages to be BUILT (same prerequisite as the gate itself).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const GATE = join(repoRoot, 'scripts/typecheck-readme-snippets.mjs');

const TARGET = join(repoRoot, 'packages/civitai-blocks-react/README.md');
const REL = TARGET.replace(repoRoot + '/', '');
const REAL_INTERFACE = 'ConsentUnavailablePayload';
const REAL_ALIAS = 'ConsentUnavailableReason';
const BOGUS_NAME = 'ConsentUnavailablePayloadDOESNOTEXIST';

// Every mutated doc lives here — OUTSIDE the repo, so an interrupt cannot leave
// a tracked file dirty. Best-effort cleanup on the way out; an abandoned temp
// file is inert either way.
const scratch = mkdtempSync(join(tmpdir(), 'readme-gate-selftest-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

/**
 * Run the real gate. `docs` (absolute paths) replaces the gate's default doc
 * list via `README_SNIPPET_DOCS`; omit it to check the real tree.
 */
function runGate(docs) {
  const env = { ...process.env };
  if (docs) env.README_SNIPPET_DOCS = docs.join('\n');
  else delete env.README_SNIPPET_DOCS;
  try {
    const out = execFileSync(process.execPath, [GATE], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      env,
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

/**
 * Write `fn(<the real doc>)` to a temp COPY and run the gate against that copy
 * only. The tracked doc is READ and never written.
 */
let copyN = 0;
function withMutatedCopy(fn) {
  const copy = join(scratch, `README-${++copyN}.md`);
  writeFileSync(copy, fn(readFileSync(TARGET, 'utf8')));
  return runGate([copy]);
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

/** A self-contained fenced block naming `type` and assigning `value` to it. */
function probeBlock(type, value) {
  return [
    '',
    '<!-- test-readme-snippet-gate.mjs scratch block -->',
    '```ts',
    `const probe: ${type} = ${value};`,
    '```',
    '',
  ].join('\n');
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
console.log(
  `\nNC1 (INVARIANT GUARD — also red at the pre-fix gate) — an IMPORTED type name that does not exist must FAIL`,
);
const original = readFileSync(TARGET, 'utf8');
const occurrences = original.split(REAL_INTERFACE).length - 1;
check(`\`${REAL_INTERFACE}\` appears in ${REL} (${occurrences}×)`, occurrences > 0);
if (occurrences > 0) {
  const nc1 = withMutatedCopy((s) => s.split(REAL_INTERFACE).join(BOGUS_NAME));
  check('gate FAILS on the nonexistent type name', !nc1.ok);
  check(
    'the failure NAMES the bogus identifier',
    nc1.out.includes(BOGUS_NAME),
    'went red for an unrelated reason — the control proves nothing',
  );
}

// ------------------------------------------------------------------- NC2
// A real SDK INTERFACE named without an import, assigned a `reason` the real
// literal union forbids. Against the pre-fix `any` shim this compiled.
console.log(
  `\nNC2 (DISCRIMINATING) — an un-imported SDK INTERFACE must be checked against the REAL type`,
);
const nc2 = withMutatedCopy(
  (s) => s + probeBlock(REAL_INTERFACE, `{ reason: 'NOT_A_REAL_REASON', scopes: [] }`),
);
check('gate FAILS on a value the real interface forbids', !nc2.ok);
check(
  'the failure names the forbidden literal',
  nc2.out.includes('NOT_A_REAL_REASON'),
  'went red for an unrelated reason — the control proves nothing',
);

// ------------------------------------------------------------------- NC3
// Same shape as NC2 but on a `type` ALIAS. Built differently on purpose: a
// narrowing of the type-map predicate that kept interfaces and dropped aliases
// (or vice versa) leaves exactly one of NC2/NC3 green.
console.log(
  `\nNC3 (DISCRIMINATING) — an un-imported SDK type ALIAS must be checked against the REAL type`,
);
const nc3 = withMutatedCopy((s) => s + probeBlock(REAL_ALIAS, `'NOT_A_REAL_REASON'`));
check('gate FAILS on a value the real alias forbids', !nc3.ok);
check(
  'the failure names the forbidden literal',
  nc3.out.includes('NOT_A_REAL_REASON'),
  'went red for an unrelated reason — the control proves nothing',
);

// ------------------------------------------------- NC4/NC5: the NON-guarantees
// These two assert what the gate does NOT do. They are here so the boundary is
// mechanised in both directions: if someone later tightens the runner so a
// missing import IS a failure, these go red and the header above gets corrected
// with them, rather than the doc quietly describing a gate that changed.
console.log(`\nNC4 (NON-guarantee) — removing a snippet's own \`import type\` line must still PASS`);
const nc4 = withMutatedCopy((s) =>
  s.replace(`import type { ${REAL_INTERFACE} } from '@civitai/app-sdk/blocks';\n`, ''),
);
check(
  'gate PASSES with the import line removed (auto-import covers it)',
  nc4.ok,
  'the runner no longer auto-imports — UPDATE the header of both scripts',
);

console.log(
  `\nNC5 (NON-guarantee) — a nonexistent type name that is ALSO not imported must still PASS`,
);
const nc5 = withMutatedCopy(
  (s) => s + probeBlock(BOGUS_NAME, `{ reason: 'ungrantable', scopes: [] }`),
);
check(
  'gate PASSES on an un-imported nonexistent type (falls back to the `any` shim)',
  nc5.ok,
  'the `any` fallback is gone — UPDATE the header of both scripts',
);

console.log(
  `\nreadme-snippet gate self-test: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`,
);
if (failures.length) process.exit(1);
