#!/usr/bin/env node
/**
 * check-shipped-sourcemaps.mjs
 * ----------------------------
 * DANGLING-SOURCEMAP GUARD for the published packages. Offline, no network.
 *
 * Asserts that every `.map` file a `packages/*` tarball SHIPS can actually
 * resolve its own `sources` — i.e. each entry is either present in the same
 * tarball or carried inline in `sourcesContent`.
 *
 * WHY THIS EXISTS (#376)
 * ======================
 * All five packages build with `tsc` and `"sourceMap": true` +
 * `"declarationMap": true`, so `dist/` fills with `*.js.map` and `*.d.ts.map`
 * whose `sources` are `../src/<file>.ts`. NO package lists `src` in `files`.
 * MEASURED at f913811, off the real `pnpm pack` output:
 *
 *     package                    shipped maps   dangling source refs
 *     @civitai/blocks-react              160                    160
 *     @civitai/app-sdk                    46                     46
 *     @civitai/components-react           48                     48
 *     @civitai/components                  4                      4
 *     @civitai/theme                      12                     12
 *
 * Every single one. A consumer's devtools/bundler loads the map, follows
 * `sources` to a path that is not in `node_modules`, and shows nothing — so the
 * maps bought zero debuggability while occupying 580,786 B unpacked
 * (114,574 B gzipped) across the five tarballs.
 *
 * THE FIX, AND WHY THIS SHAPE
 * ===========================
 * Three options were on the table:
 *
 *   1. SHIP `src`. Restores real debuggability, but `packages/civitai-blocks-react/src`
 *      alone is 879,895 B — it more than doubles that tarball, in a package
 *      whose whole design constraint is that it ships into sandboxed browser
 *      iframes and every app inherits its install graph.
 *   2. TURN THE COMPILER FLAGS OFF (`sourceMap: false`, `declarationMap: false`).
 *      Smallest, but it also removes the maps from `dist/` INSIDE this repo,
 *      where they are not dangling at all: `src` is right there, so a starter
 *      developer's go-to-definition lands in the real `.ts`.
 *   3. KEEP EMITTING THEM, STOP SHIPPING THEM — `"!dist/**​/*.map"` in each
 *      package's `files`. In-repo DX unchanged; the tarball loses exactly the
 *      bytes that were never usable.
 *
 * (3) is what the manifests now do. NOTE WHAT IS AND IS NOT LOST: no consumer
 * debuggability is removed, because there was none — every shipped map already
 * dangled. What remains is a `//# sourceMappingURL=` comment in the shipped
 * `.js`/`.d.ts` pointing at a file that 404s, which is the ordinary "library
 * without sourcemaps" state and strictly quieter than a map that loads and then
 * cannot find its source.
 *
 * THE RULE THIS ENFORCES IS THE INVARIANT, NOT THE SPELLING. It does not grep
 * for `!dist/**​/*.map`; it reads the REAL packed file list and every REAL map's
 * `sources`. Ship `src` instead (option 1), or inline via `sourcesContent`, and
 * this guard goes green on that too — which is the point: it pins the
 * relationship "a shipped map can resolve its sources", not one way of getting
 * there.
 *
 * 🔴 NOT IN `tests/guards/`, ON PURPOSE. It shells out to `npm pack --dry-run`
 * once per package (~1.2 s each, ~6 s total). A sibling guard records that
 * exact call blowing the per-test budget under `pnpm -r test` concurrency
 * (tests/guards/blocks-react-peer-floor.test.mjs, the #375 test). So this is a
 * standalone script wired into its own CI job, not a unit test. The alternative
 * — deriving the packed set statically from `files` + tsconfig — would mean
 * reimplementing npm-packlist's glob/negation semantics, and a guard that
 * models the packer instead of reading it is exactly the guard that passes
 * while the tarball is wrong.
 *
 * 🔴 IT READS `npm pack`, WHILE THE RELEASE PUBLISHES WITH `pnpm`. Stated
 * rather than implied, because it is a real difference and the reason it does
 * not matter is measured, not assumed: diffing both listings for all five
 * packages (2026-09-22, npm 11.16.0 / pnpm 10.28.1), the ONLY divergence is
 * `LICENSE`, which pnpm copies in from the repo root and npm does not — 1 extra
 * entry per package, in every package, and nothing else. `files` resolution is
 * otherwise identical, so no `.map` and no `src/` file can be in one listing
 * and not the other. npm is used here because `npm pack --dry-run --json`
 * prints a machine-readable file list without writing a tarball; `pnpm pack`
 * has no equivalent.
 *
 * REQUIRES A BUILD. The maps must exist in `dist/` — run `pnpm build` first.
 * A package with no `dist/` at all FAILS rather than silently scanning nothing.
 *
 * USAGE
 *   node scripts/check-shipped-sourcemaps.mjs              # or: pnpm check:shipped-sourcemaps
 *   node scripts/check-shipped-sourcemaps.mjs --self-test  # controls; see below
 *
 * SELF-TEST (`--self-test`) is the pair of controls this check's "0 dangling"
 * is worthless without, and CI runs it next to the real check:
 *   - POSITIVE control: a fixture that SHIPS a map whose source it does not
 *     ship MUST report a non-zero dangling count. A checker wired to nothing
 *     reports 0 here too, and that is the failure this catches.
 *   - NEGATIVE control: the same fixture, with the source added to `files`,
 *     MUST report 0. Proves the non-zero above is the dangling reference and
 *     not the checker failing open on every map it sees.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/**
 * Floor on how many `.map` files this guard has actually OPENED across the
 * workspace. Without it, a build that emitted no maps — or a `files` list that
 * shipped no `dist` at all — produces "0 dangling" from an empty scan, which is
 * byte-identical output to a healthy tree.
 *
 * The tree carries 298 maps in `dist/` (blocks-react 160, components-react 48,
 * app-sdk 46, components 32, theme 12). GROWTH always passes. A DROP means maps
 * stopped being emitted; lower it in the SAME commit so the drop is reviewed.
 */
