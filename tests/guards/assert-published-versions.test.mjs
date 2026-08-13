/**
 * Tests for scripts/assert-published-versions.mjs.
 *
 * The guard is run BYTE-FOR-BYTE as CI runs it (copied into a synthetic tree by
 * `createFixture`), against a stand-in registry, so the suite is offline and
 * deterministic. `PUBLISH_CHECK_TRIES=1` / `PUBLISH_CHECK_DELAY=0` in every case
 * except the retry test — otherwise the failure paths would each sleep through
 * the real 5x3s backoff.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFixture, destroyFixture, runGuard, startFakeRegistry, DEFAULT_PACKAGES } from './fixture.mjs';

const SCRIPT = 'assert-published-versions.mjs';
const FAST = { PUBLISH_CHECK_TRIES: '1', PUBLISH_CHECK_DELAY: '0' };

/**
 * A registry with a hand-written response function, for the shapes
 * `startFakeRegistry` deliberately cannot express: a 2xx carrying the wrong
 * body, a 410, and a package that 404s N times before appearing (publish
 * propagation). Returns { origin, hits, close }.
 */
async function startScriptedRegistry(respond) {
  const hits = [];
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url || '');
    hits.push(url);
    const r = respond(url, hits.filter((h) => h === url).length) || { status: 404, body: { error: 'Not found' } };
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  };
}

/** The five default packages at their default versions, as a registry map. */
const V = () => {
  const m = {};
  for (const { name, version } of Object.values(DEFAULT_PACKAGES)) m[name] = version;
  return m;
};

/** Registry map where every default package resolves at its own version. */
function allPublished() {
  const m = {};
  for (const { name, version } of Object.values(DEFAULT_PACKAGES)) m[name] = version;
  return m;
}

