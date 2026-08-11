#!/usr/bin/env node
/**
 * check-starter-workspace-overrides.mjs
 * -------------------------------------
 * RELEASE-DEADLOCK GUARD. Offline, no network, no install.
 *
 * Asserts that every first-party `@civitai/*` dependency declared by a
 * `starters/**` package as a PUBLISHED SEMVER RANGE (e.g. `^0.32.0`) is also
 * listed in the root package.json `pnpm.overrides` mapped to a `workspace:`
 * protocol.
 *
 * WHY THIS EXISTS
 * ===============
 * The starters deliberately pin published caret ranges rather than
 * `workspace:*`, because they are copied OUT of this repo verbatim by
 * `npx tiged civitai/civitai-app-starters/starters/<name> my-app` (documented
 * in README.md, AGENTS.md, CLAUDE.md and every starter's own README). tiged is
 * a raw file copy -- nothing rewrites the deps on the way out -- so a
 * `workspace:` protocol in a starter's package.json produces a scaffolded
 * project whose `npm install` fails immediately. That was tried once and
 * reverted: `2a453e6` "fix(block-starter): pin @civitai deps to published
 * carets (not workspace:^) (#192)".
 *
 * But those same caret ranges are REWRITTEN by `changeset version` on every
 * release (changesets updates the ranges of workspace dependents even for
 * packages in `.changeset/config.json` `ignore` -- `ignore` only suppresses
 * versioning the package itself, not the dependency-range rewrite). The
 * Version Packages PR therefore asks for versions that are NOT PUBLISHED YET.
 *
 * Without an override that is a hard deadlock:
 *   - `pnpm install --lockfile-only` fails: ERR_PNPM_NO_MATCHING_VERSION
 *     ("The latest release of @civitai/<pkg> is <older>") -- the lockfile
 *     physically cannot be regenerated before publish;
 *   - so pnpm-lock.yaml stays stale and every required check's
 *     `pnpm install --frozen-lockfile` fails: ERR_PNPM_OUTDATED_LOCKFILE;
 *   - so the Version PR can never go green, can never merge, and the publish
 *     that would make the versions exist can never run.
 *
 * A `pnpm.overrides` entry breaks the cycle without touching the starters'
 * published pins: pnpm applies the override BEFORE recording the lockfile
 * importer entry, so the lockfile reads `specifier: workspace:*` and does not
 * churn when changesets bumps the caret. The caret in package.json is still
 * what a tiged'd copy sees.
 *
 * FAILS (exit 1) on any of THREE conditions:
 *
 *   1. MISSING OVERRIDE -- a starter declares a semver-range `@civitai/*` dep
 *      with no `workspace:` override, i.e. the next release would deadlock.
 *      Prints the exact line to add.
 *
 *   2. WORKSPACE-PROTOCOL PIN in a tiged-consumed starter -- a
 *      `starters/<name>/package.json` (anything NOT under `starters/examples/`)
 *      declares an `@civitai/*` dep with the `workspace:` protocol. This is the
 *      shape `2a453e6` (#192) reverted, and until this rule existed it was the
 *      guard's blind spot: rule 1 only sees PUBLISHED ranges, so flipping the
 *      starters to `workspace:*` and deleting the override made every pin
 *      invisible to both this checker and check-starter-pins.mjs -- exit 0 on
 *      both, coverage silently 15 -> 11. The remediation text below said "do
 *      NOT do this" and nothing enforced it.
 *
 *      SCOPED to the tiged-consumed starters on purpose: `starters/examples/*`
 *      are in-repo illustrations, not scaffolding templates, and legitimately
 *      use `workspace:^`.
 *
 *   3. COVERAGE FLOOR -- the number of covered (published-range + overridden)
 *      pins fell below MIN_COVERED_PINS. Rule 2 catches the protocol swap;
 *      this catches the same coverage loss arriving any other way (a pin
 *      deleted, a starter directory renamed out of the scan). An unasserted
 *      count is indistinguishable from a checker wired to nothing.
 *
 * USAGE
 *   node scripts/check-starter-workspace-overrides.mjs   # or: pnpm check:starter-overrides
 *
 * TESTS
 *   tests/guards/check-starter-workspace-overrides.test.mjs  (node --test)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const STARTERS_DIR = join(REPO_ROOT, 'starters');
// In-repo illustrations, NOT `npx tiged` scaffolding targets. These are the
// only starters allowed to use the `workspace:` protocol.
const EXAMPLES_DIR = join(STARTERS_DIR, 'examples');
const SCOPE = '@civitai/';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

/**
 * Floor for the number of published-range `@civitai/*` starter pins that must
 * be workspace-overridden. The tree carries 15 (next-app 4, react-pwa 3,
 * svelte-pwa 3, sveltekit-app 3, civitai-block-starter 2).
 *
 * GROWTH always passes -- this is a floor, not an equality. Only DELIBERATELY
 * removing a starter or one of its first-party deps should move it, and then
 * lower it in the SAME commit so the drop is reviewed rather than silent.
 */