const MIN_MAPS_INSPECTED = 290;

/** `npm pack --dry-run --json` → the paths that tarball would contain. */
function packedFiles(pkgDir) {
  let raw;
  try {
    raw = execFileSync('npm', ['pack', '--dry-run', '--json', '--silent'], {
      cwd: pkgDir,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    console.error(`ERROR: \`npm pack --dry-run\` failed in ${relative(REPO_ROOT, pkgDir)}:`);
    console.error(String(err.stderr || err.message).trim());
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`ERROR: could not parse \`npm pack --dry-run --json\` output for ${relative(REPO_ROOT, pkgDir)}.`);
    console.error(raw.slice(0, 2000));
    process.exit(1);
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  // Paths are POSIX, relative to the package root (no leading "package/").
  return (entry?.files ?? []).map((f) => f.path);
}

/**
 * Inspect one package. Returns { name, shippedMaps, refs, dangling: [...] }.
 */
function inspect(pkgDir) {
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  const shipped = packedFiles(pkgDir);
  const shippedSet = new Set(shipped);
  const maps = shipped.filter((p) => p.endsWith('.map'));

  const dangling = [];
  let refs = 0;
  for (const mapPath of maps) {
    const abs = join(pkgDir, mapPath);
    let map;
    try {
      map = JSON.parse(readFileSync(abs, 'utf8'));
    } catch (err) {
      dangling.push({ map: mapPath, source: '(unparseable)', why: err.message });
      continue;
    }
    const sources = map.sources ?? [];
    sources.forEach((src, i) => {
      refs++;
      const inlined = Array.isArray(map.sourcesContent) && typeof map.sourcesContent[i] === 'string';
      if (inlined) return;
      // Resolve the source relative to the MAP's own directory, then express it
      // relative to the package root — the same frame `shipped` uses.
      const resolved = resolve(dirname(abs), src);
      const relToPkg = relative(pkgDir, resolved).split(/[\\/]/).join(posix.sep);
      if (!shippedSet.has(relToPkg)) {
        dangling.push({ map: mapPath, source: src, why: `resolves to "${relToPkg}", which the tarball does not contain` });
      }
    });
  }
  return { name: pkgJson.name, dir: pkgDir, shipped: shipped.length, maps: maps.length, refs, dangling };
}

/** Every `packages/*` that has a package.json and is not private. */
function publishedPackageDirs() {
  const out = [];
  for (const e of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === 'node_modules') continue;
    const dir = join(PACKAGES_DIR, e.name);
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const json = JSON.parse(readFileSync(manifest, 'utf8'));
    if (json.private === true) continue;
    out.push(dir);
  }
  return out.sort();
}

/** Count the `.map` files sitting in a package's dist/, shipped or not. */
function mapsOnDisk(pkgDir) {
  const dist = join(pkgDir, 'dist');
  let n = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.map')) n++;
    }
  };
  walk(dist);
  return n;
}

