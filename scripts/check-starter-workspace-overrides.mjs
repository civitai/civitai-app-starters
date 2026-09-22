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
 * SECOND QUESTION, SAME MECHANISM: THIRD-PARTY OVERRIDES (#390)
 * ==============================================================
 * `pnpm.overrides` is also where this repo pins SECURITY constraints on
 * transitive third-party packages — today `"cookie@<0.7.0": "^0.7.0"`, because
 * `@sveltejs/kit` declares `cookie: ^0.6.0` and `cookie <0.7.0` carries
 * GHSA-pxg6-pf52-xh8x. And `pnpm.overrides` in THIS root manifest is read by
 * pnpm only for THIS workspace.
 *
 * So the monorepo installs a safe `cookie` and CI is green, while the thing
 * developers actually consume — `npx tiged
 * civitai/civitai-app-starters/starters/sveltekit-app my-app` — copies the
 * starter directory ALONE. The root manifest is not part of the copy. The
 * scaffolded project resolves `cookie@0.6.0` and `npm audit` reports the
 * advisory the monorepo appeared to have fixed. MEASURED, before the fix: a
 * copy of `starters/sveltekit-app` installs `cookie@0.6.0` and audits 3 low,
 * all rooted in that one package.
 *
 * Rule 4 below is the deterministic, offline form of "the constraint must
 * travel": every third-party `pnpm.overrides` entry in the root has to be
 * mirrored in each tiged-consumed starter's OWN manifest, under both
 * `pnpm.overrides` (pnpm) and `overrides` (npm), so a scaffolded copy carries
 * it whichever of the two the developer reaches for.
 *
 * 🔴 DELIBERATE DEPARTURE FROM #390's STATED CLOSING CONDITION, which asked for
 * "a CI job that `tiged`s each starter into a temp dir, installs, and runs an
 * audit". That job would key on the npm ADVISORY DATABASE, which is mutable and
 * not under this repo's control: new advisories land constantly in transitive
 * dependencies, and — as `kit`/`cookie` demonstrates — there may be NO upstream
 * fix available when one does (`@sveltejs/kit@2.70.3` is latest and still wants
 * `cookie: ^0.6.0`; there is no 2.70.4 to bump to). It would go red on days
 * nobody touched the repo, for things nobody here can fix: a permanently-red
 * gate, which is worse than no gate because it trains everyone to click
 * through. This rule instead guards the MECHANISM that actually failed — an
 * override that does not travel — with no network and no database.
 *
 * 🔴 IT OVER-APPLIES ON PURPOSE, and that is the trade. Only `sveltekit-app`
 * resolves `cookie` at all (measured: `next-app`, `react-pwa`, `svelte-pwa` and
 * `civitai-block-starter` resolve none), and NO starter resolves a `postcss`
 * below the root's floor (measured: 8.5.15 inside this workspace, 8.5.28 in a
 * standalone npm resolve — both above 8.5.10), so most of the mirrored entries
 * are constraints with no referent: harmless no-ops that pnpm and npm simply
 * never apply. The alternative is a per-package or per-starter exception list,
 * which is hand-maintained machinery that goes stale the first time a dependency
 * tree shifts — and shipping one would mean deciding, by hand, which of today's
 * no-ops is still a no-op next month. An offline rule that over-applies
 * harmlessly beats one that needs a resolver (or a network) to know where it
 * applies.
 *
 * The no-ops are only harmless because the SELECTOR spelling is used rather
 * than the bare one — see MIRROR_TARGETS for the measured `EOVERRIDE` this
 * avoids in `next-app`, which devDepends on `postcss` directly.
 *
 * KNOWN GAP: yarn's `resolutions` is NOT required. Its matching semantics
 * differ from both override formats, no starter documents a yarn workflow, and
 * a third copy of the same constant in five manifests is more drift surface
 * than the residual risk justifies. State it rather than imply coverage.
 *
 * FAILS (exit 1) on any of FOUR conditions:
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
 *   4. UNMIRRORED THIRD-PARTY OVERRIDE -- a root `pnpm.overrides` entry for a
 *      package that is NOT a `@civitai/*` workspace package is missing from
 *      some tiged-consumed starter's own manifest (`pnpm.overrides` for pnpm
 *      AND `overrides` for npm), or is mirrored with a different value. See
 *      "SECOND QUESTION" above. Carries its own coverage floor
 *      (MIN_MIRRORED_CONSTRAINTS) for the same reason rule 3 exists: with zero
 *      third-party overrides in the root there is nothing to mirror and the
 *      rule reports a clean run while checking nothing.
 *
 * USAGE
 *   node scripts/check-starter-workspace-overrides.mjs   # or: pnpm check:starter-overrides
 *
 * TESTS
 *   tests/guards/check-starter-workspace-overrides.test.mjs  (node --test)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