const MIN_COVERED_PINS = 15;

/** Recursively collect package.json paths under `dir`, skipping node_modules/.git/dist. */
function findPackageJsons(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) findPackageJsons(full, out);
    else if (e.isFile() && e.name === 'package.json') out.push(full);
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`ERROR: could not parse ${relative(REPO_ROOT, file)}: ${err.message}`);
    process.exit(1);
  }
}

const rel = (f) => relative(REPO_ROOT, f);

function main() {
  const root = readJson(join(REPO_ROOT, 'package.json'));
  const overrides = root?.pnpm?.overrides ?? {};

  // An override key may carry a version selector (`pkg@<range>`); only a BARE
  // package-name key applies unconditionally to every range, which is what the
  // deadlock fix requires. A selector-qualified key would stop applying the
  // moment changesets rewrote the range out of the selector's window.
  const workspaceOverridden = new Set(
    Object.entries(overrides)
      .filter(([, v]) => typeof v === 'string' && v.startsWith('workspace:'))
      .map(([k]) => k)
      .filter((k) => k.startsWith(SCOPE) && !k.slice(SCOPE.length).includes('@')),
  );

  const files = findPackageJsons(STARTERS_DIR);
  if (files.length === 0) {
    console.error(`ERROR: no package.json found under ${rel(STARTERS_DIR)}/`);
    process.exit(1);
  }

  const missing = []; // { file, field, pkg, range }
  const covered = [];
  const workspacePinned = []; // { file, field, pkg, range } -- rule 2 violations

  for (const file of files) {
    const json = readJson(file);
    // Tiged-consumed starter, or an in-repo example? Only the examples may use
    // the `workspace:` protocol. A NEW top-level starter is covered by default.
    const isExample = file === EXAMPLES_DIR || file.startsWith(EXAMPLES_DIR + sep);
    for (const field of DEP_FIELDS) {
      for (const [pkg, range] of Object.entries(json[field] ?? {})) {
        if (!pkg.startsWith(SCOPE)) continue;
        if (typeof range === 'string' && range.startsWith('workspace:')) {
          // A `workspace:` pin resolves locally by construction -- it never hits
          // the registry, so it cannot deadlock. But in a starter that is copied
          // out verbatim it BREAKS the scaffolded project, and it removes the
          // pin from this guard's coverage entirely. Legal only in examples/.
          if (!isExample) workspacePinned.push({ file, field, pkg, range });
          continue;
        }
        if (workspaceOverridden.has(pkg)) covered.push({ file, field, pkg, range });
        else missing.push({ file, field, pkg, range });
      }
    }
  }

  for (const c of covered) {
    console.log(`OK   ${c.pkg} "${c.range}" is workspace-overridden  (${rel(c.file)})`);
  }

  let failed = false;

  if (workspacePinned.length > 0) {
    failed = true;
    console.error('');
    console.error('ERROR: WORKSPACE-PROTOCOL PIN IN A TIGED-CONSUMED STARTER.');
    console.error('');
    console.error('       A starter outside starters/examples/ declares a first-party');
    console.error('       @civitai/* dependency with the `workspace:` protocol. Starters are');
    console.error('       copied out verbatim by `npx tiged`, so the scaffolded project gets');
    console.error('       a package.json npm cannot install. This exact change was made once');
    console.error('       and reverted: 2a453e6 "fix(block-starter): pin @civitai deps to');
    console.error('       published carets (not workspace:^) (#192)".');
    console.error('');
    console.error('       It also DEFEATS both release guards: a `workspace:` pin is not a');
    console.error('       published range, so it drops out of this checker\'s coverage and out');
    console.error('       of check-starter-pins.mjs -- the regression exits 0 on both.');
    console.error('');
    for (const w of workspacePinned) {
      console.error(`  ${rel(w.file)} [${w.field}]\n    ${w.pkg}: "${w.range}"`);
    }
    console.error('');
    console.error('  fix: restore the PUBLISHED caret range in the starter, e.g.');
    console.error('    "@civitai/app-sdk": "^0.31.0"');
    console.error('  and keep the bare-key workspace override in the root package.json');
    console.error('  "pnpm" -> "overrides". The override is what makes it resolve locally.');
    console.error('');
    console.error('  starters/examples/* are exempt -- they are in-repo illustrations, not');
    console.error('  `npx tiged` scaffolding targets.');
    console.error('');
  }

  if (missing.length > 0) {
    // De-duplicate by package for the remediation block.
    const byPkg = new Map();
    for (const m of missing) {
      if (!byPkg.has(m.pkg)) byPkg.set(m.pkg, []);
      byPkg.get(m.pkg).push(m);
    }

    console.error('');
    console.error('ERROR: a starter pins a first-party @civitai/* package that has NO');
    console.error('       workspace override in the root package.json "pnpm.overrides".');
    console.error('');
    console.error('       The next `changeset version` will rewrite this range to a version');
    console.error('       that is not published yet, pnpm will try to resolve it from the');
    console.error('       registry, and the release will DEADLOCK: the lockfile cannot be');
    console.error('       regenerated before publish, and publish cannot happen until the');
    console.error('       Version PR goes green on `pnpm install --frozen-lockfile`.');
    console.error('');
    for (const [pkg, hits] of byPkg) {
      console.error(`  ${pkg}`);
      for (const h of hits) console.error(`    pinned "${h.range}" in ${rel(h.file)} [${h.field}]`);
    }
    console.error('');
    console.error('  fix: add to package.json "pnpm" -> "overrides":');
    for (const pkg of byPkg.keys()) console.error(`    "${pkg}": "workspace:*",`);
    console.error('');
    console.error('  then regenerate the lockfile:  pnpm install --lockfile-only');
    console.error('');
    console.error('  Do NOT "fix" this by changing the starter pin to workspace:* -- the');
    console.error("  starters are copied out verbatim by `npx tiged` and a workspace:");
    console.error('  protocol breaks `npm install` in the scaffolded project (see 2a453e6).');
    console.error('  That shape is separately blocked above.');
    console.error('');
    failed = true;
  }

  // The count assertion. Everything above is a rule about pins the scan FOUND;
  // this is the rule about pins that stopped being found at all.
  if (covered.length < MIN_COVERED_PINS) {
    failed = true;
    console.error('');
    console.error('ERROR: COVERAGE FLOOR — workspace-override coverage dropped.');
    console.error('');
    console.error(
      `       ${covered.length} covered published-range @civitai/* starter pin(s) < floor ${MIN_COVERED_PINS}.`,
    );
    console.error('');
    console.error('       Every pin this guard protects is one the next `changeset version`');
    console.error('       will rewrite. A pin that leaves the scan is a pin nothing checks,');
    console.error('       and the drop is invisible without an asserted count.');
    console.error('');
    console.error('  If a starter or one of its first-party deps was removed ON PURPOSE,');
    console.error(`  lower MIN_COVERED_PINS in ${rel(join(HERE, 'check-starter-workspace-overrides.mjs'))}`);
    console.error('  in the SAME commit, so the drop is reviewed instead of silent.');
    console.error('');
  }

  if (failed) process.exit(1);

  console.log(
    `\nOK: ${covered.length} published-range @civitai/* starter pin(s) are all workspace-overridden — a version bump cannot deadlock the release. (floor ${MIN_COVERED_PINS})`,
  );
}

main();
