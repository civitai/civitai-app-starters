#!/usr/bin/env node
/**
 * assert-published-versions.mjs
 * -----------------------------
 * Post-publish registry assertion: every publishable `packages/*` version in
 * this tree MUST exist on npm.
 *
 * WHY THIS EXISTS — it closes a gap `check-starter-pins.mjs` states in its own
 * header and explicitly declines to close:
 *
 *   "KNOWN GAP […]: a pin that MATCHES the local version but was never
 *    published (the Version PR merged and the publish job then failed) still
 *    reads as AHEAD and passes. […] detecting a failed publish needs the
 *    release workflow's own signal, not a static check."
 *
 * This IS that signal. `check-starter-pins.mjs` bounds the forward direction
 * (a pin ahead of npm must at least admit the local workspace version), which
 * cannot distinguish "release pending" from "release merged, publish failed" —
 * the two states are byte-identical in the tree. Only something that runs AFTER
 * the publish step, and asks the registry, can tell them apart.
 *
 * The invariant is deliberately phrased over the whole tree rather than over
 * "what this run published": `changeset version` bumps a package's `version`
 * and merges to `main` in the same commit that the publish job then acts on, so
 * on `main` every publishable package's current version should already be on
 * npm. A version that is NOT there means a publish silently did not happen —
 * whether in this run or a previous one. That makes the check self-healing
 * across runs instead of only guarding the run that broke.
 *
 * FAILS (exit 1) when:
 *   - a publishable package's exact version returns a definitive 404/410. That
 *     is the failed-publish signal. OR
 *   - `packages/` contains no publishable package at all. A zero here is
 *     indistinguishable from a checker wired to nothing, so it is an error, not
 *     a pass. (See the paired-count reporting at the end for the same reason.)
 *
 * SKIPS GRACEFULLY (exit 0 + warning) on genuine unreachability — transport
 * error (DNS/timeout/offline) or 5xx/429 — matching `check-starter-pins.mjs`.
 * A release must not go red because npm had a blip.
 *
 * SKIPS (not a publish target): `private: true` packages.
 *
 * 🔴 RETRIES BEFORE FAILING, and that is load-bearing rather than defensive.
 * `npm publish` returns before the registry's read path is globally consistent,
 * so an immediate GET of a just-published version can 404 for a few seconds.
 * Failing on the first 404 would make this red on exactly the releases that
 * SUCCEEDED — a false-FAIL class worse than the gap it closes. Only a 404 that
 * survives every attempt is reported. Transport/5xx errors are retried too, but
 * end in a graceful skip rather than a failure.
 *
 * USAGE
 *   node scripts/assert-published-versions.mjs   # or: pnpm assert:published
 *
 * ENV
 *   NPM_REGISTRY          registry origin (default https://registry.npmjs.org)
 *   PUBLISH_CHECK_TRIES   attempts per package (default 5)
 *   PUBLISH_CHECK_DELAY   ms between attempts (default 3000)
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
const REGISTRY = process.env.NPM_REGISTRY || 'https://registry.npmjs.org';
const TRIES = Math.max(1, Number(process.env.PUBLISH_CHECK_TRIES ?? 5) || 5);
const DELAY_MS = Math.max(0, Number(process.env.PUBLISH_CHECK_DELAY ?? 3000) || 0);

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

/**
 * Ask the registry for one EXACT version.
 * Returns { published } | { notFound } | { error }.
 *
 * The exact-version endpoint is the point: `/<pkg>/latest` would answer about a
 * different version and could report success while the version this tree claims
 * is absent — the precise failure this guard exists to catch.
 */
async function fetchExactVersion(name, version) {
  const url = `${REGISTRY}/${name}/${version}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 404 || res.status === 410) return { notFound: true, status: res.status };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const body = await res.json();
    if (!body || typeof body.version !== 'string') return { error: 'no version field' };
    if (body.version !== version) return { error: `registry returned ${body.version} for an exact-version request` };
    return { published: true };
  } catch (err) {
    return { error: err?.message || String(err) };
  }
}

/** Retry wrapper — see the RETRIES note in the header. */
async function resolvePackage(pkg) {
  let last = { error: 'no attempt made' };
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    last = await fetchExactVersion(pkg.name, pkg.version);
    if (last.published) return { ...last, attempts: attempt };
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

  const published = [];
  const missing = [];
  const unreachable = [];

  for (const pkg of pkgs) {
    const res = await resolvePackage(pkg);
    if (res.published) published.push({ pkg, attempts: res.attempts });
    else if (res.notFound) missing.push({ pkg, status: res.status, attempts: res.attempts });
    else unreachable.push({ pkg, reason: res.error, attempts: res.attempts });
  }

  for (const p of published) {
    console.log(
      `OK   ${p.pkg.name}@${p.pkg.version} is on the registry` +
        (p.attempts > 1 ? `  (after ${p.attempts} attempts — publish propagation)` : ''),
    );
  }
  for (const u of unreachable) {
    console.warn(`SKIP ${u.pkg.name}@${u.pkg.version} — registry unreachable after ${u.attempts} attempt(s): ${u.reason}`);
  }

  if (missing.length > 0) {
    console.error('');
    console.error('ERROR: PUBLISH DID NOT HAPPEN — a package version in this tree is not on the registry.');
    console.error('');
    console.error('       `changeset version` bumps the version and merges to main in the same');
    console.error('       commit the publish job acts on, so a version missing from npm means the');
    console.error('       publish step silently did not land it. Consumers pinning this version');
    console.error('       cannot install; `check-starter-pins.mjs` CANNOT see this (a pin matching');
    console.error('       the local version reads as AHEAD/pending and passes).');
    console.error('');
    for (const m of missing) {
      console.error(
        `  ${m.pkg.dir}\n` +
          `    ${m.pkg.name}@${m.pkg.version} -> HTTP ${m.status} after ${m.attempts} attempt(s)\n` +
          `    fix: re-run the release workflow, or publish this package manually.`,
      );
    }
    console.error('');
    process.exit(1);
  }

  // Only-unreachable -> graceful pass, matching check-starter-pins.mjs.
  if (published.length === 0 && unreachable.length > 0) {
    console.warn('\nThe registry was unreachable for every package — skipping the publish assertion (not failing).');
    return;
  }

  // Report BOTH numbers: a bare "0 missing" is the same shape as a check that
  // never ran. The pair makes the zero legible.
  console.log(
    `\nOK: ${published.length}/${pkgs.length} publishable package version(s) confirmed on the registry` +
      (unreachable.length > 0 ? `, ${unreachable.length} unverified (registry unreachable).` : ', 0 missing.'),
  );
}

main().catch((err) => {
  console.error(`assert-published-versions: unexpected error: ${err?.stack || err}`);
  process.exit(1);
});