// ---------------------------------------------------------------- self-test

/**
 * Build a throwaway package that SHIPS a map whose `sources` names a file, and
 * run the real `inspect()` over it. `shipSource` decides whether that file is
 * in `files` — which is the only difference between the two controls.
 */
function fixture(shipSource) {
  const dir = mkdtempSync(join(tmpdir(), 'civitai-376-selftest-'));
  mkdirSync(join(dir, 'dist'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'thing.ts'), 'export const thing = 1;\n');
  writeFileSync(join(dir, 'dist', 'thing.js'), 'export const thing = 1;\n//# sourceMappingURL=thing.js.map\n');
  writeFileSync(
    join(dir, 'dist', 'thing.js.map'),
    JSON.stringify({ version: 3, file: 'thing.js', sourceRoot: '', sources: ['../src/thing.ts'], names: [], mappings: 'AAAA' }),
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'civitai-376-selftest-fixture',
        version: '0.0.0',
        files: shipSource ? ['dist', 'src'] : ['dist'],
      },
      null,
      2,
    ),
  );
  return dir;
}

function selfTest() {
  let failed = false;

  // POSITIVE control — MUST count a dangling ref. A checker wired to nothing
  // reports 0 here, indistinguishable from a healthy tree.
  const pos = fixture(false);
  const posResult = inspect(pos);
  rmSync(pos, { recursive: true, force: true });
  console.log(
    `POSITIVE control (map shipped, source NOT shipped): maps=${posResult.maps} refs=${posResult.refs} dangling=${posResult.dangling.length}`,
  );
  if (posResult.dangling.length !== 1) {
    failed = true;
    console.error(
      `\nERROR: POSITIVE CONTROL FAILED — expected exactly 1 dangling reference, got ${posResult.dangling.length}.`,
    );
    console.error('       This checker cannot see the defect it claims to check. Any "0 dangling"');
    console.error('       it reports about the real packages is a fact about the checker, not the tarballs.\n');
  }

  // NEGATIVE control — the SAME fixture with `src` added to `files`. MUST be 0.
  // Proves the count above came from the dangling reference and not from the
  // checker flagging every map it meets.
  const neg = fixture(true);
  const negResult = inspect(neg);
  rmSync(neg, { recursive: true, force: true });
  console.log(
    `NEGATIVE control (map shipped, source ALSO shipped):  maps=${negResult.maps} refs=${negResult.refs} dangling=${negResult.dangling.length}`,
  );
  if (negResult.maps !== 1 || negResult.refs !== 1) {
    failed = true;
    console.error(`\nERROR: NEGATIVE CONTROL FAILED — the fixture's map was not inspected at all`);
    console.error(`       (maps=${negResult.maps}, refs=${negResult.refs}; both must be 1).\n`);
  }
  if (negResult.dangling.length !== 0) {
    failed = true;
    console.error(`\nERROR: NEGATIVE CONTROL FAILED — expected 0 dangling, got ${negResult.dangling.length}:`);
    for (const d of negResult.dangling) console.error(`         ${d.map} -> ${d.source}: ${d.why}`);
    console.error('       The checker flags a map whose source IS shipped, so it fails open on');
    console.error('       nothing and its verdict carries no information.\n');
  }

  if (failed) process.exit(1);
  console.log('\nOK: both controls behaved — the checker reports 1 on a case that must be non-zero, 0 on one that must not.');
}

