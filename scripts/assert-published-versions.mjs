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
 * SKIPS GRACEFULLY (exit 0 + warning) ONLY on genuine unreachability. The
 * complete trigger list, kept exhaustive because an earlier revision of this
 * very block was false in both directions:
 *   - a transport error before the status line (DNS, connection refused,
 *     offline, or the request timeout firing early), OR
 *   - a body-read failure AFTER a 2xx status line (timeout mid-body, reset,
 *     truncated JSON) — see `get`, which deliberately does NOT fold this into
 *     a null body, OR
 *   - ANY non-2xx status other than 404/410. Not just 5xx/429: 400/401/402/403
 *     /451 all land here too (proxy-registry auth, private-org billing, an IP
 *     block). Stated precisely because two earlier revisions of this list said
 *     "5xx/429" and were wrong about their own code, OR
 *   - the exact version 404s AND the follow-up name probe cannot be completed,
 *     so "publish failed" and "new package" cannot be told apart.
 * Matching `check-starter-pins.mjs`: a release must not go red on a blip.
 *
 * But NOT when nothing at all could be CONFIRMED — see the FLOOR near the end
 * of main(). A run that confirms zero packages while any package looked merely
 * "new" is indistinguishable from a check wired to nothing.
 *
 * SKIPS (not a publish target): `private: true` packages.
 *
 * 🔴 RETRIES BEFORE FAILING, and that is load-bearing rather than defensive.
 * `npm publish` returns before the registry's read path is globally consistent,
 * so an immediate GET of a just-published version can 404 for a few seconds.
 * Failing on the first 404 would make this red on exactly the releases that
 * SUCCEEDED. The loop sleeps at the TOP of attempts 2..N, giving exactly
 * TRIES-1 sleeps with none before the first attempt or after the last.
 *
 * BUDGET, measured rather than assumed — a PACKAGE THAT 404s PAYS TWICE, since
 * the name probe retries on the same budget: 2 x (TRIES-1) x DELAY = 24s of
 * sleeping per failing package at the 5/3000 defaults, not 12s. Add TIMEOUT per
 * request and the worst case over 5 packages runs to several minutes, which is
 * why `release.yml` caps this step with `timeout-minutes` — the release
 * `concurrency` lane has no `cancel-in-progress`, so an unbounded step here
 * would park it.
 *
 * 🔴 PREMISE: everything above about WHERE the bump lands is a claim about
 * `changesets/action`'s internals — that `prepareBranch()` + `pushChanges()`
 * commit the version bump and leave HEAD on it. Verified by reading the action
 * at `a45c4d5` (v1.9.0).
 *
 * That premise USED to be able to change with no diff in this repo: `release.yml`
 * referenced `@v1`, and `v1` is a moving BRANCH, not a tag — measured 2026-08-20,
 * `refs/heads/v1` exists and `refs/tags/v1` does not. CLOSED 2026-08-20 by pinning
 * `release.yml` to `a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d` (== `refs/tags/v1.9.0^{}`
 * == the v1 head at pin time, so the pin changed no behaviour). The premise is now
 * frozen against the exact commit it was read from.
 *
 * This does NOT make the premise permanently true — it makes a change to it
 * VISIBLE as a diff here. Whoever moves that SHA owns re-reading `src/git.ts`
 * `prepareBranch()`/`pushChanges()` and re-confirming the bump still lands as a
 * commit with HEAD left on it. Upstream has since shipped v2.x (v2.1.1 as of
 * 2026-08-20), whose behaviour here is UNVERIFIED — and v2 renames the very inputs
 * release.yml passes, so it fails loudly rather than subtly.
 *
 * A 40-hex SHA cannot move on its own, so the diagnostic question is no longer
 * "did upstream change?" but "did someone change the pin?":
 *     git log -p --follow -- .github/workflows/release.yml | grep changesets/action
 * `.github/dependabot.yml` ignores MAJOR bumps for this action precisely because
 * release.yml has no `pull_request` trigger, so such a bump would be green on every
 * PR check and only break after merge.
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
 *   PUBLISH_CHECK_ALLOW_NONE_PUBLISHED
 *                         set to exactly "1" to let a run that confirmed ZERO
 *                         packages pass (see the FLOOR). For a genuine
 *                         first-ever release of every package; any other value,
 *                         "true" included, does nothing.
 *   PUBLISH_CHECK_FROM_DISK
 *                         set to "1" to read the WORKING TREE instead of
 *                         $GITHUB_SHA. This is the pre-fix behaviour and exists
 *                         so a test/live control can reproduce it deliberately;
 *                         it can only make the guard stricter, never laxer. Do
 *                         not set it in CI.
 *   GITHUB_SHA            set by GitHub Actions; the commit whose manifests are
 *                         checked. Falls back to HEAD when unset (local runs).
 *
 * TESTS
 *   tests/guards/assert-published-versions.test.mjs (node --test; NPM_REGISTRY
 *   points the suite at a stand-in registry so it runs offline)
 */