/**
 * Floor for the number of (tiged-consumed starter x third-party root override)
 * pairs rule 4 verifies. The tree carries 10: five starters mirroring the two
 * third-party constraints (`cookie@<0.7.0`, `postcss@<8.5.10`).
 *
 * GROWTH always passes. A DROP means either a starter left the scan or the root
 * stopped constraining a third-party package -- lower it in the SAME commit so
 * the drop is reviewed rather than silent. Without it, deleting the root's
 * `cookie` entry leaves rule 4 with nothing to check and a clean exit 0.
 */
const MIN_MIRRORED_CONSTRAINTS = 10;

/**
 * The manifest keys a tiged'd copy's package manager actually reads for an
 * override. `pnpm.overrides` and `overrides` are BOTH required: the starters'
 * READMEs say `pnpm install`, but an external developer who reaches for `npm
 * install` gets a project pnpm's key cannot help. Yarn's `resolutions` is a
 * stated gap -- see the docblock.
 *
 * 🔴 BOTH TAKE THE ROOT'S KEY VERBATIM, INCLUDING THE `@<range>` SELECTOR, and
 * that is a MEASURED choice rather than a tidy one. npm accepts pnpm's
 * selector-key spelling in its own `overrides` block -- measured on npm 11.16.0:
 * `{"overrides": {"cookie@<0.7.0": "^0.7.0"}}` against `@sveltejs/kit@2.70.3`
 * resolved `cookie@0.7.2`, 0 advisories. The BARE spelling (`{"cookie":
 * "^0.7.0"}`) also works, but it is UNCONDITIONAL, and npm refuses an
 * unconditional override of a package the manifest also depends on directly:
 *
 *     npm error code EOVERRIDE
 *     npm error Override for postcss@^8.5.15 conflicts with direct dependency
 *
 * `next-app` devDepends on `postcss: ^8.5.15`, so the bare spelling of the
 * root's `postcss@<8.5.10` constraint would make `npm install` FAIL in a
 * scaffolded next-app -- while the selector spelling installs clean (measured:
 * postcss@8.5.28, 0 advisories). One key for both managers also means one
 * constant, so a value can never drift between the two blocks.
 *
 * The selector key form requires npm >= 8.3 (Node 16); these starters target
 * Node 20+, which ships npm 10+.
 *
 * 🔴 BOTH ARE LOAD-BEARING, NOT BELT-AND-BRACES. Measured on pnpm 10.28.1: a
 * scaffolded copy carrying ONLY the plain `overrides` key resolved
 * `cookie@0.6.0` -- pnpm does not read it. With `pnpm.overrides` present:
 * `cookie@0.7.2`. So neither block is redundant.
 *
 * 🔴 AND EXPECT A WARNING IN THIS WORKSPACE. `pnpm install` at the monorepo
 * root prints, once per starter:
 *
 *     WARN  The field "pnpm.overrides" was found in
 *           starters/<name>/package.json. This will not take effect. You should
 *           configure "pnpm.overrides" at the root of the workspace instead.
 *
 * That is correct and harmless -- inside the workspace only the ROOT manifest's
 * overrides apply, which is exactly why the root entry still exists -- and it
 * is NOT a reason to delete the starter blocks. It is stated here, and in every
 * starter's own `comment-overrides`, because an unexplained new warning on
 * every install is precisely the thing someone "fixes" by removing the fix.
 */