describe('assert-published-versions', () => {
  let reg;
  before(async () => {
    reg = await startFakeRegistry(allPublished());
  });
  after(async () => {
    await reg.close();
  });

  test('PASSES when every publishable package version exists on the registry', async () => {
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /5\/5 publishable package version\(s\) confirmed/);
      assert.match(r.out, /0 missing/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('POSITIVE CONTROL: it actually requests the EXACT version, not /latest', async () => {
    // A guard that issued no request, or asked `/latest`, would pass the case
    // above for the wrong reason — /latest answers about a different version and
    // cannot see the failed-publish state this guard exists to catch.
    const local = await startFakeRegistry(allPublished());
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: local.origin, ...FAST });
      assert.equal(r.code, 0, r.out);
      assert.equal(local.hits.length, 5, `expected 5 registry requests, got ${local.hits.length}`);
      for (const h of local.hits) {
        assert.doesNotMatch(h, /\/latest$/, `guard asked /latest: ${h}`);
      }
      assert.ok(
        local.hits.includes('/@civitai/app-sdk/0.31.0'),
        `expected an exact-version request, got ${JSON.stringify(local.hits)}`,
      );
    } finally {
      destroyFixture(dir);
      await local.close();
    }
  });

  test('FAILS when a package version is NOT on the registry (the merged-but-publish-failed state)', async () => {
    // The registry is one minor BEHIND what the tree claims — byte-identical to
    // a Version PR that merged while the publish job failed.
    const behind = await startFakeRegistry({ ...allPublished(), '@civitai/app-sdk': '0.30.0' });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: behind.origin, ...FAST });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /PUBLISH DID NOT HAPPEN/);
      assert.match(r.out, /@civitai\/app-sdk@0\.31\.0/);
      // and it must NOT claim success for the others in the same breath
      assert.doesNotMatch(r.out, /0 missing/);
    } finally {
      destroyFixture(dir);
      await behind.close();
    }
  });

  test('FAILS when there is no publishable package at all (a zero must not read as a pass)', async () => {
    const dir = createFixture({ scripts: [SCRIPT], packages: null });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /no publishable package found/);
      assert.match(r.out, /inspected nothing/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('SKIPS a private package rather than demanding it be published', async () => {
    // `@civitai/theme` is marked private here and given NO registry entry: if the
    // guard inspected it anyway, the missing entry would 404 and fail the run.
    const partial = await startFakeRegistry({
      '@civitai/app-sdk': '0.31.0',
      '@civitai/blocks-react': '0.39.0',
      '@civitai/components': '0.3.0',
      '@civitai/components-react': '0.3.0',
    });
    const dir = createFixture({
      scripts: [SCRIPT],
      packages: { ...DEFAULT_PACKAGES, 'civitai-theme': { name: '@civitai/theme', version: '0.2.0', private: true } },
    });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: partial.origin, ...FAST });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /4\/4 publishable package version\(s\) confirmed/);
      assert.doesNotMatch(r.out, /@civitai\/theme/);
    } finally {
      destroyFixture(dir);
      await partial.close();
    }
  });

  test('SKIPS GRACEFULLY (exit 0) when the registry is unreachable — a blip must not red a release', async () => {
    const down = await startFakeRegistry({
      '@civitai/app-sdk': 'error',
      '@civitai/blocks-react': 'error',
      '@civitai/components': 'error',
      '@civitai/components-react': 'error',
      '@civitai/theme': 'error',
    });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: down.origin, ...FAST });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /unreachable for every package/);
      assert.match(r.out, /HTTP 503/);
    } finally {
      destroyFixture(dir);
      await down.close();
    }
  });

  // ---- create-PR mode vs publish mode (live failure, run 31665922710) -----

  /**
   * Replay what `changesets/action@v1` (commitMode `git-cli`) ACTUALLY does in
   * create-Version-PR mode, taken from run 31665922710's own log:
   *
   *     git checkout -b changeset-release/main
   *     git reset --hard $GITHUB_SHA
   *     pnpm changeset version            # rewrites package.json
   *     git add . && git commit           # <-- IT COMMITS
   *     git push origin HEAD:changeset-release/main --force
   *
   * The commit is the part a first attempt at this fix got wrong: it assumed
   * the rewrite was left uncommitted, so reading HEAD would step around it.
   * HEAD ends up ON the bumped commit, so that fix was inert.
   *
   * Returns the sha of the pre-bump commit — i.e. what $GITHUB_SHA holds.
   */
  function replayCreatePrMode(dir, bumped) {
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q');
    g('config', 'user.email', 'test@example.invalid');
    g('config', 'user.name', 'test');
    g('add', '-A');
    g('commit', '-qm', 'published state');
    const triggeringSha = g('rev-parse', 'HEAD').toString().trim();

    g('checkout', '-q', '-b', 'changeset-release/main');
    g('reset', '-q', '--hard', triggeringSha);
    for (const [d, meta] of Object.entries(DEFAULT_PACKAGES)) {
      if (!bumped[meta.name]) continue;
      const f = join(dir, 'packages', d, 'package.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.version = bumped[meta.name];
      writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
    }
    g('add', '.');
    g('commit', '-qm', 'chore(release): version packages');
    return triggeringSha;
  }

  test('create-PR mode: reads $GITHUB_SHA, so the Version PR bump cannot fail the release', async () => {
    // THE REGRESSION, modelled on the real sequence rather than an imagined one.
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const sha = replayCreatePrMode(dir, { '@civitai/app-sdk': '0.99.0', '@civitai/blocks-react': '0.98.0' });
      // The registry knows only the versions at the TRIGGERING commit.
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /from \$GITHUB_SHA/);
      assert.match(r.out, /5\/5 publishable package version\(s\) confirmed/);
      assert.doesNotMatch(r.out, /0\.99\.0/);
      assert.doesNotMatch(r.out, /PUBLISH DID NOT HAPPEN/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('CONTROL: the SAME replay without $GITHUB_SHA falls back to HEAD and FAILS — HEAD is on the bumped commit', async () => {
    // This is the control that the first attempt at this fix lacked, and it is
    // why that attempt shipped inert: reading HEAD is NOT equivalent to reading
    // the triggering commit, because the action commits and leaves HEAD there.
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      replayCreatePrMode(dir, { '@civitai/app-sdk': '0.99.0' });
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST }); // no GITHUB_SHA
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /from HEAD/);
      assert.match(r.out, /PUBLISH DID NOT HAPPEN/);
      assert.match(r.out, /@civitai\/app-sdk@0\.99\.0/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('publish mode: $GITHUB_SHA IS the bumped commit, so a genuine failed publish is still caught', async () => {
    // The guard must not be weakened into never failing. In publish mode the
    // triggering commit carries the new versions, and if the publish did not
    // land them this must still be a hard failure.
    const dir = createFixture({ scripts: [SCRIPT] });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      const f = join(dir, 'packages', 'civitai-app-sdk', 'package.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.version = '0.99.0'; // the merged Version PR's version
      writeFileSync(f, JSON.stringify(j, null, 2) + '\n');
      g('add', '-A');
      g('commit', '-qm', 'chore(release): version packages');
      const sha = g('rev-parse', 'HEAD').toString().trim();

      // registry never got 0.99.0 -> the publish silently did not happen
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /PUBLISH DID NOT HAPPEN/);
      assert.match(r.out, /@civitai\/app-sdk@0\.99\.0/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('an UNREADABLE $GITHUB_SHA skips loudly — it must NOT fall back to the working tree', async () => {
    // Falling back to the working tree here would hard-FAIL a healthy release,
    // because in create-PR mode that tree holds the Version PR's unpublished
    // versions — the #232 bug under a different trigger.
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const sha = replayCreatePrMode(dir, { '@civitai/app-sdk': '0.99.0' });
      const bogus = `${sha.slice(0, 39)}${sha[39] === 'a' ? 'b' : 'a'}`;
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: bogus });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /could not be read/);
      assert.match(r.out, /SKIP the publish assertion/);
      // the working tree's unpublished 0.99.0 must never have been asserted
      assert.doesNotMatch(r.out, /PUBLISH DID NOT HAPPEN/);
      assert.doesNotMatch(r.out, /0\.99\.0/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('a READABLE ref with nothing publishable still hits the FLOOR — even with $GITHUB_SHA set', async () => {
    // The regression this pins: collapsing "ref unreadable" and "ref read fine,
    // nothing publishable" into one empty return sent the second down the
    // indeterminate skip. Since CI ALWAYS sets $GITHUB_SHA, the documented
    // fail-loud floor became unreachable in the only environment that runs it —
    // and it reported "could not be read" about a ref it had read perfectly.
    const dir = createFixture({
      scripts: [SCRIPT],
      packages: { priv: { name: '@civitai/priv', version: '1.0.0', private: true } },
    });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      g('add', 'scripts', 'packages');
      g('commit', '-qm', 'only private packages');
      const sha = g('rev-parse', 'HEAD').toString().trim();

      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /no publishable package found/);
      // and it must NOT misreport a ref it read fine as unreadable
      assert.doesNotMatch(r.out, /could not be read/);
      assert.doesNotMatch(r.out, /SKIP the publish assertion/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('packages/ ABSENT at a READABLE ref floors — it must not be called "unreadable"', async () => {
    // The second entry point into the same regression, and the one the test
    // above cannot reach: `ls-tree` succeeds but lists no manifests. Conflating
    // that with "the ref could not be read" routed it to a silent exit 0.
    //
    // $GITHUB_SHA is deliberately an EARLIER commit than HEAD, so the
    // indeterminate arm is genuinely available if the code takes it — without
    // that, this could pass for the wrong reason.
    const dir = createFixture({ scripts: [SCRIPT] });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      g('add', 'scripts'); // packages/ NOT committed here
      g('commit', '-qm', 'scripts only');
      const refSha = g('rev-parse', 'HEAD').toString().trim();
      g('add', 'packages'); // now packages/ exists, so HEAD !== refSha
      g('commit', '-qm', 'add packages');
      assert.notEqual(g('rev-parse', 'HEAD').toString().trim(), refSha);

      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: refSha });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /no publishable package found/);
      assert.doesNotMatch(r.out, /could not be read/);
      assert.doesNotMatch(r.out, /SKIP the publish assertion/);
    } finally {
      destroyFixture(dir);
    }
  });

  /**
   * Damage the object store the way F1 was observed: commit `packages/`, then
   * DELETE the loose blob object behind every manifest. `ls-tree` still lists
   * them (the tree object is intact) and `git show <ref>:<path>` then fails per
   * manifest — which is exactly the shape a `--filter=blob:none` partial clone
   * with an unreachable promisor produces, without needing a promisor remote.
   *
   * `git gc`/repack would fold these into a packfile; a fresh `git init` +
   * single commit leaves them loose, and the assertion below on `unlinkSync`
   * having something to unlink is what keeps this test from silently becoming a
   * no-op if that ever changes.
   *
   * Returns the sha whose manifests are now unreadable.
   */
  function replayDamagedObjectStore(dir) {
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    g('init', '-q');
    g('config', 'user.email', 'test@example.invalid');
    g('config', 'user.name', 'test');
    g('add', '-A');
    g('commit', '-qm', 'published state');
    const sha = g('rev-parse', 'HEAD').toString().trim();

    const listed = g('ls-tree', '-r', '--name-only', sha, 'packages/')
      .toString()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^packages\/[^/]+\/package\.json$/.test(l));
    assert.ok(listed.length > 0, 'fixture must commit at least one packages/*/package.json');

    for (const path of listed) {
      const blob = g('rev-parse', `${sha}:${path}`).toString().trim();
      const obj = join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
      unlinkSync(obj); // throws if the object was packed — a silent no-op here would gut the test
    }
    // POSITIVE CONTROL on the damage itself: the ref must still LIST them and
    // must no longer be able to READ them. Without this the test could pass
    // because the store is fine and packages/ is simply empty — the very
    // conflation it exists to pin.
    assert.equal(
      g('ls-tree', '-r', '--name-only', sha, 'packages/').toString().trim().split('\n').length,
      listed.length,
      'ls-tree must still list the manifests',
    );
    assert.throws(() => g('show', `${sha}:${listed[0]}`), 'the blob must now be unreadable');
    return sha;
  }

  test('DAMAGED object store: the floor names the ref and says UNREADABLE, not "packages/ is empty"', async () => {
    // F1. The verdict (exit 1) was always right; the DIAGNOSIS was written for
    // the filesystem reader and survived the move to reading a git ref, so it
    // sent an operator to look at files that are sitting readable on disk and
    // named no ref at all. The line that would have named it
    // (`… N package(s) from <source>`) prints AFTER the floor and is
    // unreachable on this path.
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const sha = replayDamagedObjectStore(dir);
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });

      assert.equal(r.code, 1, r.out); // unchanged: a zero must still fail loud
      // 1. it names the ref it inspected — the whole point of the fix
      assert.match(r.out, /no publishable package found in \$GITHUB_SHA \(/);
      assert.match(r.out, new RegExp(sha.slice(0, 7)));
      // 2. it reports the population it COULD NOT read, rather than implying none existed
      assert.match(r.out, /5 manifest\(s\) ARE listed at that ref and every one is UNREADABLE/);
      assert.match(r.out, /damaged or partial object store/);
      // 3. and it must not have taken the indeterminate SKIP path — the ref read fine
      assert.doesNotMatch(r.out, /could not be read/);
      assert.doesNotMatch(r.out, /SKIP the publish assertion/);
      // 4. the stale wording must be GONE on this path, not merely joined
      assert.doesNotMatch(r.out, /Expected at least one non-private/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('CONTROL: a genuinely empty packages/ must NOT claim a damaged object store', async () => {
    // The other arm of the same branch. Without this, a floor that printed the
    // damage text unconditionally would pass the test above while being just as
    // wrong as the message it replaced — the new diagnosis has to DISCRIMINATE,
    // not merely exist.
    const dir = createFixture({
      scripts: [SCRIPT],
      packages: { priv: { name: '@civitai/priv', version: '1.0.0', private: true } },
    });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      g('add', 'scripts', 'packages');
      g('commit', '-qm', 'only private packages');
      const sha = g('rev-parse', 'HEAD').toString().trim();

      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(r.code, 1, r.out);
      // it still names the ref …
      assert.match(r.out, /no publishable package found in \$GITHUB_SHA \(/);
      // … but nothing was dropped, so the damage diagnosis must stay silent
      assert.doesNotMatch(r.out, /UNREADABLE/);
      assert.doesNotMatch(r.out, /damaged or partial object store/);
      assert.match(r.out, /Expected at least one non-private/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('the source label names the EXACT ref read — asserted per-arm, not by an alternation', async () => {
    // An alternation like /FALLBACK|not a git checkout/ is satisfied by EITHER
    // label, so swapping the two survives it. Each arm is pinned separately,
    // and each must NOT print the other's label.
    const noGit = createFixture({ scripts: [SCRIPT] }); // plain temp dir, no git
    try {
      const r = await runGuard(noGit, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /from working tree \(not a git checkout\)/);
      assert.doesNotMatch(r.out, /FALLBACK/);
      assert.doesNotMatch(r.out, /\$GITHUB_SHA/);
    } finally {
      destroyFixture(noGit);
    }

    const gitDir = createFixture({ scripts: [SCRIPT] });
    try {
      const sha = replayCreatePrMode(gitDir, { '@civitai/app-sdk': '0.99.0' });
      const r = await runGuard(gitDir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      // names the ref AND a resolved short sha, so "which commit" is legible
      assert.match(r.out, /from \$GITHUB_SHA \([0-9a-f]{7,}\)/);
      assert.doesNotMatch(r.out, /not a git checkout/);
      assert.doesNotMatch(r.out, /FALLBACK/);
    } finally {
      destroyFixture(gitDir);
    }
  });

  // ---- the never-published arm (audit finding 1) --------------------------

  test('WARNS, does not fail, for a package npm has never heard of (a package being INTRODUCED)', async () => {
    // A new package sits in the tree at a version that has never been
    // published, by design. Failing here would red the Release workflow on main
    // on every push until the Version PR merged.
    const reg2 = await startFakeRegistry(V()); // knows nothing of the new package
    const dir = createFixture({
      scripts: [SCRIPT],
      packages: { ...DEFAULT_PACKAGES, 'civitai-brand-new': { name: '@civitai/brand-new', version: '0.0.0' } },
    });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg2.origin, ...FAST });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /NEW\s+@civitai\/brand-new@0\.0\.0/);
      assert.match(r.out, /1 never-published \(new\)/);
      assert.doesNotMatch(r.out, /PUBLISH DID NOT HAPPEN/);
      // and the other five are still genuinely confirmed, not waved through
      assert.match(r.out, /5\/6 publishable package version\(s\) confirmed/);
    } finally {
      destroyFixture(dir);
      await reg2.close();
    }
  });

  test('still FAILS when the NAME is known but the version is absent (the arm above must not swallow it)', async () => {
    // The disambiguation must not turn every 404 into a shrug. Registry knows
    // @civitai/app-sdk (at an older version) but not the version in the tree.
    const behind = await startFakeRegistry({ ...V(), '@civitai/app-sdk': '0.30.0' });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: behind.origin, ...FAST });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /PUBLISH DID NOT HAPPEN/);
      assert.match(r.out, /npm knows this package NAME but not this VERSION/);
      assert.doesNotMatch(r.out, /NEW\s+@civitai\/app-sdk/);
      // it must have actually issued the name probe to reach that conclusion
      assert.ok(behind.hits.includes('/@civitai/app-sdk'), JSON.stringify(behind.hits));
    } finally {
      destroyFixture(dir);
      await behind.close();
    }
  });

  // ---- fail-closed on a 2xx contract violation (audit finding 2) ----------

  test('FAILS (not "unreachable") when the registry answers 200 with no version field', async () => {
    const weird = await startScriptedRegistry(() => ({ status: 200, body: { name: 'x', 'dist-tags': { latest: '1' } } }));
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: weird.origin, ...FAST });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /contract violation/);
      assert.match(r.out, /no version field/);
      // Assert it did not take the GRACEFUL-SKIP PATH. Not `/unreachable/` —
      // that word appears in the error's own prose explaining it is not an
      // outage, so matching on it tests the wording, not the behaviour.
      assert.doesNotMatch(r.out, /^SKIP /m);
      assert.doesNotMatch(r.out, /skipping the publish assertion/);
    } finally {
      destroyFixture(dir);
      await weird.close();
    }
  });

  test('FAILS when the registry answers 200 with a DIFFERENT version than requested', async () => {
    const wrong = await startScriptedRegistry(() => ({ status: 200, body: { name: 'x', version: '9.9.9' } }));
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      // TRIES=3 on purpose: a contract violation will not fix itself by
      // waiting, so it must NOT be retried. Exactly one request per package
      // (5), not 5x3 — this pins the short-circuit, which a pure pass/fail
      // assertion cannot distinguish from retrying and failing anyway.
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: wrong.origin,
        PUBLISH_CHECK_TRIES: '3',
        PUBLISH_CHECK_DELAY: '0',
      });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /contract violation/);
      assert.match(r.out, /version 9\.9\.9/);
      assert.equal(wrong.hits.length, 5, `expected 1 request per package, got ${JSON.stringify(wrong.hits)}`);
    } finally {
      destroyFixture(dir);
      await wrong.close();
    }
  });

  test('treats HTTP 410 as absent, not as an outage', async () => {
    // 410 Gone is npm's unpublished-package status; routing it to the graceful
    // skip would let an unpublished version pass.
    const gone = await startScriptedRegistry((url) =>
      url === '/@civitai/app-sdk/0.31.0'
        ? { status: 410, body: { error: 'gone' } }
        : url === '/@civitai/app-sdk'
          ? { status: 200, body: { name: '@civitai/app-sdk', 'dist-tags': { latest: '0.30.0' } } }
          : { status: 200, body: { name: 'x', version: url.split('/').pop() } },
    );
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: gone.origin, ...FAST });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /PUBLISH DID NOT HAPPEN/);
      assert.match(r.out, /HTTP 410/);
    } finally {
      destroyFixture(dir);
      await gone.close();
    }
  });

  // ---- the retry-then-SUCCEED path (audit finding 7) ---------------------

  test('RETRIES then SUCCEEDS when a version appears mid-backoff (publish propagation), and stops there', async () => {
    // This is the entire reason retries exist and it previously had NO test:
    // the suite only covered retry-then-fail, so nothing pinned the success
    // short-circuit or the attempt reporting.
    const TARGET = '/@civitai/app-sdk/0.31.0';
    const late = await startScriptedRegistry((url, nth) => {
      if (url === TARGET) {
        return nth < 3
          ? { status: 404, body: { error: 'not yet' } }
          : { status: 200, body: { name: '@civitai/app-sdk', version: '0.31.0' } };
      }
      return { status: 200, body: { name: 'x', version: url.split('/').pop() } };
    });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: late.origin,
        PUBLISH_CHECK_TRIES: '5',
        PUBLISH_CHECK_DELAY: '0',
      });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /after 3 attempts — publish propagation/);
      assert.match(r.out, /5\/5 publishable package version\(s\) confirmed/);
      // STOPS at success: exactly 3 requests for the target, not the full 5.
      assert.equal(late.hits.filter((h) => h === TARGET).length, 3, JSON.stringify(late.hits));
      // and it never fell through to the never-published probe
      assert.doesNotMatch(r.out, /NEW\s+@civitai\/app-sdk/);
    } finally {
      destroyFixture(dir);
      await late.close();
    }
  });

  test('reports the PAIRED count honestly in a MIXED state — confirmed numerator, not the package total', async () => {
    // Pins the anti-vacuous-zero instrument itself: the numerator must be what
    // was actually confirmed, so it cannot be replaced by a value that is true
    // by construction.
    const partial = await startFakeRegistry({ ...V(), '@civitai/theme': 'error' });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: partial.origin, ...FAST });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /4\/5 publishable package version\(s\) confirmed/);
      assert.match(r.out, /1 unverified \(registry unreachable\)/);
      assert.doesNotMatch(r.out, /5\/5/);
    } finally {
      destroyFixture(dir);
      await partial.close();
    }
  });

  // ---- transients must not masquerade as verdicts (delta-audit round 2) ---

  test('a body-read failure after a 2xx is UNREACHABLE, not a contract violation', async () => {
    // The request can fail AFTER the status line. Folding that into a null body
    // mislabelled a transport transient as a registry contract violation, which
    // fails closed and is not retried. Server sends 200 + a truncated body and
    // never finishes it.
    const stall = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
      res.write('{"name":"x","ver');
      // never end -> body read fails once the request times out
    });
    await new Promise((r) => stall.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${stall.address().port}`;
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: origin,
        PUBLISH_CHECK_TRIES: '1',
        PUBLISH_CHECK_DELAY: '0',
        PUBLISH_CHECK_TIMEOUT: '300',
      });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /body read failed/);
      assert.doesNotMatch(r.out, /contract violation/);
      assert.doesNotMatch(r.out, /PUBLISH DID NOT HAPPEN/);
    } finally {
      destroyFixture(dir);
      stall.closeAllConnections();
      await new Promise((r) => stall.close(r));
    }
  });

  test('honours PUBLISH_CHECK_TIMEOUT — a server that never answers is unreachable, not a failure', async () => {
    // Pins the timeout itself: deleting the `signal:` option previously passed
    // every test, and without it a hung connection falls back to ~300s.
    const blackhole = createServer(() => {
      /* never respond */
    });
    await new Promise((r) => blackhole.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${blackhole.address().port}`;
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const started = Date.now();
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: origin,
        PUBLISH_CHECK_TRIES: '1',
        PUBLISH_CHECK_DELAY: '0',
        PUBLISH_CHECK_TIMEOUT: '250',
      });
      const elapsed = Date.now() - started;
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /skipping the publish assertion/);
      // It must have given up on the configured budget, not undici's ~300s.
      assert.ok(elapsed < 20000, `took ${elapsed}ms — the timeout did not fire`);
    } finally {
      destroyFixture(dir);
      blackhole.closeAllConnections();
      await new Promise((r) => blackhole.close(r));
    }
  });

  test('an unreachable NAME PROBE does not settle the verdict — it skips, and it retries', async () => {
    // The version 404s (looks absent) but the name probe 503s, so "publish
    // failed" and "new package" cannot be told apart. Answering either way
    // would be a guess.
    const flaky = await startScriptedRegistry((url) =>
      url === '/@civitai/app-sdk' ? { status: 503, body: { error: 'rate limited' } } : { status: 404, body: { error: 'nope' } },
    );
    const dir = createFixture({ scripts: [SCRIPT], packages: { 'civitai-app-sdk': DEFAULT_PACKAGES['civitai-app-sdk'] } });
    try {
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: flaky.origin,
        PUBLISH_CHECK_TRIES: '2',
        PUBLISH_CHECK_DELAY: '0',
      });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /name probe failed/);
      assert.doesNotMatch(r.out, /PUBLISH DID NOT HAPPEN/);
      assert.doesNotMatch(r.out, /^NEW /m);
      // retried rather than being settled by a single 503
      assert.equal(flaky.hits.filter((h) => h === '/@civitai/app-sdk').length, 2, JSON.stringify(flaky.hits));
    } finally {
      destroyFixture(dir);
      await flaky.close();
    }
  });

  test('FLOOR: confirming ZERO packages fails, even when every one looks merely "new"', async () => {
    // A wrong NPM_REGISTRY / fleet-wide 404 would otherwise report success via
    // the never-published arm. "0 confirmed" reads exactly like a check wired
    // to nothing.
    const empty = await startFakeRegistry({});
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: empty.origin, ...FAST });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /confirmed ZERO published packages/);
      assert.doesNotMatch(r.out, /^OK: /m);
    } finally {
      destroyFixture(dir);
      await empty.close();
    }
  });

  test('FLOOR also fires in a MIXED state — some "new", some unreachable, none confirmed', async () => {
    // The rule is "confirmed nothing", not "every single one was unknown". An
    // earlier revision keyed on `=== pkgs.length`, so this mixed shape — which
    // is exactly what a PARTIAL rate-limit produces, and this script doubles
    // request volume on a failing run — printed a green `OK: 0/5`.
    const mixed = await startFakeRegistry({
      // 2 unreachable, 3 absent entirely (=> "new"), 0 confirmable
      '@civitai/app-sdk': 'error',
      '@civitai/blocks-react': 'error',
    });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: mixed.origin, ...FAST });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /confirmed ZERO published packages/);
      assert.doesNotMatch(r.out, /^OK: /m);
    } finally {
      destroyFixture(dir);
      await mixed.close();
    }
  });

  test('asks for the ABBREVIATED packument on the name probe, not the full document', async () => {
    // The full packument lists every version ever published and can be
    // megabytes; this is also the request most exposed to the timeout budget.
    // Nothing pinned the header before, so dropping it was a silent mutation.
    const seen = [];
    const srv = createServer((req, res) => {
      seen.push({ url: decodeURIComponent(req.url || ''), accept: req.headers.accept || '' });
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'nope' }));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const dir = createFixture({ scripts: [SCRIPT], packages: { 'civitai-app-sdk': DEFAULT_PACKAGES['civitai-app-sdk'] } });
    try {
      await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: `http://127.0.0.1:${srv.address().port}`,
        ...FAST,
        PUBLISH_CHECK_ALLOW_NONE_PUBLISHED: '1',
      });
      const probe = seen.find((s) => s.url === '/@civitai/app-sdk');
      assert.ok(probe, `no name probe issued: ${JSON.stringify(seen)}`);
      assert.match(probe.accept, /application\/vnd\.npm\.install-v1\+json/);
      // and the plain-JSON fallback is still offered
      assert.match(probe.accept, /application\/json/);
      // the VERSION probe is a different request and does not need the abbreviated type
      const ver = seen.find((s) => s.url === '/@civitai/app-sdk/0.31.0');
      assert.ok(ver, `no version probe issued: ${JSON.stringify(seen)}`);
    } finally {
      destroyFixture(dir);
      srv.closeAllConnections();
      await new Promise((r) => srv.close(r));
    }
  });

  test('FLOOR has an explicit escape hatch for a genuine first-ever release', async () => {
    const empty = await startFakeRegistry({});
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: empty.origin,
        ...FAST,
        PUBLISH_CHECK_ALLOW_NONE_PUBLISHED: '1',
      });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /proceeding anyway/);
    } finally {
      destroyFixture(dir);
      await empty.close();
    }
  });

  test('RETRIES a 404 before failing — publish propagation must not read as a failed publish', async () => {
    // Same missing-version tree as the failure case, but with 3 attempts. The
    // guard must issue 3 requests for the missing package and SAY so, proving
    // the retry arm executed rather than being dead code that happens to pass.
    const behind = await startFakeRegistry({ ...allPublished(), '@civitai/app-sdk': '0.30.0' });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: behind.origin,
        PUBLISH_CHECK_TRIES: '3',
        PUBLISH_CHECK_DELAY: '0',
      });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /after 3 attempt\(s\)/);
      const sdkHits = behind.hits.filter((h) => h === '/@civitai/app-sdk/0.31.0');
      assert.equal(sdkHits.length, 3, `expected 3 retry requests, got ${sdkHits.length}`);
    } finally {
      destroyFixture(dir);
      await behind.close();
    }
  });
});
