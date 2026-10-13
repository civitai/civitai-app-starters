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
 * control now writes its doc into an OS temp dir and points the gate at it with
 * `README_SNIPPET_DOCS`. An interrupt can now lose nothing but a temp file. (A
 * doc's location does not change its verdict — snippets are compiled in a
 * scratch dir either way — so a temp doc is a faithful substitute.)
 *
 * 🔴 EACH CONTROL DOC HOLDS ONLY THE SNIPPETS THAT CONTROL IS ABOUT. Every
 * control used to hand the gate a full copy of the 63-snippet README with one
 * snippet changed, so five controls recompiled the same 62 untouched snippets
 * five times over — and the gate compiles every snippet in ISOLATION, so those
 * 62 could not affect the one under test. What a control needs is the snippet
 * it mutates:
 *   - NC1 and NC4 mutate the REAL consent snippet, so they EXTRACT it from the
 *     tracked README at run time. Not a stand-in: a hand-written fixture could
 *     keep passing after the documented snippet changed shape, and these two
 *     are claims about the README's own `import type` line.
 *   - NC2, NC3 and NC5 are a synthetic one-line probe, appended to the README
 *     before and a whole doc of its own now.
 *
 * 🔴 AND A SMALL DOC NEEDS A FLOOR A LARGE ONE GOT FOR FREE. The gate exits 0
 * on a doc with no ts/tsx fence in it — "0 found · 0 failed". Against the full
 * README that could not happen by accident. Against a doc this script builds it
 * can: an extraction that matches nothing yields an empty doc, and an empty doc
 * PASSES, which is exactly what NC4 and NC5 assert. So every control also
 * requires the gate to report it FOUND the number of snippets the doc was built
 * with, and SKIPPED none of them — and the FLOOR control below feeds the gate a
 * zero-snippet doc to show that requirement refuses it.
 *
 * WHAT IT ASSERTS, and WHICH CONTROLS ACTUALLY DISCRIMINATE THE FIX
 *   POSITIVE  the unmodified tree passes AND the runner reports a NON-ZERO count
 *             of BOTH value and type-only exports. A zero on either half means
 *             that half resolved nothing and every name it should have covered
 *             is silently shimmed to `any` again — indistinguishable, from the
 *             "0 failed" line alone, from a healthy run.
 *
 *             The gate is RUN here, over the default docs — this control
 *             does not take the preceding CI step's word for it. (A revision
 *             of this script reused a result file the gate step wrote; the
 *             file's freshness check could not cover every input the verdict
 *             depends on, so a stale PASS was reusable. It was removed.)
 *
 *             Its snippet count is also cross-checked: the number of verdict
 *             lines the gate printed per doc must equal a count of ts/tsx
 *             fences this script makes itself, so a gate that found nothing —
 *             or fewer than there are — cannot pass. Scope: the docs the gate
 *             PRINTED a verdict for. A doc the gate no longer lists at all is
 *             invisible to this cross-check, except the blocks-react README,
 *             which is required by name.
 *
 *   FLOOR     the control on the controls: a doc with NO checkable snippet must
 *             be refused by the snippet-count floor every NC below applies.
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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// The consent snippet's own import, byte for byte. NC4 deletes this line and
// NC1 depends on it being there (an un-imported bogus name would PASS — NC5).
const IMPORT_LINE = `import type { ${REAL_INTERFACE} } from '@civitai/app-sdk/blocks';\n`;

