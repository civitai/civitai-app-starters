#!/usr/bin/env node
/**
 * check-examples-validate.mjs
 * ---------------------------
 * Runs `civitai app validate --strict` on every `starters/examples/*` app, TWICE:
 *
 *   in-repo     the example directory as it sits in this checkout;
 *   standalone  a copy of ONLY its git-tracked files, in a temp dir outside the
 *               repo — what `npx tiged civitai/civitai-app-starters/starters/
 *               examples/<name>` hands a developer, and what `civitai app
 *               submit` would bundle from it.
 *
 * WHY THIS EXISTS
 * ===============
 * Nothing in CI ever validated, built or typechecked the examples. All six
 * failed `civitai app validate` (no committed lockfile; two also had an
 * unjustified sensitive scope), and `kv-storage` called `useAppStorage()` with
 * no storage scope declared — so every save would have been refused in
 * production while working against the local harness. Each defect was in a file
 * this repo owns, and each was visible to the CLI the docs tell people to run.
 *
 * The standalone pass is not a duplicate of the in-repo one. The in-repo
 * directory can hold files git does not (an uncommitted lockfile, a `dist/`),
 * so a pass there says nothing about what a copied-out example contains.
 *
 * WHAT FAILS (exit 1)
 * ===================
 *   - any validation ERROR, in either mode;
 *   - any WARNING not in ALLOWED_WARNINGS (this is what `--strict` means here —
 *     the JSON is read rather than the exit code, so an allowlisted warning can
 *     be told apart from a new one);
 *   - an ALLOWED_WARNINGS entry that no longer fires — a stale exemption is how
 *     an allowlist quietly grows into a mute button;
 *   - output that is not the CLI's JSON (a missing or broken CLI must not read
 *     as "no findings");
 *   - fewer than MIN_EXAMPLES examples found.
 *
 * USAGE
 *   node scripts/check-examples-validate.mjs              # or: pnpm check:examples-validate
 *   node scripts/check-examples-validate.mjs --self-test  # negative + positive control
 *   CIVITAI_BIN=/path/to/civitai …                        # default: `civitai` on PATH
 *   EXPECTED_CLI_VERSION=0.1.113 …                        # CI: fail if a different CLI ran
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const EXAMPLES_DIR = join(REPO_ROOT, 'starters', 'examples');
const CLI = process.env.CIVITAI_BIN || 'civitai';

/** Eleven examples exist. A drop means one left the scan; lower this in the same commit. */
const MIN_EXAMPLES = 11;

/**
 * Warnings that are known, understood and NOT a defect in the example.
 *
 * `ai:write:budgeted` without a `page` block: the CLI's advisory says budgeted
 * spend "is a full-page (W10) affordance". These two examples are MODEL-SLOT
 * blocks on purpose — they demonstrate `useBuzzWorkflow` / `useBuzzPurchase`
 * inside `model.sidebar_top` — and the host does mint budgeted tokens for a
 * model-slot install, sizing the per-generation budget from that install's
 * `buzz_budget_per_gen` setting (see `buzz-workflow/README.md`). Turning them
 * into page apps would change what they teach. Matched on field AND message
 * prefix, per example, so any OTHER warning on these two still fails.
 */
const ALLOWED_WARNINGS = [
  {
    example: 'buzz-workflow',
    field: 'page',
    prefix: 'scopes include "ai:write:budgeted" but no "page" block is declared',
  },
  {
    example: 'buzz-purchase',
    field: 'page',
    prefix: 'scopes include "ai:write:budgeted" but no "page" block is declared',
  },
];

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CIVITAI_NO_UPDATE_CHECK: '1', NO_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error };
}

function discoverExamples() {
  return readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(EXAMPLES_DIR, e.name, 'block.manifest.json')))
    .map((e) => e.name)
    .sort();
}

/** Copy the git-TRACKED files of `starters/examples/<name>` into a fresh temp dir. */
function copyTracked(name) {
  const relDir = relative(REPO_ROOT, join(EXAMPLES_DIR, name));
  const ls = run('git', ['ls-files', '-z', '--', relDir], REPO_ROOT);
  if (ls.status !== 0) throw new Error(`git ls-files failed for ${relDir}: ${ls.stderr.trim()}`);
  const files = ls.stdout.split('\0').filter(Boolean);
  if (files.length === 0) throw new Error(`${relDir}: no tracked files — nothing a copy would contain`);
  const dest = mkdtempSync(join(tmpdir(), `examples-validate-${name}-`));
  for (const f of files) {
    const src = join(REPO_ROOT, f);
    if (!existsSync(src) || !lstatSync(src).isFile()) continue;
    const target = join(dest, relative(relDir, f));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(src, target);
  }
  return dest;
}

