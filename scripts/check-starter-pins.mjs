#!/usr/bin/env node
/**
 * check-starter-pins.mjs
 * ----------------------
 * Pins-vs-published guard for the starter/template scaffolds.
 *
 * Reads every `starters/**​/package.json`'s `@civitai/*` dependency pin and
 * asserts the pinned range still ADMITS the currently-published npm version
 * (`registry.npmjs.org/@civitai/<pkg>/latest`). A caret on a 0.x version
 * LOCKS the minor (`^0.2.0` → `0.2.x`), so a scaffold pinned a few minors back
 * silently births apps missing every hook/validator/component shipped since —
 * the exact drift class this check catches at its source.
 *
 * WHY: the pins are hand-maintained VERSION-PINNED surfaces (they must NOT
 * auto-update — a scaffold has to stay reproducible), so nothing else notices
 * when a release leaves them behind. This is the cheap static half of the
 * "scaffold-currency" story (Part B.4c step i of the unified-sync proposal):
 * it runs in seconds, needs no install, and fails loud with the exact fix.
 *
 * SKIPS (not a published-version pin):
 *   - `workspace:*` / `workspace:^` / `workspace:~` protocol pins — these
 *     resolve to the in-repo package inside the monorepo; there is no
 *     published version to compare against. (The block-starter + examples use
 *     these; CI's `starter` job already builds them against the workspace.)
 *
 * FAILS (exit 1) when:
 *   - a semver-range pin no longer admits the published latest (prints the stale
 *     pin + the one-line fix, `bump to ^<latest>`), OR
 *   - npm returns a DEFINITIVE 404/410 for a pinned package — the package does
 *     not exist (renamed / typo'd / unpublished). A "package not found" is a real
 *     bug in the pin, never a transient outage, so it must NOT be silently skipped.
 *
 * SKIPS GRACEFULLY (exit 0 + warning) only on genuine unreachability — a
 * transport error (DNS/timeout/connection-refused/offline) or a 5xx/429
 * (server-side/rate-limit) response. An offline dev or a CI network blip must
 * not turn this into a flaky red; a nonexistent package still fails loud.
 *
 * Uses `semver` if it happens to be resolvable (for exotic ranges); otherwise
 * a built-in caret/exact/wildcard checker (every current pin is a caret range).
 *
 * USAGE
 *   node scripts/check-starter-pins.mjs      # or: pnpm check:starter-pins
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const STARTERS_DIR = join(REPO_ROOT, 'starters');
const SCOPE = '@civitai/';
const REGISTRY = process.env.NPM_REGISTRY || 'https://registry.npmjs.org';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// Optional exact-semver via `semver` if resolvable; else fall back to the
// built-in checker below (sufficient for the caret ranges the scaffolds use).
let semver = null;
try {
  semver = createRequire(import.meta.url)('semver');
} catch {
  /* no dependency available — the built-in checker handles caret/exact/wildcard */
}

/** Recursively collect package.json paths under `dir`, skipping node_modules/.git. */
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

/** Parse "a.b.c" (leading operator already stripped) → [maj, min, pat] | null. */
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Built-in fallback: does a caret/exact/wildcard `range` admit `version`? */
function builtinSatisfies(range, version) {
  const r = range.trim();
  if (r === '*' || r === 'x' || r === '') return true;
  const ver = parseVersion(version);
  if (!ver) return false;

  if (r.startsWith('^')) {
    const base = parseVersion(r.slice(1));
    if (!base) return null; // unrecognized — let caller warn
    if (cmp(ver, base) < 0) return false;
    const [a, b] = base;
    let upper;
    if (a > 0) upper = [a + 1, 0, 0];
    else if (b > 0) upper = [0, b + 1, 0];
    else upper = [0, 0, base[2] + 1];
    return cmp(ver, upper) < 0;
  }
  // exact pin
  const exact = parseVersion(r);
  if (exact) return cmp(ver, exact) === 0;
  return null; // ~, >=, ranges, etc. — unrecognized by the fallback
}

/** Does `range` admit `version`? null = cannot decide (unrecognized range). */
function satisfies(range, version) {
  if (semver) {
    try {
      return semver.satisfies(version, range, { includePrerelease: false });
    } catch {
      /* invalid range for semver — fall through to the built-in checker */
    }
  }
  return builtinSatisfies(range, version);
}

/** Suggest a caret range that pins the published minor. */
function suggestPin(version) {
  return `^${version}`;
}