const MIRROR_TARGETS = [
  { label: 'pnpm.overrides', read: (json) => json?.pnpm?.overrides, manager: 'pnpm' },
  { label: 'overrides', read: (json) => json?.overrides, manager: 'npm' },
];

/**
 * Package name of an override KEY. pnpm keys may carry a version selector
 * (`cookie@<0.7.0`), npm's are usually bare (`cookie`), and a scoped name
 * contains an `@` of its own (`@civitai/app-sdk`) -- so the selector `@` is the
 * first one after position 0.
 */
function overrideKeyPackageName(key) {
  const at = key.indexOf('@', key.startsWith('@') ? 1 : 0);
  return at === -1 ? key : key.slice(0, at);
}

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

/**
 * The tiged-consumed starters' OWN root manifests -- `starters/<name>/package.json`
 * for every directory under `starters/` except `examples/`.
 *
 * Rule 4's scope, and deliberately NOT the recursive `findPackageJsons` walk: a
 * `npx tiged civitai/civitai-app-starters/starters/<name> my-app` copy makes
 * exactly THIS file the new project's root manifest, and the root manifest is
 * the only place an override can be declared. A nested package.json deeper in a
 * starter would never be read as the project root.
 */
function tigedStarterManifests() {
  let entries;
  try {
    entries = readdirSync(STARTERS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'examples' || e.name === 'node_modules') continue;
    const file = join(STARTERS_DIR, e.name, 'package.json');
    if (existsSync(file)) out.push(file);
  }
  return out.sort();
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

  // ---- RULE 4: third-party root overrides must TRAVEL with a tiged copy ----
  // Every root override key whose package is not a first-party @civitai/*
  // workspace package. These exist for security posture, and the root manifest
  // is not part of a `npx tiged starters/<name>` copy.
  const thirdPartyOverrides = Object.entries(overrides).filter(
    ([k, v]) => typeof v === 'string' && !overrideKeyPackageName(k).startsWith(SCOPE),
  );

  const mirrorMissing = []; // { file, key, pkg, want, target, found }
  const mirrored = []; // { file, key } -- one per (starter x constraint) pair verified

  for (const file of tigedStarterManifests()) {
    const json = readJson(file);
    for (const [key, want] of thirdPartyOverrides) {
      const pkg = overrideKeyPackageName(key);
      let ok = true;
      for (const target of MIRROR_TARGETS) {
        const block = target.read(json) ?? {};
        // EXACT KEY, EXACT VALUE. Both managers accept the root's spelling
        // verbatim (see MIRROR_TARGETS), so an exact match is achievable — and
        // it pins the whole constraint rather than just the package name. A
        // by-name comparison would pass a mirror that narrowed the selector.
        if (block[key] !== want) {
          ok = false;
          const byName = Object.entries(block).find(([k]) => overrideKeyPackageName(k) === pkg);
          mirrorMissing.push({
            file,
            key,
            pkg,
            want,
            target,
            found: key in block ? `"${key}": "${block[key]}"` : byName ? `"${byName[0]}": "${byName[1]}"` : null,
          });
        }
      }
      if (ok) mirrored.push({ file, key });
    }
  }

  for (const c of covered) {
    console.log(`OK   ${c.pkg} "${c.range}" is workspace-overridden  (${rel(c.file)})`);
  }
  for (const m of mirrored) {
    console.log(`OK   root override "${m.key}" is mirrored for pnpm + npm  (${rel(m.file)})`);
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

  if (mirrorMissing.length > 0) {
    failed = true;
    console.error('');
    console.error('ERROR: A THIRD-PARTY ROOT OVERRIDE DOES NOT TRAVEL WITH `npx tiged`.');
    console.error('');
    console.error('       The root package.json "pnpm.overrides" constrains a third-party');
    console.error('       package, but a starter does not declare that constraint in its OWN');
    console.error('       manifest. `npx tiged civitai/civitai-app-starters/starters/<name>`');
    console.error('       copies the starter DIRECTORY ONLY — the root manifest is not part of');
    console.error('       the copy — so the scaffolded project resolves the unconstrained');
    console.error('       version while this monorepo installs the safe one and CI stays green.');
    console.error('');
    console.error('       Measured for cookie@<0.7.0 before this rule existed: a copy of');
    console.error('       starters/sveltekit-app resolved cookie@0.6.0 and `npm audit` reported');
    console.error('       3 low advisories, all rooted in that one package.');
    console.error('');
    for (const m of mirrorMissing) {
      console.error(
        `  ${rel(m.file)} ["${m.target.label}"] — ${m.target.manager}\n` +
          (m.found === null
            ? `    no constraint on ${m.pkg}; the root declares "${m.key}": "${m.want}"`
            : `    has ${m.found}; the root declares "${m.key}": "${m.want}"`),
      );
    }
    console.error('');
    console.error('  fix: add the root\'s entry VERBATIM to BOTH blocks of the starter\'s own');
    console.error('  package.json, so the copy is covered whichever manager the developer uses:');
    console.error('');
    console.error('    "overrides": {          // npm');
    for (const [key, want] of thirdPartyOverrides) console.error(`      "${key}": "${want}",`);
    console.error('    },');
    console.error('    "pnpm": { "overrides": {  // pnpm');
    for (const [key, want] of thirdPartyOverrides) console.error(`      "${key}": "${want}",`);
    console.error('    } }');
    console.error('');
    console.error('  Inside this workspace both are inert — only the ROOT manifest\'s overrides');
    console.error('  are read — so this is not a second source of truth for the monorepo. It is');
    console.error('  the constraint the tiged\'d copy needs, where the copy can see it.');
    console.error('');
  }

  // Rule 4's own count assertion. With no third-party override in the root
  // there is nothing to mirror, and rule 4 reports a clean run over an empty
  // set — identical output to a fully mirrored tree.
  if (mirrored.length < MIN_MIRRORED_CONSTRAINTS) {
    failed = true;
    console.error('');
    console.error('ERROR: COVERAGE FLOOR — third-party override mirroring dropped.');
    console.error('');
    console.error(
      `       ${mirrored.length} verified (starter x third-party override) pair(s) < floor ${MIN_MIRRORED_CONSTRAINTS}.`,
    );
    console.error('');
    console.error('       Either a starter left the scan, or the root stopped constraining a');
    console.error('       third-party package. Both leave rule 4 checking nothing while');
    console.error('       exiting 0.');
    console.error('');
    console.error('  If the drop is deliberate, lower MIN_MIRRORED_CONSTRAINTS in');
    console.error(`  ${rel(join(HERE, 'check-starter-workspace-overrides.mjs'))} in the SAME`);
    console.error('  commit, so it is reviewed rather than silent.');
    console.error('');
  }

  if (failed) process.exit(1);

  console.log(
    `\nOK: ${covered.length} published-range @civitai/* starter pin(s) are all workspace-overridden — a version bump cannot deadlock the release. (floor ${MIN_COVERED_PINS})`,
  );
  console.log(
    `OK: ${thirdPartyOverrides.length} third-party root override(s) mirrored into every tiged-consumed starter for both pnpm and npm — ${mirrored.length} pair(s) verified. (floor ${MIN_MIRRORED_CONSTRAINTS})`,
  );
}

main();
