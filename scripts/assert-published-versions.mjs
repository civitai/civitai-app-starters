#!/usr/bin/env node
/**
 * assert-published-versions.mjs
 * -----------------------------
 * Post-publish registry assertion: every publishable `packages/*` version in
 * this tree that the registry ALREADY KNOWS THE NAME OF must exist on npm.
 *
 * WHY THIS EXISTS — it closes a gap `check-starter-pins.mjs` states in its own
 * header and explicitly declines to close:
 *
 *   "KNOWN GAP […]: a pin that MATCHES the local version but was never
 *    published (the Version PR merged and the publish job then failed) still
 *    reads as AHEAD and passes. […] detecting a failed publish needs the
 *    release workflow's own signal, not a static check."
 *
 * This IS that signal. `check-starter-pins.mjs` bounds the forward direction (a
 * pin ahead of npm must at least admit the local workspace version), which
 * cannot distinguish "release pending" from "release merged, publish failed" —
 * the two states are byte-identical in the tree. Only something that runs AFTER
 * the publish step, and asks the registry, can tell them apart.
 *
 * The invariant is phrased over the whole tree rather than over "what this run
 * published": `changeset version` bumps a package's `version` and merges to
 * `main` in the same commit that the publish job then acts on, so on `main`
 * every publishable package's current version should already be on npm. That
 * makes the check self-healing across runs instead of only guarding the run
 * that broke.
 *
 * 🔴 EXCEPT FOR A PACKAGE NPM HAS NEVER HEARD OF — that arm is what keeps the
 * whole-tree invariant from crying wolf. A package being INTRODUCED sits in the
 * tree at a version that has never been published, by design: changesets adds
 * the package first, and the Version PR bumps and publishes it later. Failing
 * there would red the Release workflow on `main` on every push until that PR
 * merged — the permanently-red gate that trains everyone to click through.
 *
 * So a 404 on the exact version is DISAMBIGUATED with a second request for the
 * package NAME:
 *
 *   name unknown to npm   → WARN. Never-published package (a new one being
 *                           introduced). Not a failure.
 *   name known, version   → FAIL. The package exists, this version does not.
 *   absent                  That is the failed-publish signal.
 *
 * 🔴 The deliberate cost of that trade, stated so nobody reads more into this
 * than it carries: a failed FIRST publish of a brand-new package is
 * indistinguishable from that package merely being introduced, so it WARNS
 * rather than fails. A first publish failing is both rarer and far more visible
 * (the package simply does not exist for anyone) than the repeat case this
 * guard is built for.
 *
 * FAILS (exit 1) when:
 *   - a known package's exact version is absent (see above), OR
 *   - the registry answers 2xx with a body that is not the requested version —
 *     a contract violation, which FAILS CLOSED rather than being written off as
 *     "unreachable". An earlier revision routed this to the graceful-skip path,
 *     which meant a registry answering 200 with the wrong shape made the guard
 *     silently always-pass while logging a wrong cause. OR
 *   - `packages/` contains no publishable package at all. A zero here is
 *     indistinguishable from a checker wired to nothing, so it is an error, not
 *     a pass. (Same reason the success line reports a PAIR of counts.)
 *
 * SKIPS GRACEFULLY (exit 0 + warning) ONLY on genuine unreachability — a
 * transport error (DNS/timeout/offline) or a 5xx/429 — matching
 * `check-starter-pins.mjs`. A release must not go red because npm had a blip.
 *
 * SKIPS (not a publish target): `private: true` packages.
 *
 * 🔴 RETRIES BEFORE FAILING, and that is load-bearing rather than defensive.
 * `npm publish` returns before the registry's read path is globally consistent,
 * so an immediate GET of a just-published version can 404 for a few seconds.
 * Failing on the first 404 would make this red on exactly the releases that
 * SUCCEEDED. Note the real budget: TRIES attempts means TRIES-1 sleeps, so the
 * default 5/3000 waits at most 12s, not 15s.
 *
 * KNOWN LIMITS (measured, not guessed — do not read past them):
 *   - It enumerates `packages/*` ONLY. `changeset publish` operates over the
 *     whole workspace minus the changesets `ignore` list; today those coincide
 *     (all 11 starters/examples are `private: true`), but a publishable package
 *     outside `packages/` would be invisible here, and a `packages/*` entry
 *     added to `ignore` would be a false failure.
 *   - It sends NO auth, so it can only verify PUBLIC packages. npm answers 404
 *     (not 403) for a restricted read without credentials, which this code
 *     cannot tell from "not published". Every current package is
 *     `publishConfig.access: public`.
 *
 * USAGE
 *   node scripts/assert-published-versions.mjs   # or: pnpm assert:published
 *
 * ENV
 *   NPM_REGISTRY          registry origin (default https://registry.npmjs.org)
 *   PUBLISH_CHECK_TRIES   attempts per package (default 5)
 *   PUBLISH_CHECK_DELAY   ms between attempts (default 3000)
 *   PUBLISH_CHECK_TIMEOUT ms per HTTP request (default 15000)
 *
 * TESTS
 *   tests/guards/assert-published-versions.test.mjs (node --test; NPM_REGISTRY
 *   points the suite at a stand-in registry so it runs offline)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
// A trailing slash is the canonical .npmrc spelling of a registry, and would
// otherwise build a `//` path that some mirrors reject.
const REGISTRY = (process.env.NPM_REGISTRY || 'https://registry.npmjs.org').replace(/\/+$/, '');
const TRIES = Math.max(1, Number(process.env.PUBLISH_CHECK_TRIES ?? 5) || 5);
const DELAY_MS = Math.max(0, Number(process.env.PUBLISH_CHECK_DELAY ?? 3000) || 0);
// Without a timeout a hung connection falls back to undici's ~300s default;
// x TRIES x packages that can park the release concurrency lane for hours.
const TIMEOUT_MS = Math.max(1, Number(process.env.PUBLISH_CHECK_TIMEOUT ?? 15000) || 15000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Publishable first-party packages: { name, version, dir }. */
function readPublishablePackages() {
  const out = [];
  let entries;
  try {
    entries = readdirSync(PACKAGES_DIR, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'node_modules') continue;
    const file = join(PACKAGES_DIR, e.name, 'package.json');
    let json;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // not a workspace package
    }
    if (json?.private === true) continue; // never published
    if (typeof json?.name !== 'string' || typeof json?.version !== 'string') continue;
    out.push({ name: json.name, version: json.version, dir: relative(REPO_ROOT, join(PACKAGES_DIR, e.name)) });
  }
  return out;
}