// Every mutated doc lives here — OUTSIDE the repo, so an interrupt cannot leave
// a tracked file dirty. Best-effort cleanup on the way out; an abandoned temp
// file is inert either way.
const scratch = mkdtempSync(join(tmpdir(), 'readme-gate-selftest-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));

/** The gate's one-line run summary — the only place it states how many
 *  snippets it FOUND, as opposed to how many failed. */
const SUMMARY_RE = /README snippets: (\d+) found · (\d+) passed · (\d+) skipped · (\d+) failed/;

/**
 * Run the real gate. `docs` (absolute paths) replaces the gate's default doc
 * list via `README_SNIPPET_DOCS`; omit it to check the real tree.
 */
function runGate(docs) {
  const env = { ...process.env };
  if (docs) env.README_SNIPPET_DOCS = docs.join('\n');
  else delete env.README_SNIPPET_DOCS;
  let ok = true;
  let out;
  try {
    out = execFileSync(process.execPath, [GATE], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: 'pipe',
      env,
    });
  } catch (err) {
    ok = false;
    out = (err.stdout ?? '') + (err.stderr ?? '');
  }
  const m = out.match(SUMMARY_RE);
  const summary = m
    ? { found: Number(m[1]), passed: Number(m[2]), skipped: Number(m[3]), failed: Number(m[4]) }
    : null;
  return { ok, out, summary };
}

/**
 * Every ```ts / ```tsx fenced block in a markdown string, with its fences.
 *
 * Deliberately NOT imported from the gate: this is the independent count the
 * gate's own is checked against. If the two ever disagree about what a fence
 * is, the positive control says so instead of both being wrong together.
 */
function fencedBlocks(md) {
  const blocks = [];
  let open = null;
  for (const line of md.split('\n')) {
    if (open === null) {
      const fence = line.match(/^```(\w+)?/);
      if (fence) open = { lang: (fence[1] ?? '').toLowerCase(), lines: [] };
      continue;
    }
    if (/^```\s*$/.test(line)) {
      if (open.lang === 'ts' || open.lang === 'tsx') {
        const code = open.lines.join('\n');
        blocks.push({ lang: open.lang, code, fenced: `\`\`\`${open.lang}\n${code}\n\`\`\`` });
      }
      open = null;
      continue;
    }
    open.lines.push(line);
  }
  return blocks;
}

/** A control doc made of real README snippets, each still inside its fence. */
function docOf(blocks) {
  return ['<!-- test-readme-snippet-gate.mjs control doc -->', ...blocks.map((b) => b.fenced), ''].join(
    '\n\n',
  );
}

/**
 * Why a gate run does NOT show that `expected` snippets were compiled, or `''`
 * if it does. Exact, not "at least": this script built the doc, so any other
 * count means the doc is not what the control thinks it is.
 */
function floorViolation(run, expected) {
  if (run.summary === null) return 'the gate printed no `README snippets: N found` summary line';
  const { found, skipped } = run.summary;
  if (found !== expected) {
    return `the gate found ${found} snippet(s) in the control doc, expected ${expected} — the control compiled nothing it was built for`;
  }
  if (skipped !== 0) {
    return `the gate SKIPPED ${skipped} of the control doc's ${expected} snippet(s) — a skipped snippet is not checked`;
  }
  return '';
}

/**
 * Write `markdown` to a temp doc, run the gate against that doc only, and
 * assert the floor. The tracked README is READ by the callers and never
 * written.
 */
function runControl(name, markdown, expected) {
  const doc = join(scratch, `${name}.md`);
  writeFileSync(doc, markdown);
  const run = runGate([doc]);
  const why = floorViolation(run, expected);
  check(`the gate found and compiled the control doc's ${expected} snippet(s)`, why === '', why);
  return run;
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

/** A self-contained one-snippet doc naming `type` and assigning `value` to it. */
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

// The floor, on the real tree: the gate's verdict lines per doc against a
// count made here, by a different function, from the same files.
{
  const perDoc = new Map();
  for (const m of positive.out.matchAll(/^  (?:PASS|FAIL|SKIP)  (.+):\d+ \[tsx?\]/gm)) {
    perDoc.set(m[1], (perDoc.get(m[1]) ?? 0) + 1);
  }
  const disagreements = [];
  let independentTotal = 0;
  for (const [rel, found] of perDoc) {
    const abs = resolve(repoRoot, rel);
    const mine = existsSync(abs) ? fencedBlocks(readFileSync(abs, 'utf8')).length : 0;
    independentTotal += mine;
    if (mine !== found) disagreements.push(`${rel}: gate ${found}, this script ${mine}`);
  }
  const s = positive.summary;
  check(
    `the gate found every ts/tsx fence this script counts independently (${independentTotal} across ${perDoc.size} docs)`,
    disagreements.length === 0 && independentTotal > 0 && s !== null && s.found === independentTotal,
    disagreements.join('; ') || `gate summary ${s ? `${s.found} found` : 'missing'}, this script ${independentTotal}`,
  );
  check(
    `every found snippet has a verdict, and at least one was compiled (${s ? `${s.passed} passed · ${s.skipped} skipped · ${s.failed} failed` : 'no summary'})`,
    s !== null && s.passed + s.skipped + s.failed === s.found && s.passed > 0,
  );
  check(
    `${REL} is among the docs the gate checked (${perDoc.get(REL) ?? 0} snippets)`,
    (perDoc.get(REL) ?? 0) > 0,
    'NC1 and NC4 below extract their snippet from this doc',
  );
}

// ------------------------------------------------------------------ FLOOR
// The control on the controls. An unterminated fence is the realistic way to
// get here — the doc visibly "has a snippet in it" and the gate, correctly,
// extracts none — and the gate answers it with exit 0.
console.log(`\nFLOOR — a control doc the gate extracts NO snippet from must be refused`);
{
  const doc = join(scratch, 'FLOOR.md');
  writeFileSync(doc, ['```ts', `const probe: ${REAL_ALIAS} = 'NOT_A_REAL_REASON';`, ''].join('\n'));
  const run = runGate([doc]);
  const why = floorViolation(run, 1);
  check(
    `the snippet-count floor refuses it (gate said: ${run.summary ? `${run.summary.found} found` : 'no summary'}, exit ${run.ok ? 0 : 'non-zero'})`,
    why !== '',
    'the floor accepted a doc with nothing in it — every control below can pass vacuously',
  );
}

// ------------------------------------------------------------------- NC1
console.log(
  `\nNC1 (INVARIANT GUARD — also red at the pre-fix gate) — an IMPORTED type name that does not exist must FAIL`,
);
// The REAL snippets, read from the tracked README on every run.
const realBlocks = fencedBlocks(readFileSync(TARGET, 'utf8'));
const naming = realBlocks.filter((b) => b.code.includes(REAL_INTERFACE));
const importing = realBlocks.filter((b) => `${b.code}\n`.includes(IMPORT_LINE));
check(`\`${REAL_INTERFACE}\` appears in a snippet of ${REL} (${naming.length}×)`, naming.length > 0);
check(
  `a snippet of ${REL} IMPORTS it (${importing.length}×)`,
  importing.length > 0,
  'without the import this is NC5, which passes — the control would prove nothing',
);
if (naming.length > 0) {
  const nc1 = runControl('NC1', docOf(naming).split(REAL_INTERFACE).join(BOGUS_NAME), naming.length);
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
const nc2 = runControl(
  'NC2',
  probeBlock(REAL_INTERFACE, `{ reason: 'NOT_A_REAL_REASON', scopes: [] }`),
  1,
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
const nc3 = runControl('NC3', probeBlock(REAL_ALIAS, `'NOT_A_REAL_REASON'`), 1);
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
if (importing.length > 0) {
  const withoutImport = docOf(importing).split(IMPORT_LINE).join('');
  // The mutation has to have HAPPENED, and has to leave the name behind:
  // otherwise this is a doc the gate passes without auto-importing anything.
  check(
    `the import line is gone from the control doc and \`${REAL_INTERFACE}\` is still used in it`,
    !withoutImport.includes(IMPORT_LINE.trimEnd()) && withoutImport.includes(REAL_INTERFACE),
  );
  const nc4 = runControl('NC4', withoutImport, importing.length);
  check(
    'gate PASSES with the import line removed (auto-import covers it)',
    nc4.ok && nc4.summary?.passed === importing.length,
    'the runner no longer auto-imports — UPDATE the header of both scripts',
  );
}

console.log(
  `\nNC5 (NON-guarantee) — a nonexistent type name that is ALSO not imported must still PASS`,
);
const nc5 = runControl('NC5', probeBlock(BOGUS_NAME, `{ reason: 'ungrantable', scopes: [] }`), 1);
check(
  'gate PASSES on an un-imported nonexistent type (falls back to the `any` shim)',
  nc5.ok && nc5.summary?.passed === 1,
  'the `any` fallback is gone — UPDATE the header of both scripts',
);

console.log(
  `\nreadme-snippet gate self-test: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`,
);
if (failures.length) process.exit(1);
