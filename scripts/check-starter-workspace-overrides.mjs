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
 * FAILS (exit 1) when a starter declares a semver-range `@civitai/*` dep with
 * no `workspace:` override -- i.e. the next release would deadlock. Prints the
 * exact line to add.
 *
 * USAGE
 *   node scripts/check-starter-workspace-overrides.mjs   # or: pnpm check:starter-overrides
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const STARTERS_DIR = join(REPO_ROOT, 'starters');
const SCOPE = '@civitai/';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

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

  for (const file of files) {
    const json = readJson(file);
    for (const field of DEP_FIELDS) {
      for (const [pkg, range] of Object.entries(json[field] ?? {})) {
        if (!pkg.startsWith(SCOPE)) continue;
        // A `workspace:` pin resolves locally by construction -- it never hits
        // the registry, so it cannot deadlock. (The examples use these.)
        if (typeof range === 'string' && range.startsWith('workspace:')) continue;
        if (workspaceOverridden.has(pkg)) covered.push({ file, field, pkg, range });
        else missing.push({ file, field, pkg, range });
      }
    }
  }

  for (const c of covered) {
    console.log(`OK   ${c.pkg} "${c.range}" is workspace-overridden  (${rel(c.file)})`);
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
    console.error('');
    process.exit(1);
  }

  console.log(
    `\nOK: ${covered.length} published-range @civitai/* starter pin(s) are all workspace-overridden — a version bump cannot deadlock the release.`,
  );
}

main();