/** GET a registry path. Returns { ok, body } | { notFound } | { error }. */
async function get(path) {
  try {
    const res = await fetch(`${REGISTRY}${path}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) return { notFound: true, status: res.status };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { ok: true, body: await res.json().catch(() => null) };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

/**
 * Ask the registry for one EXACT version.
 * Returns { published } | { notFound } | { unexpected } | { error }.
 *
 * The exact-version endpoint is the point: `/<pkg>/latest` would answer about a
 * different version and could report success while the version this tree claims
 * is absent — the precise failure this guard exists to catch.
 */
async function fetchExactVersion(name, version) {
  const res = await get(`/${name}/${version}`);
  if (res.notFound) return { notFound: true, status: res.status };
  if (res.error) return { error: res.error };
  const body = res.body;
  // 2xx with the wrong shape/version is a CONTRACT violation, not an outage.
  if (!body || typeof body.version !== 'string') {
    return { unexpected: `registry answered 2xx with no version field for an exact-version request` };
  }
  if (body.version !== version) {
    return { unexpected: `registry answered 2xx with version ${body.version} for an exact-version request` };
  }
  return { published: true };
}

/**
 * Does the registry know this package NAME at all?
 * Returns { exists } | { unknown } | { error }. See the header: this is what
 * separates "publish failed" from "package being introduced".
 */
async function packageNameExists(name) {
  const res = await get(`/${name}`);
  if (res.notFound) return { unknown: true };
  if (res.error) return { error: res.error };
  return { exists: true };
}

/** Retry wrapper — see the RETRIES note in the header. */
async function resolvePackage(pkg) {
  let last = { error: 'no attempt made' };
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    last = await fetchExactVersion(pkg.name, pkg.version);
    // Short-circuit on success: without this every run burns the full backoff.
    if (last.published) return { ...last, attempts: attempt };
    // A contract violation will not fix itself by waiting.
    if (last.unexpected) return { ...last, attempts: attempt };
    if (attempt < TRIES) await sleep(DELAY_MS);
  }
  return { ...last, attempts: TRIES };
}

async function main() {
  const pkgs = readPublishablePackages();

  // A zero here reads exactly like a checker wired to nothing. Fail loud.
  if (pkgs.length === 0) {
    console.error(`ERROR: no publishable package found under ${relative(REPO_ROOT, PACKAGES_DIR)}/.`);
    console.error('       Expected at least one non-private packages/*/package.json.');
    console.error('       Refusing to report success for a check that inspected nothing.');
    process.exit(1);
  }

  console.log(
    `registry ${REGISTRY} · ${TRIES} attempt(s) x ${DELAY_MS}ms · ${TIMEOUT_MS}ms timeout · ${pkgs.length} package(s)`,
  );

  const published = [];
  const missing = []; // known package, version absent -> FAIL
  const neverPublished = []; // name unknown to npm -> WARN
  const unexpected = []; // 2xx, wrong shape -> FAIL
  const unreachable = []; // transport/5xx -> graceful skip

  for (const pkg of pkgs) {
    const res = await resolvePackage(pkg);
    if (res.published) {
      published.push({ pkg, attempts: res.attempts });
      continue;
    }
    if (res.unexpected) {
      unexpected.push({ pkg, reason: res.unexpected });
      continue;
    }
    if (res.notFound) {
      // Disambiguate: is the PACKAGE unknown, or just this version?
      const probe = await packageNameExists(pkg.name);
      if (probe.unknown) neverPublished.push({ pkg });
      else if (probe.exists) missing.push({ pkg, status: res.status, attempts: res.attempts });
      else unreachable.push({ pkg, reason: `version 404, and the name probe failed: ${probe.error}`, attempts: res.attempts });
      continue;
    }
    unreachable.push({ pkg, reason: res.error, attempts: res.attempts });
  }

  for (const p of published) {
    console.log(
      `OK   ${p.pkg.name}@${p.pkg.version} is on the registry` +
        (p.attempts > 1 ? `  (after ${p.attempts} attempts — publish propagation)` : ''),
    );
  }
  for (const n of neverPublished) {
    console.warn(
      `NEW  ${n.pkg.name}@${n.pkg.version} — npm has never heard of this package name; treating it as a package being introduced, not a failed publish  (${n.pkg.dir})`,
    );
  }
  for (const u of unreachable) {
    console.warn(`SKIP ${u.pkg.name}@${u.pkg.version} — registry unreachable after ${u.attempts} attempt(s): ${u.reason}`);
  }

  if (unexpected.length > 0) {
    console.error('');
    console.error('ERROR: the registry answered 2xx with something other than the requested version.');
    console.error('       This is a contract violation, not an outage, so it FAILS rather than');
    console.error('       being written off as unreachable — a registry answering 200 with the');
    console.error('       wrong shape would otherwise make this guard silently always-pass.');
    console.error('');
    for (const u of unexpected) {
      console.error(`  ${u.pkg.dir}\n    ${u.pkg.name}@${u.pkg.version}: ${u.reason}`);
    }
    console.error('');
  }

  if (missing.length > 0) {
    console.error('');
    console.error('ERROR: PUBLISH DID NOT HAPPEN — a package version in this tree is not on the registry.');
    console.error('');
    console.error('       npm knows this package NAME but not this VERSION. `changeset version`');
    console.error('       bumps the version and merges to main in the same commit the publish job');
    console.error('       acts on, so a known package missing this version means the publish step');
    console.error('       silently did not land it. Consumers pinning this version cannot install;');
    console.error('       `check-starter-pins.mjs` CANNOT see this (a pin matching the local');
    console.error('       version reads as AHEAD/pending and passes).');
    console.error('');
    for (const m of missing) {
      console.error(
        `  ${m.pkg.dir}\n` +
          `    ${m.pkg.name}@${m.pkg.version} -> HTTP ${m.status} after ${m.attempts} attempt(s)\n` +
          `    fix: re-run the release workflow, or publish this package manually.`,
      );
    }
    console.error('');
  }

  if (missing.length > 0 || unexpected.length > 0) process.exit(1);

  // Only-unreachable -> graceful pass, matching check-starter-pins.mjs.
  if (published.length === 0 && unreachable.length > 0 && neverPublished.length === 0) {
    console.warn('\nThe registry was unreachable for every package — skipping the publish assertion (not failing).');
    return;
  }

  // Report BOTH numbers: a bare "0 missing" is the same shape as a check that
  // never ran. The pair makes the zero legible.
  console.log(
    `\nOK: ${published.length}/${pkgs.length} publishable package version(s) confirmed on the registry, 0 missing` +
      (neverPublished.length > 0 ? `, ${neverPublished.length} never-published (new)` : '') +
      (unreachable.length > 0 ? `, ${unreachable.length} unverified (registry unreachable)` : '') +
      '.',
  );
}

main().catch((err) => {
  console.error(`assert-published-versions: unexpected error: ${err?.stack || err}`);
  process.exit(1);
});
