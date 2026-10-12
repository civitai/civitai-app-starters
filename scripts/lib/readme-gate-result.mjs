/**
 * readme-gate-result.mjs
 * ----------------------
 * The RESULT RECORD `scripts/typecheck-readme-snippets.mjs` leaves behind after
 * a run over the default docs, and the fingerprint that says whether that record
 * still describes the tree in front of you.
 *
 * WHY IT EXISTS. `scripts/test-readme-snippet-gate.mjs` opens with a positive
 * control — "the unmodified tree passes, and the runner resolved a non-zero
 * number of value AND type exports". In CI that control ran immediately after
 * `pnpm typecheck:readme`, on the same checkout, so it was an exact repeat of
 * the step before it: the same docs, the same declarations, the same answer,
 * paid for twice. The gate now writes what it found, and the self-test reads
 * that instead of asking again.
 *
 * 🔴 A RECORD IS ONLY EVIDENCE ABOUT THE TREE IT WAS TAKEN FROM. The self-test
 * therefore never trusts the file by its presence: it recomputes `fingerprint()`
 * and reuses the record only on an exact match. Anything else — no file, an
 * unparseable file, a different schema, a different fingerprint — means "the
 * gate has not run on THIS tree", and the self-test runs it. A stale record can
 * cost time; it cannot produce a pass.
 *
 * WHAT THE FINGERPRINT COVERS, and what it deliberately does not:
 *   - every checked doc's bytes            (a doc edit invalidates the record)
 *   - the gate's own source files          (a gate edit invalidates the record)
 *   - every built `.d.ts` under the dists  (a rebuild that changes a declaration
 *     the gate resolves against              invalidates the record)
 *   - `pnpm-lock.yaml`                     (a dependency bump — `typescript`,
 *                                            `@types/react` — invalidates it)
 *   It does NOT hash `node_modules`. A hand-edited installed package with an
 *   unchanged lockfile is invisible to it; `rm` the record (it lives under
 *   `node_modules/.cache/`) or just run `pnpm typecheck:readme` again.
 *
 * This module is imported by BOTH scripts so the fingerprint is one function,
 * not two that must agree.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

/**
 * The gate's own source files and the declaration trees it resolves against —
 * listed HERE, once, so the writer and the reader cannot fingerprint different
 * sets. Add a file to the gate, add it to `GATE_SOURCES`.
 */
export const GATE_SOURCES = [
  'scripts/typecheck-readme-snippets.mjs',
  'scripts/lib/readme-gate-result.mjs',
];
export const DIST_DIRS = [
  'packages/civitai-app-sdk/dist',
  'packages/civitai-blocks-react/dist',
  'packages/civitai-sdk/dist',
];

/** Bumped whenever the record's shape changes; a mismatch is "not reusable". */
export const RESULT_SCHEMA = 1;

/**
 * Under `node_modules/` on purpose: already gitignored, already per-checkout
 * (a git worktree has its own), and never published.
 */
export const RESULT_FILE = join(repoRoot, 'node_modules/.cache/readme-snippet-gate/last-run.json');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Every `*.d.ts` under `dir`, sorted, as repo-relative paths. */
function declarationFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue;
    // `parentPath` is the current name; `path` is what older Node 20 called it.
    out.push(relative(repoRoot, join(entry.parentPath ?? entry.path, entry.name)));
  }
  return out.sort();
}

/**
 * One digest over everything a default-docs verdict depends on. A file that is
 * absent contributes the literal `MISSING`, so "the doc was deleted" and "the
 * doc is empty" are different fingerprints.
 *
 * @param {{ docs: string[], gateSources?: string[], distDirs?: string[] }} inputs
 *   repo-relative paths.
 */
export function fingerprint({ docs, gateSources = GATE_SOURCES, distDirs = DIST_DIRS }) {
  const h = createHash('sha256');
  const add = (label, rel) => {
    const abs = resolve(repoRoot, rel);
    h.update(`${label}\0${rel}\0${existsSync(abs) ? sha256(readFileSync(abs)) : 'MISSING'}\n`);
  };
  for (const rel of docs) add('doc', rel);
  for (const rel of gateSources) add('gate', rel);
  for (const dir of distDirs) {
    const files = declarationFiles(resolve(repoRoot, dir));
    h.update(`dist\0${dir}\0${files.length}\n`);
    for (const rel of files) add('dts', rel);
  }
  add('lock', 'pnpm-lock.yaml');
  return h.digest('hex');
}

/** Remove the record. Called at the START of a default-docs run, so a run that
 *  crashes half way leaves NO record rather than the previous run's. */
export function clearResult() {
  rmSync(RESULT_FILE, { force: true });
}

export function writeResult(record) {
  mkdirSync(dirname(RESULT_FILE), { recursive: true });
  writeFileSync(RESULT_FILE, JSON.stringify({ schema: RESULT_SCHEMA, ...record }, null, 2) + '\n');
}

/**
 * Read the record back. Never throws: every way of not having a usable record
 * is reported as `{ record: null, why }` so the caller can print the reason and
 * fall back to running the gate.
 */
export function readResult() {
  if (!existsSync(RESULT_FILE)) return { record: null, why: 'no result record on disk' };
  let record;
  try {
    record = JSON.parse(readFileSync(RESULT_FILE, 'utf8'));
  } catch (err) {
    return { record: null, why: `result record is not valid JSON (${err.message})` };
  }
  if (record === null || typeof record !== 'object' || record.schema !== RESULT_SCHEMA) {
    return { record: null, why: `result record has schema ${record?.schema}, expected ${RESULT_SCHEMA}` };
  }
  return { record, why: '' };
}
