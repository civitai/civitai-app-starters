#!/usr/bin/env node
/**
 * Every subpath a package DECLARES in `exports` must resolve from the packed
 * tarball — the bytes a consumer actually installs.
 *
 * THE DEFECT THIS EXISTS FOR, found in review of `@civitai/elements-react`:
 * its `exports` mapped `./types` to `./dist/types.d.ts` + `./dist/types.js`,
 * files no build ever emitted (`tsconfig`'s `rootDir` is `./src`, and `src/`
 * held only `index.ts` and `generated/jsx.ts`). `import
 * '@civitai/elements-react/types'` was `ERR_MODULE_NOT_FOUND` for every
 * consumer on day one. Nothing in the repo imported it, every test was green,
 * every typecheck passed, and the package would have shipped that way. An
 * exports map that nothing exercises is the shape that ships broken.
 *
 * ── WHY A PACKED TARBALL, AND NOT THE WORKING TREE ────────────────────────
 * Two failure modes are invisible without packing:
 *   1. a target that exists in `dist/` but is not in `files`, so it is absent
 *      from the tarball;
 *   2. Node's SELF-REFERENCE rule. A script run from INSIDE a package
 *      directory resolves that package's own name through `package.json`
 *      `exports` against the working tree, never touching `node_modules`. An
 *      earlier draft of this checker staged the tarball inside the package and
 *      "passed" while measuring the working tree — the resolved URL proved it.
 *      So the staging directory lives in the OS temp dir, and every resolution
 *      is asserted to land inside it.
 *
 * ── HOW IT IS KNOWN TO WORK ───────────────────────────────────────────────
 * Before reporting any real result the checker runs a NEGATIVE CONTROL against
 * the first package it packs: it injects a subpath pointing at a file that is
 * not there and requires the resolution to FAIL. If that control passes, the
 * checker is not testing anything and exits non-zero saying so. The control is
 * bound to the same code path as the real checks — it is not a separate
 * harness that could drift.
 *
 * Run: pnpm check:exports   (requires `pnpm -r --filter "./packages/*" build`)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = join(repoRoot, 'packages');

/** Non-private workspace packages, in a stable order. */
function publishablePackages() {
  const out = [];
  for (const dir of readdirSync(packagesDir).sort()) {
    const manifestPath = join(packagesDir, dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.private === true) continue;
    out.push({ dir: join(packagesDir, dir), name: manifest.name, manifest });
  }
  return out;
}

/**
 * Stage a package's TARBALL in a throwaway `node_modules`, with every
 * first-party dependency symlinked to its workspace directory so the nested
 * imports resolve. Third-party deps resolve because Node follows the symlink's
 * realpath and then walks UP from the real workspace directory, reaching that
 * package's own `node_modules`.
 */
function stage(pkg, staging) {
  const nm = join(staging, 'node_modules');
  const dest = join(nm, ...pkg.name.split('/'));
  mkdirSync(dest, { recursive: true });

  const packDir = mkdtempSync(join(tmpdir(), 'civitai-pack-'));
  try {
    execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: pkg.dir,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
    const tgz = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
    if (!tgz) throw new Error(`pnpm pack produced no tarball for ${pkg.name}`);
    execFileSync('tar', ['-xzf', join(packDir, tgz), '-C', dest, '--strip-components=1']);
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }

  // Mirror the package's OWN resolved dependency set. Linking exactly what
  // pnpm put in `<pkg>/node_modules` — no more — means an import the package
  // never declared still fails here, which is a real packaging defect and not
  // something this staging should paper over.
  linkResolvedDeps(join(pkg.dir, 'node_modules'), nm);
  return dest;
}

/** Symlink every top-level entry of `from` into `into`, one level into scopes. */
function linkResolvedDeps(from, into) {
  if (!existsSync(from)) return;
  for (const entry of readdirSync(from)) {
    if (entry.startsWith('.')) continue; // .bin, .pnpm, .modules.yaml
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(join(from, entry))) {
        const link = join(into, entry, scoped);
        if (existsSync(link)) continue;
        mkdirSync(join(into, entry), { recursive: true });
        symlinkSync(join(from, entry, scoped), link);
      }
      continue;
    }
    const link = join(into, entry);
    if (existsSync(link)) continue;
    symlinkSync(join(from, entry), link);
  }
}