// fetchLatest returns exactly one of:
//   { version }        — resolved published version
//   { notFound, ... }  — DEFINITIVE 404/410: the package does not exist on npm
//                        (a starter pins a nonexistent/renamed/typo'd package) → HARD FAIL
//   { error }          — genuine unreachability (DNS/timeout/connection-refused,
//                        or a 5xx/429 server-side/rate-limit response) → graceful SKIP
const latestCache = new Map();
async function fetchLatest(pkg) {
  if (latestCache.has(pkg)) return latestCache.get(pkg);
  const url = `${REGISTRY}/${pkg}/latest`;
  let result;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 404 || res.status === 410) {
      // Definitive "this package is not on npm" — NOT a transient outage.
      result = { notFound: true, status: res.status };
    } else if (!res.ok) {
      // 5xx / 429 (rate-limit) / any other non-2xx: treat as transient/unreachable.
      result = { error: `HTTP ${res.status}` };
    } else {
      const body = await res.json();
      if (!body || typeof body.version !== 'string') result = { error: 'no version field' };
      else result = { version: body.version };
    }
  } catch (err) {
    // Transport-level failure (DNS, timeout, connection refused, offline).
    result = { error: err?.message || String(err) };
  }
  latestCache.set(pkg, result);
  return result;
}

async function main() {
  const files = findPackageJsons(STARTERS_DIR);
  if (files.length === 0) {
    console.error(`ERROR: no package.json found under ${relative(REPO_ROOT, STARTERS_DIR)}/`);
    process.exit(1);
  }

  // Collect every @civitai/* semver-range pin (skipping workspace: protocol).
  const pins = []; // { file, field, pkg, range }
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`ERROR: could not parse ${relative(REPO_ROOT, file)}: ${err.message}`);
      process.exit(1);
    }
    for (const field of DEP_FIELDS) {
      const deps = json[field];
      if (!deps) continue;
      for (const [pkg, range] of Object.entries(deps)) {
        if (!pkg.startsWith(SCOPE)) continue;
        if (typeof range === 'string' && range.startsWith('workspace:')) continue; // monorepo-internal
        pins.push({ file, field, pkg, range });
      }
    }
  }

  if (pins.length === 0) {
    console.log('No published-version @civitai/* pins found in starters/ (all workspace: or none). Nothing to check.');
    return;
  }

  const failures = [];
  const notFound = []; // { pin, status } — definitive 404/410, package not on npm
  const skipped = []; // { pin, reason }
  const checked = [];

  for (const pin of pins) {
    const latest = await fetchLatest(pin.pkg);
    if (latest.notFound) {
      // Definitive: the package does not exist on npm. This is a real bug in
      // the pin (nonexistent / renamed / typo'd package), not an outage.
      notFound.push({ pin, status: latest.status });
      continue;
    }
    if (latest.error) {
      skipped.push({ pin, reason: `npm unreachable (${latest.error})` });
      continue;
    }
    const ok = satisfies(pin.range, latest.version);
    if (ok === null) {
      skipped.push({ pin, reason: `unrecognized range "${pin.range}" (cannot verify without semver)` });
      continue;
    }
    if (!ok) {
      failures.push({ pin, latest: latest.version });
    } else {
      checked.push({ pin, latest: latest.version });
    }
  }

  const rel = (f) => relative(REPO_ROOT, f);

  for (const c of checked) {
    console.log(`OK   ${c.pin.pkg} ${c.pin.range} admits published ${c.latest}  (${rel(c.pin.file)})`);
  }
  for (const s of skipped) {
    console.warn(`SKIP ${s.pin.pkg} ${s.pin.range}  — ${s.reason}  (${rel(s.pin.file)})`);
  }

  // A 404/410 is DEFINITIVE (the package isn't on npm) → hard fail, never skip.
  if (notFound.length > 0) {
    console.error('');
    console.error('ERROR: a starter pins a nonexistent @civitai/* package.');
    console.error('       npm returned 404/410 — the package does not exist (renamed / typo / unpublished).');
    console.error('');
    for (const n of notFound) {
      console.error(
        `  ${rel(n.pin.file)} [${n.pin.field}]\n` +
          `    package ${n.pin.pkg} not found on npm (HTTP ${n.status}) — a starter pins a nonexistent package; correct the name.`,
      );
    }
    console.error('');
    process.exit(1);
  }

  if (failures.length > 0) {
    console.error('');
    console.error('ERROR: stale @civitai/* scaffold pin(s) — the range no longer admits the published version.');
    console.error('       A caret on a 0.x version locks the minor, so these scaffolds are born behind.');
    console.error('');
    for (const f of failures) {
      console.error(
        `  ${rel(f.pin.file)} [${f.pin.field}]\n` +
          `    ${f.pin.pkg}: "${f.pin.range}"  does NOT admit published ${f.latest}\n` +
          `    fix: bump to "${suggestPin(f.latest)}"`,
      );
    }
    console.error('');
    process.exit(1);
  }

  // Only-unreachable (nothing verified, nothing stale) → graceful pass.
  if (checked.length === 0 && skipped.some((s) => s.reason.startsWith('npm unreachable'))) {
    console.warn('\nnpm was unreachable for all pins — skipping the currency check (not failing).');
    return;
  }

  console.log(`\nOK: ${checked.length} @civitai/* scaffold pin(s) admit their published version.`);
}

main().catch((err) => {
  console.error(`check-starter-pins: unexpected error: ${err?.stack || err}`);
  process.exit(1);
});