import { execFileSync } from 'node:child_process';
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

/** Shape a parsed manifest into a pin, or null if it is not a publish target. */
function toPublishable(json, dir) {
  if (json?.private === true) return null; // never published
  if (typeof json?.name !== 'string' || typeof json?.version !== 'string') return null;
  return { name: json.name, version: json.version, dir };
}

/**
 * 🔴 Read the commit that TRIGGERED this run (`$GITHUB_SHA`), not the working
 * tree and NOT `HEAD`.
 *
 * `changesets/action` has two modes through the same job. In CREATE-VERSION-PR
 * mode it runs `changeset version`, which rewrites every package.json to the
 * versions the Version PR proposes. Those versions are unpublished BY DESIGN —
 * they are what merging that PR will publish. Reading them and demanding npm
 * already have them failed EVERY release run with a pending changeset.
 *
 * 🔴 AND `HEAD` DOES NOT AVOID THAT — a first attempt at this fix assumed the
 * rewrite was left uncommitted, and was completely inert. The action's
 * `prepareBranch()` + `pushChanges()` (changesets/action a45c4d5 / v1.9.0, commitMode
 * `git-cli`, this repo's default) do, in order:
 *
 *     git checkout -b changeset-release/main
 *     git reset --hard $GITHUB_SHA
 *     pnpm changeset version          # rewrites package.json
 *     git add . && git commit -m "chore(release): version packages"
 *     git push origin HEAD:changeset-release/main --force
 *
 * and never restore the previous HEAD. Measured on run 31665922710: by the time
 * this step ran, HEAD was b18d787 on `changeset-release/main` holding app-sdk
 * 0.34.0 — byte-identical to the working tree. `main` held 0.33.0, which is
 * what npm had, and Version PR #231 carried 0.34.0.
 *
 * `$GITHUB_SHA` is the ref the invariant is actually about, and it is available
 * locally in every mode because `actions/checkout` checks out the event's SHA —
 * that is what puts it in the object store under the depth-1 default. (The
 * `git reset --hard $GITHUB_SHA` above reinforces it, but only in create-PR
 * mode with commitMode `git-cli`: `runPublish` never touches git, and
 * `prepareBranch` early-returns under commitMode `github-api`. Do not cite the
 * reset as the reason — it covers one of three modes.)
 *
 *   create-PR mode  $GITHUB_SHA is the main commit, whose versions are the ones
 *                   already published. The action's branch + commit are off to
 *                   the side and correctly invisible.
 *   publish  mode   $GITHUB_SHA IS the merged Version PR commit, whose versions
 *                   are exactly what `changeset publish` just pushed to npm.
 *                   (`pnpm release` = build && changeset publish; neither
 *                   rewrites a manifest or moves the branch.)
 *
 * Falls back to `HEAD` when $GITHUB_SHA is unset (a local run), and the caller
 * falls back to the filesystem when this returns null — the test fixtures are
 * plain temp dirs with no git.
 */
const TARGET_REF = process.env.GITHUB_SHA || 'HEAD';