/** Every subpath key in `exports`, normalised to an importable specifier. */
function declaredSubpaths(pkg) {
  const exp = pkg.manifest.exports;
  if (!exp || typeof exp !== 'object') return [];
  return Object.keys(exp).map((key) => (key === '.' ? pkg.name : `${pkg.name}/${key.slice(2)}`));
}

/**
 * Does `spec` resolve (and, for a JS target, import) from `staging`?
 * Returns `{ ok, detail }`. Run in a CHILD node process so a module that
 * registers custom elements or throws cannot poison this one.
 */
function resolves(spec, staging) {
  const probe = [
    `const url = import.meta.resolve(${JSON.stringify(spec)});`,
    'process.stdout.write(url + "\\n");',
    // Only actually import JS. `./styles.css` / `./custom-elements.json` are
    // asset subpaths: resolving them proves the file is in the tarball, which
    // is the whole claim for a non-module target.
    'if (url.endsWith(".js") || url.endsWith(".mjs")) {',
    `  await import(${JSON.stringify(spec)});`,
    '}',
  ].join('\n');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: staging,
    encoding: 'utf8',
  });
  const url = (r.stdout ?? '').trim().split('\n').pop() ?? '';
  if (r.status !== 0) {
    const err = (r.stderr ?? '').trim().split('\n').find((l) => /Error/.test(l)) ?? r.stderr;
    return { ok: false, detail: err?.trim() ?? `exit ${r.status}` };
  }
  // Self-reference / stray-install guard: the resolution MUST come from the
  // staged tarball, or this checker is measuring the working tree.
  const stagedPrefix = `file://${staging}`;
  if (!url.startsWith(stagedPrefix)) {
    return {
      ok: false,
      detail: `resolved OUTSIDE the staging dir (${url}) — the check is measuring something else`,
    };
  }
  return { ok: true, detail: url };
}

/* ── the negative control ─────────────────────────────────────────────────
 * Inject a subpath whose target is not in the tarball and require it to fail.
 * If this passes, every result below is meaningless.
 */
function negativeControl(pkg, staging, dest) {
  const manifestPath = join(dest, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const original = readFileSync(manifestPath, 'utf8');
  manifest.exports['./__negative_control__'] = {
    types: './dist/__nope__.d.ts',
    import: './dist/__nope__.js',
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const r = resolves(`${pkg.name}/__negative_control__`, staging);
  writeFileSync(manifestPath, original);
  return r;
}

const packages = publishablePackages();
if (packages.length < 5) {
  console.error(`[check:exports] found only ${packages.length} publishable packages — the scan is vacuous`);
  process.exit(1);
}

const staging = mkdtempSync(join(tmpdir(), 'civitai-exports-'));
let failures = 0;
let controlRun = false;

try {
  for (const pkg of packages) {
    const subpaths = declaredSubpaths(pkg);
    if (subpaths.length === 0) {
      console.error(`[check:exports] ${pkg.name} declares no "exports" — every subpath is implicitly public`);
      failures += 1;
      continue;
    }
    if (!existsSync(join(pkg.dir, 'dist'))) {
      console.error(
        `[check:exports] ${pkg.name} has no dist/ — run \`pnpm -r --filter "./packages/*" build\` first. ` +
          'Refusing to skip: a skipped package is a package this guard does not cover.'
      );
      failures += 1;
      continue;
    }
    const pkgStaging = join(staging, pkg.name.replace('/', '__'));
    mkdirSync(pkgStaging, { recursive: true });
    const dest = stage(pkg, pkgStaging);

    if (!controlRun) {
      const control = negativeControl(pkg, pkgStaging, dest);
      controlRun = true;
      if (control.ok) {
        console.error(
          '[check:exports] NEGATIVE CONTROL PASSED. A subpath pointing at a file that is not ' +
            'in the tarball resolved successfully, so this checker cannot detect the defect ' +
            'it exists for. Not reporting any result.'
        );
        process.exit(1);
      }
      console.log(`[check:exports] negative control OK — a missing target fails: ${control.detail}`);
    }

    for (const spec of subpaths) {
      const r = resolves(spec, pkgStaging);
      if (r.ok) {
        console.log(`  ok   ${spec}`);
      } else {
        console.error(`  FAIL ${spec}\n       ${r.detail}`);
        failures += 1;
      }
    }
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n[check:exports] ${failures} declared subpath(s) do not resolve from the packed tarball.`);
  process.exit(1);
}
console.log(
  `\n[check:exports] all declared subpaths resolve across ${packages.length} packages ` +
    '(negative control confirmed red first).'
);