/** Run the CLI on `dir`; returns { errors, warnings } or throws if it did not answer in JSON. */
function validate(dir) {
  const r = run(CLI, ['app', 'validate', '--json', '--strict', dir], REPO_ROOT);
  if (r.error) throw new Error(`could not run \`${CLI}\`: ${r.error.message}`);
  let result;
  try {
    result = JSON.parse(r.stdout);
  } catch {
    throw new Error(
      `\`${CLI} app validate --json\` did not print JSON (exit ${r.status}).\n${(r.stdout + r.stderr).trim().slice(0, 2000)}`,
    );
  }
  if (!Array.isArray(result.errors) || !Array.isArray(result.warnings)) {
    throw new Error(`unexpected JSON shape from \`${CLI} app validate\`: ${r.stdout.slice(0, 500)}`);
  }
  // Cross-check the two signals the CLI gives: a clean result must exit 0.
  const clean = result.errors.length === 0 && result.warnings.length === 0;
  if (clean && r.status !== 0) throw new Error(`validate reported no findings but exited ${r.status}`);
  return result;
}

function cliVersion() {
  const r = run(CLI, ['--version'], REPO_ROOT);
  if (r.error || r.status !== 0) {
    console.error(`ERROR: \`${CLI} --version\` failed — is the civitai CLI installed? ${r.error?.message ?? r.stderr}`);
    process.exit(1);
  }
  const v = (r.stdout.match(/\d+\.\d+\.\d+/) ?? [''])[0];
  const want = process.env.EXPECTED_CLI_VERSION;
  if (want && v !== want) {
    console.error(`ERROR: expected civitai CLI ${want}, found ${v || r.stdout.trim()}`);
    process.exit(1);
  }
  return v;
}

/**
 * Validate every example in both modes. Returns the list of failure lines (empty
 * = pass) and the counts the summary prints.
 */
function checkAll(names) {
  const failures = [];
  const fired = new Set(); // `${example}|${mode}|${index}` for each allowlist hit
  let allowed = 0;
  for (const name of names) {
    let copy = null;
    try {
      copy = copyTracked(name);
      for (const [mode, dir] of [
        ['in-repo', join(EXAMPLES_DIR, name)],
        ['standalone', copy],
      ]) {
        const { errors, warnings } = validate(dir);
        for (const e of errors) failures.push(`${name} [${mode}] ERROR ${e.field}: ${e.message}`);
        for (const w of warnings) {
          const i = ALLOWED_WARNINGS.findIndex(
            (a) => a.example === name && a.field === w.field && w.message.startsWith(a.prefix),
          );
          if (i === -1) failures.push(`${name} [${mode}] WARNING ${w.field}: ${w.message}`);
          else {
            allowed++;
            fired.add(`${name}|${mode}|${i}`);
          }
        }
        console.log(
          `${errors.length === 0 ? 'OK  ' : 'FAIL'} ${name} [${mode}] — ${errors.length} error(s), ${warnings.length} warning(s)`,
        );
      }
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    } finally {
      if (copy) rmSync(copy, { recursive: true, force: true });
    }
  }
  ALLOWED_WARNINGS.forEach((a, i) => {
    if (!names.includes(a.example)) return;
    for (const mode of ['in-repo', 'standalone']) {
      if (!fired.has(`${a.example}|${mode}|${i}`)) {
        failures.push(
          `${a.example} [${mode}] STALE ALLOWLIST ENTRY: "${a.prefix}" no longer fires — remove it from ALLOWED_WARNINGS`,
        );
      }
    }
  });
  return { failures, allowed };
}

function main() {
  const v = cliVersion();
  const names = discoverExamples();
  console.log(`civitai CLI ${v}; ${names.length} example(s): ${names.join(', ')}\n`);
  if (names.length < MIN_EXAMPLES) {
    console.error(`ERROR: found ${names.length} example(s) under starters/examples, expected at least ${MIN_EXAMPLES}.`);
    process.exit(1);
  }
  const { failures, allowed } = checkAll(names);
  if (failures.length > 0) {
    console.error(`\nERROR: ${failures.length} finding(s):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `\nOK: ${names.length} example(s) x 2 modes (in-repo + standalone copy) pass \`civitai app validate --strict\`` +
      ` — 0 errors, 0 unexpected warnings, ${allowed} allowlisted.`,
  );
}

/**
 * NEGATIVE + POSITIVE control. Builds a standalone copy of one example, proves
 * the unmodified copy validates clean, then deletes its lockfile and proves the
 * checker sees the lockfile error. A run that cannot go red is not evidence.
 */
function selfTest() {
  cliVersion();
  const name = 'hello-world';
  const copy = copyTracked(name);
  try {
    const clean = validate(copy);
    if (clean.errors.length !== 0) {
      console.error(`SELF-TEST FAILED: unmodified ${name} copy is not clean:`, clean.errors);
      process.exit(1);
    }
    unlinkSync(join(copy, 'package-lock.json'));
    const broken = validate(copy);
    if (!broken.errors.some((e) => /lockfile/i.test(e.message))) {
      console.error('SELF-TEST FAILED: deleting package-lock.json did not produce a lockfile error:', broken.errors);
      process.exit(1);
    }
    console.log(`self-test OK: clean copy -> 0 errors; copy without package-lock.json -> ${broken.errors.length} error(s), incl. the lockfile one`);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
}

if (process.argv.includes('--self-test')) selfTest();
else main();