function git(args) {
  return execFileSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * Returns a DISCRIMINATED result, because the three ways this can come back
 * empty mean opposite things and an earlier revision collapsed them into one
 * falsy return:
 *
 *   { unreadable: true }  the ref could genuinely not be read (no git, not a
 *                         checkout, ref absent). We were told which commit to
 *                         check and cannot -> indeterminate.
 *   { pkgs: [] }          the ref READ FINE and legitimately has no publishable
 *                         package. That is the zero-packages FLOOR's case and
 *                         must reach it — it is a documented hard failure.
 *   { pkgs: [...] }       normal.
 *
 * `dropped` rides alongside `pkgs` on both readable arms and carries the
 * manifests that WERE listed at the ref and could not be read. It is what lets
 * the floor tell "packages/ is empty at this ref" from "packages/ is populated
 * at this ref and the object store is damaged" — two states that produce an
 * identical `pkgs: []` and want opposite fixes.
 *
 * Collapsing the second into the first sent "packages/ is absent at the ref"
 * and "every packages/* is private" down the indeterminate path, so in CI
 * (where $GITHUB_SHA is always set) they exited 0 with the message "could not
 * be read" — a false cause, and a documented fail-loud invariant silently
 * disarmed in the only environment that runs it.
 */
function readPublishablePackagesFromGit() {
  let listing;
  try {
    listing = git(['ls-tree', '-r', '--name-only', TARGET_REF, 'packages/']);
  } catch {
    return { unreadable: true }; // no git, not a checkout, or the ref is absent
  }
  const manifests = listing
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^packages\/[^/]+\/package\.json$/.test(l));
  // Read fine, nothing publishable there: NOT indeterminate. Let the floor see it.
  if (manifests.length === 0) return { pkgs: [], dropped: [], listed: 0 };

  const out = [];
  const dropped = [];
  for (const path of manifests) {
    let json;
    try {
      json = JSON.parse(git(['show', `${TARGET_REF}:${path}`]));
    } catch (err) {
      // A manifest listed at the ref that cannot be USED is NOT nothing —
      // silently dropping it shrinks the population the same way a checker
      // wired to nothing does. Say so.
      //
      // 🔴 TWO producers land here and they have different causes: `git show`
      // failing (the object store cannot produce the blob) and `JSON.parse`
      // failing (the blob came back fine and is malformed). Anything that
      // reports on `dropped` must not assert ONE of those as the cause — the
      // per-entry WARN below carries git's or the parser's own message, which
      // is the only thing that actually distinguishes them.
      dropped.push(`${path} (${err?.message?.split('\n')[0] || err})`);
      continue;
    }
    const pin = toPublishable(json, dirname(path));
    if (pin) out.push(pin);
  }
  for (const d of dropped) console.warn(`WARN could not read ${d} at ${TARGET_REF} — not counted`);
  // 🔴 `dropped` LEAVES this function, and that is the whole point. Warning per
  // entry and returning only `pkgs` made the two states below indistinguishable
  // to the caller, so the FLOOR reported the first when it was looking at the
  // second:
  //   pkgs:[] dropped:[]     the ref genuinely has no publishable package
  //   pkgs:[] dropped:[...]  the ref LISTED manifests and could not use them
  // The verdict is the same (exit 1, correctly), the diagnosis is not: the
  // second is not an empty `packages/`, and pointing an operator there sends
  // them to look at files that are sitting readable on disk.
  //
  // `listed` rides along because `dropped.length` alone CANNOT support a
  // sentence about the whole population: a ref can list 5 manifests, drop 2,
  // and have the other 3 read fine and declare nothing publishable. Reporting
  // "2 manifests, every one unusable" there is a fresh instance of exactly the
  // defect this floor message was fixed for.
  return { pkgs: out, dropped, listed: manifests.length };
}

/** Short sha for a ref, for the run log. '' if unresolvable / not a repo. */
function describeRef(ref = TARGET_REF) {
  try {
    return git(['rev-parse', '--short', ref]).trim();
  } catch {
    return '';
  }
}

/** Filesystem reader — the fallback when this is not a git checkout. */
function readPublishablePackagesFromDisk() {
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
    const pin = toPublishable(json, relative(REPO_ROOT, join(PACKAGES_DIR, e.name)));
    if (pin) out.push(pin);
  }
  return out;
}

/**
 * Publishable first-party packages: { name, version, dir }. The triggering
 * commit wins over the working tree.
 *
 * The `source` string is not decoration — it is the ONLY thing distinguishing
 * "read the right ref" from "silently fell back to the working tree", which is
 * the exact state that broke the release. It names the ref AND its sha, and a
 * test asserts it in the fallback arm too.
 */