// -------------------------------------------------------------------- main

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const dirs = publishedPackageDirs();
  if (dirs.length === 0) {
    console.error(`ERROR: no publishable package found under ${relative(REPO_ROOT, PACKAGES_DIR)}/`);
    process.exit(1);
  }

  let totalMapsOnDisk = 0;
  let totalShippedMaps = 0;
  let totalRefs = 0;
  const allDangling = [];
  const rows = [];

  for (const dir of dirs) {
    if (!existsSync(join(dir, 'dist'))) {
      console.error(`ERROR: ${relative(REPO_ROOT, dir)}/dist does not exist — run \`pnpm build\` first.`);
      console.error('       Scanning an unbuilt tree reports "0 dangling" while checking nothing.');
      process.exit(1);
    }
    const onDisk = mapsOnDisk(dir);
    const r = inspect(dir);
    totalMapsOnDisk += onDisk;
    totalShippedMaps += r.maps;
    totalRefs += r.refs;
    allDangling.push(...r.dangling.map((d) => ({ ...d, pkg: r.name })));
    rows.push({ ...r, onDisk });
  }

  for (const r of rows) {
    // The prefix states the VERDICT for this row. Printing `OK` next to a
    // non-zero dangling count is a label contradicting the number beside it.
    const verdict = r.dangling.length === 0 ? 'OK  ' : 'FAIL';
    console.log(
      `${verdict} ${r.name}: ${r.shipped} file(s) shipped, ${r.maps} map(s) shipped of ${r.onDisk} in dist/, ` +
        `${r.refs} source ref(s) checked, ${r.dangling.length} dangling`,
    );
  }

  let failed = false;

  if (allDangling.length > 0) {
    failed = true;
    console.error('');
    console.error('ERROR: A PUBLISHED TARBALL SHIPS A SOURCEMAP THAT CANNOT RESOLVE ITS SOURCES.');
    console.error('');
    console.error('       The map is in the tarball; the file its `sources` names is not, and the');
    console.error('       map carries no `sourcesContent`. A consumer\'s devtools loads it and then');
    console.error('       has nothing to show — the bytes ship, the debuggability does not. See #376.');
    console.error('');
    const byPkg = new Map();
    for (const d of allDangling) {
      if (!byPkg.has(d.pkg)) byPkg.set(d.pkg, []);
      byPkg.get(d.pkg).push(d);
    }
    for (const [pkg, hits] of byPkg) {
      console.error(`  ${pkg} — ${hits.length} dangling reference(s), first 5:`);
      for (const h of hits.slice(0, 5)) console.error(`    ${h.map} -> "${h.source}" (${h.why})`);
    }
    console.error('');
    console.error('  Pick ONE of the three and the guard goes green on any of them:');
    console.error('    a) stop shipping the maps  — add "!dist/**/*.map" to the package\'s `files`;');
    console.error('    b) ship the sources        — add "src" to `files` (measure the tarball first);');
    console.error('    c) inline the sources      — tsc `"inlineSources": true` fills `sourcesContent`.');
    console.error('');
  }

  // The count assertion. Everything above is a rule about maps the scan FOUND.
  // This is the rule about a scan that found none at all.
  if (totalMapsOnDisk < MIN_MAPS_INSPECTED) {
    failed = true;
    console.error('');
    console.error('ERROR: COVERAGE FLOOR — sourcemap emission dropped.');
    console.error('');
    console.error(`       ${totalMapsOnDisk} map(s) in packages/*/dist/ < floor ${MIN_MAPS_INSPECTED}.`);
    console.error('');
    console.error('       With no maps on disk there is nothing to ship and nothing to dangle, so');
    console.error('       this check exits 0 having verified nothing. If `sourceMap` /');
    console.error('       `declarationMap` were turned off ON PURPOSE, lower MIN_MAPS_INSPECTED in');
    console.error(`       ${relative(REPO_ROOT, join(HERE, 'check-shipped-sourcemaps.mjs'))} in the SAME`);
    console.error('       commit, so the drop is reviewed rather than silent.');
    console.error('');
  }

  if (failed) process.exit(1);

  console.log(
    `\nOK: ${totalShippedMaps} sourcemap(s) shipped across ${rows.length} package(s); ` +
      `${totalRefs} \`sources\` reference(s) checked, 0 dangling. ` +
      `(${totalMapsOnDisk} map(s) built in dist/, floor ${MIN_MAPS_INSPECTED})`,
  );
  console.log(
    'A zero here is only meaningful next to the controls: run `pnpm check:shipped-sourcemaps:selftest`.',
  );
}

main();