function readPublishablePackages() {
  // `dropped: []` on every DISK arm is a statement about the reader, not a
  // claim that nothing was skipped: readPublishablePackagesFromDisk() treats an
  // unparseable package.json as "not a workspace package" and drops it silently.
  // Only the git reader distinguishes "listed at the ref but unreadable", which
  // is the state the floor's diagnosis is about.
  if (process.env.PUBLISH_CHECK_FROM_DISK === '1') {
    return {
      source: 'working tree (PUBLISH_CHECK_FROM_DISK=1)',
      pkgs: readPublishablePackagesFromDisk(),
      dropped: [],
      listed: 0,
    };
  }
  const fromGit = readPublishablePackagesFromGit();

  // The ref READ FINE. That includes reading it and finding nothing publishable
  // — which is the FLOOR's case, a documented hard failure, and must NOT be
  // diverted into the indeterminate skip below.
  if (!fromGit.unreadable) {
    const sha = describeRef();
    const label = process.env.GITHUB_SHA ? `$GITHUB_SHA` : 'HEAD';
    return {
      source: `${label}${sha ? ` (${sha})` : ''}`,
      pkgs: fromGit.pkgs,
      dropped: fromGit.dropped,
      listed: fromGit.listed,
    };
  }

  const isRepo = describeRef('HEAD') !== '';

  // 🔴 We were TOLD which commit to check and genuinely could not read it. Do
  // NOT fall back to the working tree: in create-PR mode that tree holds the
  // Version PR's unpublished versions, so falling back would hard-FAIL a
  // healthy release — restoring the exact #232 bug under a different trigger.
  // Every other "cannot determine" path here is a graceful skip; so is this.
  //
  // No publish-mode exemption here: an earlier revision added one for "ref
  // unreadable but HEAD === $GITHUB_SHA, so the tree is provably the ref's".
  //
  // That state IS constructible — delete a commit's root tree object and
  // `rev-parse HEAD` still succeeds while `ls-tree` exits 128; a `--filter=tree:0`
  // partial clone with an unreachable promisor is a second route. (An earlier
  // version of this comment claimed it could not be constructed. It was wrong,
  // and it is recorded here because a maintainer might otherwise build on it.)
  //
  // It is still correct to have no exemption: every route to that state is a
  // damaged or partial object store, where "we cannot determine this" is the
  // honest answer. The exemption would only have added a working-tree assertion
  // in a broken-git state — it costs a detection opportunity, never a false
  // failure. No test can kill its mutant, which is the tell that it was buying
  // nothing.
  if (process.env.GITHUB_SHA && isRepo) {
    return {
      source: `$GITHUB_SHA (${process.env.GITHUB_SHA.slice(0, 9)}) could not be read`,
      pkgs: [],
      indeterminate: true,
    };
  }

  // Distinguish the two remaining fallbacks: "no git here" is fine, "git is
  // here but the read failed" is the pre-fix behaviour returning.
  return {
    source: isRepo
      ? `working tree — FALLBACK, the git read at ${TARGET_REF} failed`
      : 'working tree (not a git checkout)',
    pkgs: readPublishablePackagesFromDisk(),
    dropped: [],
    listed: 0,
  };
}

/**
 * GET a registry path. Returns { ok, body } | { notFound } | { error }.
 *
 * 🔴 A BODY-READ failure is an `error`, never an `ok` with a null body. The
 * request can fail AFTER the status line — a timeout mid-body, a reset, a
 * truncated response — and swallowing that into `body = null` mislabels a
 * transport transient as a registry CONTRACT violation, which this script fails
 * closed on and refuses to retry. It also made the name probe answer "the
 * package exists" for a request the registry never completed, producing
 * "PUBLISH DID NOT HAPPEN" for a brand-new package on a network hiccup. Both
 * were reproduced; keep the two failure kinds separate.
 */
async function get(path, accept = 'application/json') {
  try {
    const res = await fetch(`${REGISTRY}${path}`, {
      headers: { accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404 || res.status === 410) return { notFound: true, status: res.status };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    let body;
    try {
      body = await res.json();
    } catch (err) {
      return { error: `body read failed: ${err?.message || String(err)}` };
    }
    return { ok: true, body };
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
 *
 * Asks for npm's ABBREVIATED packument: the full document lists every version
 * ever published and can be megabytes, and this request is the one most exposed
 * to the timeout budget — a needless large body here widens exactly the
 * mid-body-failure window handled in `get`.
 *
 * RETRIED on the same budget as the version probe. It decides between "publish
 * failed" (hard fail) and "new package" (warn), so letting a single 429/503
 * settle it would demote a genuine failed publish to a skip — and this round
 * doubles request volume on a mass-failure run, which is precisely when a rate
 * limit trips.
 */
async function packageNameExists(name) {
  let last = { error: 'no attempt made' };
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    if (attempt > 1) await sleep(DELAY_MS);
    const res = await get(`/${name}`, 'application/vnd.npm.install-v1+json, application/json');
    if (res.notFound) return { unknown: true };
    if (res.ok) return { exists: true };
    last = res;
  }
  return { error: last.error };
}

/**
 * Retry wrapper — see the RETRIES note in the header.
 *
 * The sleep is at the TOP of attempts 2..N rather than the bottom of 1..N-1.
 * Both give TRIES-1 sleeps, but this shape makes a trailing sleep after the
 * final attempt unrepresentable, so the header's stated budget cannot drift
 * from the code by a one-character edit.
 */
async function resolvePackage(pkg) {
  let last = { error: 'no attempt made' };
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    if (attempt > 1) await sleep(DELAY_MS);
    last = await fetchExactVersion(pkg.name, pkg.version);
    // Short-circuit on success: without this every run burns the full backoff.
    if (last.published) return { ...last, attempts: attempt };
    // A contract violation will not fix itself by waiting.
    if (last.unexpected) return { ...last, attempts: attempt };
  }
  return { ...last, attempts: TRIES };
}

async function main() {
  // The `= []` / `= 0` defaults are REDUNDANT against every arm that currently
  // reaches the floor, and that is stated rather than dressed up as coverage:
  // removing them alone survives the whole suite, because the one arm that omits
  // both fields (`indeterminate`) returns before either is read. They are kept
  // for the next arm somebody adds. Removing them TOGETHER with a reader arm's
  // fields is caught — that pair TypeErrors mid-floor, and `assertFloorIsIntact`
  // in the tests is what sees it, since exit 1 alone cannot tell a completed
  // floor from a crashed one.
  const { source, pkgs, indeterminate, dropped = [], listed = 0 } = readPublishablePackages();

  // Told which commit to check, could not read it -> cannot determine anything.
  // Skip loudly rather than assert against the wrong tree. See the note in
  // readPublishablePackages().
  if (indeterminate) {
    console.warn(`SKIP the publish assertion — ${source}.`);
    console.warn('     Refusing to fall back to the working tree: in create-PR mode it holds the');
    console.warn('     Version PR\'s unpublished versions, so that fallback would fail a healthy release.');
    return;
  }

  // A zero here reads exactly like a checker wired to nothing. Fail loud.
  //
  // 🔴 NAME THE SOURCE HERE TOO. This message was written when the only reader
  // was the filesystem one, and kept its wording when the script moved to
  // reading a git ref — so on the git path it described a place it had not
  // looked. An operator reading "no publishable package found under packages/"
  // goes and finds the packages sitting there, readable, and concludes the
  // guard is broken. `source` is the same value the success line prints, and it
  // is the only thing that says WHICH ref produced this verdict.
  if (pkgs.length === 0) {
    console.error(
      `ERROR: no publishable package found in ${source} under ${relative(REPO_ROOT, PACKAGES_DIR)}/.`,
    );
    if (dropped.length > 0) {
      // 🔴 The population was NOT empty — this guard could not USE it. Opposite
      // cause, opposite fix, and the verdict alone cannot tell them apart.
      //
      // Report BOTH counts and claim nothing about the difference. `dropped` is
      // the only thing measured here; the remaining `listed - dropped` manifests
      // read fine and simply declared nothing publishable, and asserting "every
      // one is unusable" over them would re-commit, in a new place, the exact
      // error this message was rewritten to fix.
      //
      // The CAUSE is likewise left to the per-entry WARN: two different failures
      // land in `dropped` (the object store cannot produce the blob; the blob is
      // fine and the JSON does not parse) and only git's/the parser's own message
      // separates them. Naming one of them here would misdirect on the other.
      console.error(
        `       ${dropped.length} of the ${listed} manifest(s) listed at that ref are UNUSABLE` +
          ` (see the WARN line(s) above — each carries its own cause).`,
      );
      // 🔴 SAY ONLY WHAT WAS MEASURED. This message has now been wrong three
      // times, each time by asserting something about manifests it had NOT read:
      //   v1  "every one is UNREADABLE"          — false of the ones it read fine
      //   v2  "the population … could not be used" — same claim, moved to prose
      //   v3  "repairing the unusable ones ALONE will floor again"
      // v3 is the subtlest and the worst, because it is ADVICE. Whether an
      // unusable manifest is publishable is UNKNOWABLE here — that is the entire
      // reason this floored — so "repairing them is not enough" asserts the
      // pessimistic branch of an unknown as fact. Measured on the mixed fixture:
      // restore just the two damaged blobs and the run exits 0.
      //
      // So the conditional states the KNOWN counts and marks the unknown as
      // unknown. It does not tell the operator what repairing will achieve.
      if (dropped.length === listed) {
        console.error('       So packages/ is NOT empty at that ref: every manifest it lists is one');
        console.error('       this guard could not use.');
      } else {
        console.error(
          `       So packages/ is NOT empty at that ref: the other ${listed - dropped.length} manifest(s)` +
            ` read fine and`,
        );
        console.error('       declared nothing publishable (private, or no name/version).');
      }
      console.error('       Whether any UNUSABLE manifest is publishable cannot be known from here —');
      console.error('       that is precisely why this floored rather than passing. Repair them and');
      console.error('       re-run: that either clears this, or proves the remaining ones really are');
      console.error('       all non-publishable.');
      console.error('       A manifest becomes unusable when the object store cannot produce the blob');
      console.error('       (a corrupt object, or a blob-filtered clone whose promisor is unreachable —');
      console.error('       a REACHABLE one would have fetched it and this would not have fired), or');
      console.error('       when the committed JSON does not parse. The WARN line above names which.');
      console.error('       The working copy on disk is irrelevant here: this guard reads the ref.');
    } else {
      console.error('       Expected at least one non-private packages/*/package.json.');
    }
    console.error('       Refusing to report success for a check that inspected nothing.');
    process.exit(1);
  }

  // Naming the SOURCE is load-bearing, not decoration: reading the working tree
  // instead of the committed one is what made this step fail every release run
  // with a pending changeset, and the log gave no way to see which it had read.
  console.log(
    `registry ${REGISTRY} · ${TRIES} attempt(s) x ${DELAY_MS}ms · ${TIMEOUT_MS}ms timeout · ` +
      `${pkgs.length} package(s) from ${source}`,
  );

  // 🔴 PARTIAL damage — some manifests unusable, others fine — reaches HERE, not
  // the floor, because `pkgs` is non-empty. Every check below then runs against a
  // SILENTLY SHRUNK population and reports `OK: 2/2 … 0 missing`, which is a true
  // sentence about a set nobody chose. The per-entry WARNs are emitted way back in
  // the reader, far above this line and easily lost in a long run log, so restate
  // it adjacent to the count it qualifies.
  //
  // Deliberately NOT a failure: this is a diagnostics change, and turning a
  // partially-damaged store into a red release is a verdict change that wants its
  // own decision. The gap is now VISIBLE rather than closed.
  if (dropped.length > 0) {
    console.warn(
      `WARN the population above is INCOMPLETE — ${dropped.length} of ${listed} manifest(s) at` +
        ` ${source} were unusable and are NOT checked below.`,
    );
  }

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

  // 🔴 FLOOR: nothing was CONFIRMED, and at least one package looked merely
  // "new". The never-published arm would otherwise report that as success — a
  // wrong NPM_REGISTRY, a registry answering 404 fleet-wide, or an access
  // change all land here, and "0 confirmed" reads exactly like a checker wired
  // to nothing. Same reasoning as the empty-packages guard above, which this
  // arm had quietly punched a hole in.
  //
  // Keyed on `> 0`, NOT on `=== pkgs.length`: an earlier revision only fired
  // when EVERY package was unknown, so a MIXED run (some new, some
  // unreachable — exactly what a partial rate-limit produces, and this script
  // doubles request volume on a failing run) still printed a green `OK: 0/5`.
  // The rule is "confirmed nothing", not "every single one was unknown".
  if (published.length === 0 && neverPublished.length > 0) {
    // The hatch is consulted BEFORE printing, so a deliberate first-ever
    // release does not emit a six-line ERROR block on a run that then passes.
    if (process.env.PUBLISH_CHECK_ALLOW_NONE_PUBLISHED === '1') {
      console.warn('\nConfirmed 0 packages, but PUBLISH_CHECK_ALLOW_NONE_PUBLISHED=1 — proceeding anyway.');
    } else {
      console.error('');
      console.error('ERROR: confirmed ZERO published packages.');
      console.error('       That is indistinguishable from a check wired to nothing, so it fails');
      console.error('       rather than reporting the never-published packages as a success.');
      console.error(`       Registry asked: ${REGISTRY}`);
      console.error('       Likely a wrong NPM_REGISTRY, a registry-wide outage answering 404, or');
      console.error('       an access change. If this really is a first-ever release of every');
      console.error('       package, set PUBLISH_CHECK_ALLOW_NONE_PUBLISHED=1 for that one run.');
      console.error('');
      process.exit(1);
    }
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
