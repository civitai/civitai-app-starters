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
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createFixture,
  destroyFixture,
  runGuard,
  startFakeRegistry,
  DEFAULT_PACKAGES,
  REPO_ROOT,
} from './fixture.mjs';

const SCRIPT = 'assert-published-versions.mjs';
const FAST = { PUBLISH_CHECK_TRIES: '1', PUBLISH_CHECK_DELAY: '0' };

/**
 * A registry with a hand-written response function, for the shapes
 * `startFakeRegistry` deliberately cannot express: a 2xx carrying the wrong
 * body, a 410, and a package that 404s N times before appearing (publish
 * propagation). Returns { origin, hits, rawHits, close }.
 *
 * 🔴 `respond` is handed the path with the QUERY STRING REMOVED, and the Nth-hit
 * counter counts stripped paths. The guard cache-busts every read with a unique
 * `?_cb=` param, so without stripping, every request would look like a distinct
 * URL: `respond` would never match its own target path, and `nth` would be 1
 * forever — silently breaking the retry/propagation tests, which depend on the
 * counter advancing, in a way that reads as a guard defect rather than a harness
 * one. Same contract as `startFakeRegistry`; see its note for why the real
 * registry behaves this way too.
 */
async function startScriptedRegistry(respond) {
  const hits = [];
  const rawHits = [];
  const server = createServer((req, res) => {
    const raw = decodeURIComponent(req.url || '');
    rawHits.push(raw);
    const url = raw.replace(/\?.*$/, '');
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
    rawHits,
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
   * Replay what `changesets/action` a45c4d5 / v1.9.0 (commitMode `git-cli`) ACTUALLY does in
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
      assertFloorIsIntact(r);
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
      assertFloorIsIntact(r);
    } finally {
      destroyFixture(dir);
    }
  });

  /** The short sha git itself would print for `ref`, so the expected floor line
   *  is derived from git rather than from a hardcoded slice length. */
  function shortSha(dir, ref) {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--short', ref], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  }

  /**
   * 🔴 `exit 1` DOES NOT PROVE THE FLOOR RAN. An uncaught throw inside main()
   * also exits 1, so `assert.equal(r.code, 1)` scores a floor that crashed
   * halfway through identically to one that completed. Measured: a throw injected
   * mid-floor is caught by this and by nothing else.
   *
   * (An earlier version of this comment said removing the `dropped = []` /
   * `listed = 0` destructure defaults produces that crash. At HEAD it does not —
   * removing them alone is green, because the one arm omitting both returns
   * before either is read. See the note above the destructure in the script,
   * which is the accurate one. Removing them TOGETHER with a reader arm's fields
   * does crash, and that pair is what this catches.)
   *
   * The trailing line is the floor's last statement before `process.exit(1)`, so
   * its presence is what distinguishes "ran to the end" from "died inside", and
   * a stack trace is what a crash leaves behind.
   */
  function assertFloorIsIntact(r) {
    // The trailing line is the floor's LAST statement before `process.exit(1)`,
    // so its absence is what a crash mid-floor looks like. (A `doesNotMatch` on
    // TypeError/ReferenceError was tried here and is strictly dead weight: any
    // crash removes this line, so this assertion always fires first. Kept as one
    // assertion rather than two so nothing reads as load-bearing when it isn't.)
    assert.match(r.out, /Refusing to report success for a check that inspected nothing\./);
  }

  /** The exact floor header, built once — it is asserted from two tests. */
  const floorHeader = (dir, sha) =>
    `ERROR: no publishable package found in $GITHUB_SHA (${shortSha(dir, sha)}) under packages/.`;

  /**
   * The floor's message, from its header to the END OF OUTPUT.
   *
   * 🔴 Pin the WHOLE BLOCK, not features of it. A `doesNotMatch(/every one/i)`
   * only forbids the synonym you happened to think of — a mutant phrasing the
   * same false universal as "Each and all of the manifests … is unusable"
   * survived it.
   *
   * 🔴 And the window runs to the END, not to the trailing line. An earlier
   * version stopped at "Refusing to report success", which left the most natural
   * place to add a summary sentence — immediately AFTER it, before the exit —
   * completely unpinned: a mutant appending "In short: every manifest listed at
   * that ref is unusable." there passed 55/55.
   *
   * 🔴 Output BEFORE the header is constrained too, rather than waved off: the
   * only thing legitimately printed there is the per-entry WARN block, so
   * anything else is a claim nobody pinned. A mutant printing the same false
   * universal above the header survived while this only checked forwards.
   */
  function floorBlock(r) {
    const lines = r.out.split('\n');
    const start = lines.findIndex((l) => l.startsWith('ERROR: no publishable package'));
    assert.ok(start >= 0, `no floor block in:\n${r.out}`);
    assert.ok(
      lines.some((l) => l.includes('Refusing to report success')),
      `floor block never terminated in:\n${r.out}`,
    );
    for (const [i, l] of lines.slice(0, start).entries()) {
      assert.ok(
        l === '' || l.startsWith('WARN '),
        `line ${i} precedes the floor header and is neither blank nor a WARN: ${JSON.stringify(l)}`,
      );
    }
    // trailing blank lines are an artefact of the final newline, not content
    const out = lines.slice(start);
    while (out.length && out[out.length - 1] === '') out.pop();
    return out;
  }

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

  test('DAMAGED object store: the floor names the ref and says UNUSABLE, not "packages/ is empty"', async () => {
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

      // 1. it names the ref it inspected — the whole point of the fix.
      //
      // 🔴 Pin the sha ON THE FLOOR LINE ITSELF. A bare `match(r.out, <sha>)` is
      // satisfied by the WARN lines, which print `at <ref>` independently — so a
      // floor printing a WRONG sha (or a hardcoded one) passes it while the
      // property under test is gone. Assert the whole line as one unit instead.

      // 2. the ALL-unusable branch, pinned as a whole block for the same reason
      //    the mixed one is: two mutants reworded this arm (and one routed the
      //    MIXED prose through it, re-emitting "the other 0 manifest(s) …") and
      //    survived while only spelled regexes guarded it.
      assert.deepEqual(floorBlock(r), [
        floorHeader(dir, sha),
        '       5 of the 5 manifest(s) listed at that ref are UNUSABLE (see the WARN line(s) above — each carries its own cause).',
        '       So packages/ is NOT empty at that ref: every manifest it lists is one',
        '       this guard could not use.',
        '       Whether any UNUSABLE manifest is publishable cannot be known from here —',
        '       that is precisely why this floored rather than passing. Repair them and',
        '       re-run: that either clears this, or proves the remaining ones really are',
        '       all non-publishable.',
        '       A manifest becomes unusable when the object store cannot produce the blob',
        '       (a corrupt object, or a blob-filtered clone whose promisor is unreachable —',
        '       a REACHABLE one would have fetched it and this would not have fired), or',
        '       when the committed JSON does not parse. The WARN line above names which.',
        '       The working copy on disk is irrelevant here: this guard reads the ref.',
        '       Refusing to report success for a check that inspected nothing.',
      ]);
      // 3. and it must not have taken the indeterminate SKIP path — the ref read fine
      assert.doesNotMatch(r.out, /could not be read/);
      assert.doesNotMatch(r.out, /SKIP the publish assertion/);
      // 4. the stale wording must be GONE on this path, not merely joined
      assert.doesNotMatch(r.out, /Expected at least one non-private/);
      // 5. the floor must run to completion — see the note on `assertFloorIsIntact`
      assertFloorIsIntact(r);
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
      assert.doesNotMatch(r.out, /UNUSABLE/);
      assert.doesNotMatch(r.out, /packages\/ is NOT empty at that ref/);
      assert.match(r.out, /Expected at least one non-private/);
      assertFloorIsIntact(r);
    } finally {
      destroyFixture(dir);
    }
  });

  test('MIXED population: the floor reports dropped-of-listed, and does not overclaim', async () => {
    // The first version of this message said "N manifest(s) ARE listed at that
    // ref and every one is UNREADABLE" with N = dropped.length. When the ref
    // holds BOTH unusable and readable-but-private manifests, both halves of
    // that sentence are false: the count is the dropped count (not the listed
    // count), and "every one" is untrue of the ones that read fine. Which is a
    // fresh instance of the very defect this floor was rewritten to fix.
    const dir = createFixture({
      scripts: [SCRIPT],
      packages: {
        broken1: { name: '@civitai/broken1', version: '1.0.0' },
        broken2: { name: '@civitai/broken2', version: '1.0.0' },
        priv1: { name: '@civitai/priv1', version: '1.0.0', private: true },
        priv2: { name: '@civitai/priv2', version: '1.0.0', private: true },
        priv3: { name: '@civitai/priv3', version: '1.0.0', private: true },
      },
    });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      g('add', '-A');
      g('commit', '-qm', 'mixed');
      const sha = g('rev-parse', 'HEAD').toString().trim();
      // damage ONLY the two publishable ones; the three private ones read fine
      for (const d of ['broken1', 'broken2']) {
        const blob = g('rev-parse', `${sha}:packages/${d}/package.json`).toString().trim();
        unlinkSync(join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));
      }
      // control on the fixture: 5 listed, exactly 2 unreadable
      assert.equal(g('ls-tree', '-r', '--name-only', sha, 'packages/').toString().trim().split('\n').length, 5);
      assert.throws(() => g('show', `${sha}:packages/broken1/package.json`));
      assert.doesNotThrow(() => g('show', `${sha}:packages/priv1/package.json`));

      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(r.code, 1, r.out);
      // The WHOLE block, verbatim. Both counts appear and neither stands in for
      // the other; the three manifests it read fine are named as a CO-CAUSE
      // rather than folded into a universal claim; and no rephrasing can slip a
      // new universal past this.
      assert.deepEqual(floorBlock(r), [
        floorHeader(dir, sha),
        '       2 of the 5 manifest(s) listed at that ref are UNUSABLE (see the WARN line(s) above — each carries its own cause).',
        '       So packages/ is NOT empty at that ref: the other 3 manifest(s) read fine and',
        '       declared nothing publishable (private, or no name/version).',
        '       Whether any UNUSABLE manifest is publishable cannot be known from here —',
        '       that is precisely why this floored rather than passing. Repair them and',
        '       re-run: that either clears this, or proves the remaining ones really are',
        '       all non-publishable.',
        '       A manifest becomes unusable when the object store cannot produce the blob',
        '       (a corrupt object, or a blob-filtered clone whose promisor is unreachable —',
        '       a REACHABLE one would have fetched it and this would not have fired), or',
        '       when the committed JSON does not parse. The WARN line above names which.',
        '       The working copy on disk is irrelevant here: this guard reads the ref.',
        '       Refusing to report success for a check that inspected nothing.',
      ]);
    } finally {
      destroyFixture(dir);
    }
  });

  test('REPAIRING the unusable manifests ALONE can clear the floor — the message must not claim otherwise', async () => {
    // 🔴 The fact behind the third rewrite of this message. A round of this PR
    // shipped the advice "Repairing the unusable ones ALONE will floor again."
    // It is FALSE: whether an unusable manifest is publishable is exactly what
    // the guard could not determine, so the pessimistic branch of that unknown
    // is not a fact to state. Here the two damaged manifests ARE publishable, so
    // restoring only their blobs — touching nothing else — clears the floor.
    //
    // This test exists so that claim cannot be reintroduced: any message
    // asserting repair is insufficient is contradicted by this run.
    const dir = createFixture({
      scripts: [SCRIPT],
      packages: {
        broken1: { name: '@civitai/app-sdk', version: '0.31.0' },
        broken2: { name: '@civitai/theme', version: '0.2.0' },
        priv1: { name: '@civitai/priv1', version: '1.0.0', private: true },
        priv2: { name: '@civitai/priv2', version: '1.0.0', private: true },
        priv3: { name: '@civitai/priv3', version: '1.0.0', private: true },
      },
    });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      g('add', 'packages', 'scripts');
      g('commit', '-qm', 'mixed');
      const sha = g('rev-parse', 'HEAD').toString().trim();
      const objPath = (d) => {
        const b = g('rev-parse', `${sha}:packages/${d}/package.json`).toString().trim();
        return join(dir, '.git', 'objects', b.slice(0, 2), b.slice(2));
      };
      const damaged = [objPath('broken1'), objPath('broken2')];
      for (const o of damaged) unlinkSync(o);

      // BEFORE: floors, and says nothing about what repair will achieve
      const before = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(before.code, 1, before.out);
      assert.match(before.out, /2 of the 5 manifest\(s\)/);
      assert.doesNotMatch(before.out, /will floor again/);
      assert.doesNotMatch(before.out, /only PART of why/);

      // AFTER: restore ONLY the two blobs — the three private manifests are
      // untouched, so if they were the co-cause an earlier message claimed, this
      // would still floor. It does not.
      g('hash-object', '-w', join(dir, 'packages', 'broken1', 'package.json'));
      g('hash-object', '-w', join(dir, 'packages', 'broken2', 'package.json'));
      for (const o of damaged) assert.ok(existsSync(o), 'blob was not actually restored');

      const after = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(after.code, 0, after.out);
      assert.match(after.out, /2\/2 publishable package version\(s\) confirmed/);
      assert.doesNotMatch(after.out, /no publishable package found/);
      assert.doesNotMatch(after.out, /UNUSABLE/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('BOTH producers reach `dropped` — a malformed manifest is not blamed on the object store', async () => {
    // `dropped` is fed by two different failures: `git show` failing (the store
    // cannot produce the blob) and `JSON.parse` failing (the blob is fine and
    // the JSON is malformed). An earlier message asserted the first as THE
    // cause, so a committed syntax error on a `git fsck`-clean store was
    // diagnosed as "a damaged or partial object store … re-fetch and re-run" —
    // advice that cannot work, for a repo that is not damaged.
    const dir = createFixture({ scripts: [SCRIPT], packages: { bad: { name: '@civitai/bad', version: '1.0.0' } } });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      writeFileSync(join(dir, 'packages', 'bad', 'package.json'), '{ "name": "@civitai/bad", ');
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      g('add', '-A');
      g('commit', '-qm', 'malformed manifest');
      const sha = g('rev-parse', 'HEAD').toString().trim();
      // the store is HEALTHY — this is the whole point of the case
      assert.doesNotThrow(() => g('show', `${sha}:packages/bad/package.json`));
      assert.doesNotThrow(() => g('fsck', '--no-progress'));

      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /1 of the 1 manifest\(s\) listed at that ref are UNUSABLE/);
      // it may OFFER the store as one cause, but must not assert it as THE cause
      assert.doesNotMatch(r.out, /That is a damaged or partial object store/);
      // and the parser's own message must survive into the WARN, since that is
      // the only thing that tells the two producers apart
      assert.match(r.out, /WARN could not read packages\/bad\/package\.json/);
      assert.match(r.out, /JSON|Unexpected end|token/i);
      assertFloorIsIntact(r);
    } finally {
      destroyFixture(dir);
    }
  });

  test('PARTIAL damage does not reach the floor — the shrunk population must be stated, not hidden', async () => {
    // pkgs is NON-empty here, so every check runs and reports `OK: N/N … 0
    // missing` — a true sentence about a set nobody chose. The reader's WARNs
    // are emitted far above the summary and are easy to lose in a run log.
    // Exit 0 is deliberate (this is diagnostics, not a new verdict), so the
    // ONLY thing standing between an operator and a silently-shrunk population
    // is that the incompleteness is restated next to the count it qualifies.
    const dir = createFixture({
      scripts: [SCRIPT],
      // versions MUST match what the stand-in registry publishes, or this test
      // fails on a missing version and never reaches the property under test
      packages: {
        ok1: { name: '@civitai/app-sdk', version: '0.31.0' },
        ok2: { name: '@civitai/theme', version: '0.2.0' },
        gone: { name: '@civitai/blocks-react', version: '0.39.0' },
      },
    });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      g('add', '-A');
      g('commit', '-qm', 'three publishable');
      const sha = g('rev-parse', 'HEAD').toString().trim();
      const blob = g('rev-parse', `${sha}:packages/gone/package.json`).toString().trim();
      unlinkSync(join(dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)));

      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(r.code, 0, r.out); // unchanged verdict — 2 of 2 survivors are published
      assert.match(r.out, /2 package\(s\) from \$GITHUB_SHA/);
      // the count above is INCOMPLETE and must say so, adjacent to itself
      assert.match(r.out, /population above is INCOMPLETE — 1 of 3 manifest\(s\)/);
      assert.match(r.out, /NOT checked below/);
      // the floor must NOT have fired: this is not a zero
      assert.doesNotMatch(r.out, /no publishable package found/);
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
      // A DISK arm cannot observe an unusable manifest — it treats an unparseable
      // package.json as "not a workspace package" and skips it silently. So it must
      // never claim one, or the incompleteness warning becomes noise nobody trusts.
      assert.doesNotMatch(r.out, /population above is INCOMPLETE/);
      assert.doesNotMatch(r.out, /UNUSABLE/);
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

  test('PUBLISH_CHECK_FROM_DISK=1 reads the working tree, and claims no damage it cannot observe', async () => {
    // This arm had NO test at all, which is why a mutant returning a bogus
    // `dropped` from it survived the whole suite. It is the deliberate
    // reproduce-the-pre-fix-behaviour control, so it must stay reachable AND
    // stay honest: the disk reader cannot distinguish an unusable manifest from
    // a non-workspace directory, so it must never report one.
    const dir = createFixture({ scripts: [SCRIPT] }); // no git at all
    try {
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: reg.origin,
        ...FAST,
        PUBLISH_CHECK_FROM_DISK: '1',
      });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /5 package\(s\) from working tree \(PUBLISH_CHECK_FROM_DISK=1\)/);
      assert.doesNotMatch(r.out, /population above is INCOMPLETE/);
      assert.doesNotMatch(r.out, /UNUSABLE/);
    } finally {
      destroyFixture(dir);
    }
  });

  test('PUBLISH_CHECK_FROM_DISK BEATS a perfectly readable $GITHUB_SHA — proven by opposite verdicts', async () => {
    // 🔴 The precedence claim needs the two readers to DISAGREE. A fixture with
    // no git cannot test it: the git arm is unreadable either way, so
    // `doesNotMatch(/$GITHUB_SHA/)` passes for a reason that has nothing to do
    // with precedence. Measured: moving the FROM_DISK branch below the git read
    // and gating it on `fromGit.unreadable` — i.e. a readable ref WINS, the
    // opposite of the documented contract — survived the whole suite.
    //
    // Here the ref holds published versions and the working tree holds
    // unpublished ones, so the two readers give OPPOSITE verdicts and the flag's
    // precedence is the only thing that decides which.
    const dir = createFixture({ scripts: [SCRIPT] });
    const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      g('init', '-q');
      g('config', 'user.email', 'test@example.invalid');
      g('config', 'user.name', 'test');
      g('add', '-A');
      g('commit', '-qm', 'published versions');
      const sha = g('rev-parse', 'HEAD').toString().trim();
      // rewrite the WORKING TREE only — never committed, so the ref still holds 0.31.0
      const f = join(dir, 'packages', 'civitai-app-sdk', 'package.json');
      const j = JSON.parse(readFileSync(f, 'utf8'));
      j.version = '0.99.0'; // never published
      writeFileSync(f, JSON.stringify(j, null, 2) + '\n');

      // CONTROL: without the flag, the ref wins and the run is CLEAN.
      const viaRef = await runGuard(dir, SCRIPT, { NPM_REGISTRY: reg.origin, ...FAST, GITHUB_SHA: sha });
      assert.equal(viaRef.code, 0, viaRef.out);
      assert.match(viaRef.out, /from \$GITHUB_SHA/);
      assert.doesNotMatch(viaRef.out, /0\.99\.0/);

      // WITH the flag and the SAME readable ref: the disk wins, so the
      // uncommitted 0.99.0 is asserted and fails.
      const viaDisk = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: reg.origin,
        ...FAST,
        GITHUB_SHA: sha,
        PUBLISH_CHECK_FROM_DISK: '1',
      });
      assert.equal(viaDisk.code, 1, viaDisk.out);
      assert.match(viaDisk.out, /from working tree \(PUBLISH_CHECK_FROM_DISK=1\)/);
      assert.match(viaDisk.out, /@civitai\/app-sdk@0\.99\.0/);
      assert.doesNotMatch(viaDisk.out, /from \$GITHUB_SHA/);
    } finally {
      destroyFixture(dir);
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

  test('the missing-version remedy names STAGED publishing, not just "re-run" — re-running a staged version is an E409 loop', async () => {
    // The artifact under test here is PROSE, and prose guards are walkable by
    // rewording — so pin the whole normalised block rather than a keyword.
    //
    // What it protects: `missing` has two causes with OPPOSITE fixes, and an
    // anonymous 404 cannot tell them apart. Until 2026-09-03 this block said
    // only "re-run the release workflow, or publish this package manually",
    // which is correct for a failed publish and a DEAD END for a staged one —
    // staged and published versions share one semver index, so every re-run
    // returns `E409 Cannot publish over previously staged version` and only a
    // 2FA human running `npm stage approve`/`reject` can clear it. Measured on
    // release run 33785932215 (2026-09-03), where `changeset publish` reported
    // all four packages published, two actually were, and the wrong remedy was
    // the one on screen. See RELEASING.md § "Staged publishing".
    const behind = await startFakeRegistry({ ...V(), '@civitai/app-sdk': '0.30.0' });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: behind.origin, ...FAST });
      assert.equal(r.code, 1, r.out);

      const lines = r.out.split('\n').map((l) => l.trimEnd());

      // 🔴 THE CANNOT-TELL headline must come FIRST, and that is an ORDERING
      // claim: it has to reach the operator BEFORE the two-causes block offers
      // "re-run the release workflow" as cause 1. A blind re-run over a
      // partly-staged release is what published `blocks-react@0.45.1` while
      // `components@0.4.1` sat staged, and that is the state that ETARGETs every
      // consumer.
      const cannotTell = lines.findIndex((l) => l.includes('CANNOT TELL YOU WHICH CAUSE'));
      assert.ok(cannotTell >= 0, `no cannot-distinguish headline in:\n${r.out}`);

      const start = lines.findIndex((l) => l.includes('TWO causes produce this'));
      assert.ok(start >= 0, `no two-causes block in:\n${r.out}`);
      assert.ok(
        cannotTell < start,
        `the cannot-distinguish headline (line ${cannotTell}) must come BEFORE the two-causes ` +
          `block (line ${start}) — cause 1 there is "re-run", which is the move that breaks ` +
          `consumers when a version is staged.`,
      );

      // The whole remedy block, pinned as ONE normalised string. Prose guards are
      // walkable by rewording, and every sentence here is load-bearing: which
      // cause is asserted, which is merely named, and what the link is claimed to
      // prove. A cosmetic reword failing this test is the intended cost.
      assert.deepEqual(lines.slice(cannotTell, cannotTell + 47), [
        '       🔴 THIS GUARD CANNOT TELL YOU WHICH CAUSE THIS IS. DO NOT ASSUME.',
        '',
        '       It reads the registry ANONYMOUSLY, and an anonymous 404 is byte-identical',
        '       for a publish that failed and for a version npm STAGED instead of',
        '       publishing. Neither is more likely from what is printed above. A mix of',
        '       published and unpublished packages is NOT a staging signature — a partly',
        '       failed publish produces exactly the same mix.',
        '',
        '       TWO causes produce this, and they need OPPOSITE fixes:',
        '',
        '       1. the publish failed        -> re-running the release workflow fixes it.',
        '       2. npm STAGED the version    -> re-running is a DEAD END. A staged version',
        '          is invisible to anonymous reads and OCCUPIES ITS SEMVER SLOT, so every',
        '          re-run (and a manual `npm publish`) returns',
        '          `E409 Cannot publish over previously staged version`. Only a human with',
        '          2FA can clear it.',
        '',
        '       🔴 SETTLE WHICH ONE BEFORE YOU ACT. Staging is directly detectable, but',
        '       ONLY by an authenticated caller — that is why this guard cannot do it for',
        '       you. From a machine logged in to npm as a civitai org member:',
        '',
        '            npm whoami                     # E401 here => you are NOT logged in',
        '            npm stage list <package>       # the authoritative answer',
        '',
        '       Read `npm whoami` FIRST. `npm stage list` returns E401 from a machine that',
        '       is not logged in (measured 2026-09-03), and an E401 is an answer about',
        '       YOUR SESSION, not about whether anything is staged.',
        '',
        '            https://www.npmjs.com/settings/civitai/staged-packages',
        '',
        '       ⚠ That page is reachable ONLY while logged in as a civitai org member.',
        '       A 404/403 there does NOT establish that nothing is staged — npm answers',
        '       the same way for a signed-out or non-member request, so an empty staging',
        '       area and an unauthorised read are indistinguishable from the browser.',
        '       Treat the page as useful only when it LOADS; when it does not, the',
        '       `npm stage list` result above is the one that means something.',
        '',
        '       If it IS staged, only these finish it (both 2FA):',
        '',
        '            npm stage approve <stage-id>   # publish it',
        '            npm stage reject  <stage-id>   # free the slot',
        '',
        '       A BLIND RE-RUN OVER A PARTLY-STAGED RELEASE IS WHAT BREAKS CONSUMERS: it',
        '       publishes whichever half is not staged and strands the other, so a live',
        '       dependent exact-pins a staged dependency -> ETARGET on install for',
        '       everyone. That is not a risk, it is what happened on 2026-09-03.',
        '       Approve in DEPENDENCY ORDER; see RELEASING.md § "Staged publishing".',
      ]);

      // 🔴 THE OVERCLAIM MUST BE GONE, pinned as its own assertion so removing it
      // can never be an accident of rewording the block above. This exact
      // sentence failed a HEALTHY release (run 34908486900, 2026-09-14): both
      // packages had published and simply had not propagated, and the message
      // sent the operator into a 2FA staging recovery for a release that had
      // already succeeded. A partly-FAILED publish produces the same mix, so the
      // mix is a signature of nothing.
      assert.doesNotMatch(r.out, /IS the staged signature/);
      assert.doesNotMatch(r.out, /others did not IS/);

      // The old advice must not survive alongside the new: an operator reading
      // "publish this package manually" against a staged version walks into the
      // same E409 the block above exists to warn them off.
      assert.doesNotMatch(r.out, /publish this package manually/);

      // And the per-package identity line must still be there — the remedy is
      // useless if you cannot see WHICH package to look up on the Staged
      // Packages page (or to `npm stage approve`).
      //
      // A literal substring, NOT a built `new RegExp`: escaping the fixture's
      // version with `.replace(/\./g, '\\.')` handles dots and silently leaves
      // backslashes unescaped (CodeQL js/incomplete-sanitization, high). There
      // is nothing to pattern-match here anyway — the line is fully determined.
      const sdk = DEFAULT_PACKAGES['civitai-app-sdk'];
      const identityLine = `${sdk.name}@${sdk.version} -> HTTP 404 after 1 attempt(s)`;
      assert.ok(r.out.includes(identityLine), `missing ${JSON.stringify(identityLine)} in:\n${r.out}`);
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
      const raw = decodeURIComponent(req.url || '');
      // `url` is query-stripped so the lookups below still match; `raw` keeps
      // the cache-busting param. Same contract as the two shared registries.
      seen.push({ url: raw.replace(/\?.*$/, ''), raw, accept: req.headers.accept || '' });
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

  // ---- cache-busting (clawgate #594, criterion 2) -------------------------
  //
  // Retrying over a CDN-cached response re-reads ONE stale document N times and
  // learns nothing — so without this, raising the retry budget fixes nothing.
  // Measured on the live registry 2026-09-19: a plain read returned
  // `cf-cache-status: HIT`, the same read with `cache-control: no-cache` plus a
  // unique `?_cb=` returned `MISS`, and the response carried
  // `cache-control: public, max-age=300` — a 300s TTL, larger on its own than
  // the worst read-after-write lag ever measured on this repo (157s).

  test('CACHE-BUSTS every read — a unique query param AND a no-cache header', async () => {
    const seen = [];
    const srv = createServer((req, res) => {
      const raw = decodeURIComponent(req.url || '');
      seen.push({ raw, cacheControl: req.headers['cache-control'] || '', pragma: req.headers.pragma || '' });
      const path = raw.replace(/\?.*$/, '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: '@civitai/app-sdk', version: path.split('/').pop() }));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: `http://127.0.0.1:${srv.address().port}`, ...FAST });
      assert.equal(r.code, 0, r.out);

      // POSITIVE CONTROL on the harness first: if no request were issued at all,
      // every assertion below would pass vacuously over an empty array.
      assert.equal(seen.length, 5, `expected 5 requests, got ${seen.length}`);

      for (const s of seen) {
        assert.match(s.raw, /[?&]_cb=/, `read was not cache-busted: ${s.raw}`);
        assert.match(s.cacheControl, /no-cache/, `missing no-cache header on ${s.raw}`);
        assert.match(s.pragma, /no-cache/, `missing pragma header on ${s.raw}`);
      }

      // 🔴 The param must be UNIQUE PER REQUEST, not merely present. A constant
      // `?_cb=1` is cache-busted exactly once and then cached forever — which
      // looks identical to this fix from the code, and reproduces the original
      // bug from the second request onward.
      const params = seen.map((s) => new URL(`http://x${s.raw}`).searchParams.get('_cb'));
      assert.equal(new Set(params).size, params.length, `_cb repeated across requests: ${JSON.stringify(params)}`);
    } finally {
      destroyFixture(dir);
      srv.closeAllConnections();
      await new Promise((r) => srv.close(r));
    }
  });

  test('CACHE-BUSTS ACROSS RETRIES — the mutant that busts once then repeats must die', async () => {
    // The retry loop is the case that matters: two attempts sharing a cache key
    // are ONE sample, which is precisely the bug. DELAY=0 puts both attempts
    // inside the same millisecond, so a `_cb` built from `Date.now()` alone
    // would collide here — that is why the implementation mixes in a counter,
    // and this test is what holds it to that.
    const params = [];
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

      for (const raw of late.rawHits) {
        if (!raw.startsWith(TARGET)) continue;
        params.push(new URL(`http://x${raw}`).searchParams.get('_cb'));
      }
      // POSITIVE CONTROL: the retries actually happened. Without this a broken
      // fixture yielding 0 retries would make the uniqueness check vacuous.
      assert.equal(params.length, 3, `expected 3 retried reads, got ${JSON.stringify(late.rawHits)}`);
      assert.equal(new Set(params).size, 3, `retries shared a cache key: ${JSON.stringify(params)}`);
    } finally {
      destroyFixture(dir);
      await late.close();
    }
  });

  test('a STALE CDN cannot hide a published version — the behavioural case, not just the header', async () => {
    // Models the real failure end-to-end: the CDN holds a 404 it cached BEFORE
    // the publish landed. The bare URL therefore serves that stale 404 forever;
    // only a cache key the edge has never seen reaches the origin, which has the
    // version. A guard that retried WITHOUT cache-busting re-reads the same
    // cached 404 every attempt and reports PUBLISH DID NOT HAPPEN for a package
    // that is live — exactly what run 34908486900 did on 2026-09-14.
    //
    // 🔴 THE PRE-WARMED ENTRY IS WHAT MAKES THIS DISCRIMINATING, and getting it
    // wrong is a live trap: an earlier draft served the truth to the first
    // unseen key and staleness only on REPEATS, which is backwards. The guard's
    // very first request is unseen, so it resolved on attempt 1 and the test
    // passed WITH AND WITHOUT the fix — a mutation sweep caught it surviving.
    // The stale entry has to be there BEFORE the first read, because that is
    // what "the CDN cached a 404 while the publish was still propagating" means.
    const srv = createServer((req, res) => {
      const raw = decodeURIComponent(req.url || '');
      const path = raw.replace(/\?.*$/, '');
      const busted = /[?&]_cb=/.test(raw);
      if (path === '/@civitai/app-sdk/0.31.0') {
        if (!busted) {
          // The pre-warmed edge entry: a 404 cached before the publish landed.
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'stale edge copy' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ name: '@civitai/app-sdk', version: '0.31.0' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'x', version: path.split('/').pop() }));
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, { NPM_REGISTRY: `http://127.0.0.1:${srv.address().port}`, ...FAST });
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /5\/5 publishable package version\(s\) confirmed/);
      assert.doesNotMatch(r.out, /PUBLISH DID NOT HAPPEN/);
    } finally {
      destroyFixture(dir);
      srv.closeAllConnections();
      await new Promise((r) => srv.close(r));
    }
  });

  // ---- the budget is a SEAM: release.yml sets it, this script spends it ----

  test('release.yml budgets a version-probe window that beats the measured registry lag', async () => {
    // 🔴 A SEAM GUARD, not a component one. The script's ENV DEFAULTS (5/3000 =
    // a 12s window) are NOT what CI runs; `release.yml` overrides them. So every
    // test in this file that passes `PUBLISH_CHECK_TRIES` explicitly is blind to
    // the only budget that ships — and this gate was red on EIGHT consecutive
    // successful publishes with a perfectly green suite.
    //
    // The number asserted is the VERSION-PROBE WINDOW, (TRIES-1) x DELAY: how
    // long a lagging version has to appear. NOT 2x(TRIES-1)xDELAY, which is
    // total sleeping across both probes and is the figure `timeout-minutes` has
    // to cover. Conflating the two reads as twice the patience on offer.
    //
    // FLOOR: 240s. Measured read-after-write lag on this repo, publish-step
    // success -> version visible on the registry: 76s, 126s, 127s, 157s; plus
    // the CDN's own `max-age=300`. 240s is ~1.5x the worst observed lag and is
    // what shipped in #314. The cost of the headroom is paid ONLY by a package
    // that never appears — a lagging one resolves the moment it lands.
    const yml = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    const tries = Number(/PUBLISH_CHECK_TRIES:\s*'(\d+)'/.exec(yml)?.[1]);
    const delay = Number(/PUBLISH_CHECK_DELAY:\s*'(\d+)'/.exec(yml)?.[1]);
    // POSITIVE CONTROL on the parse: "no match" and "matched 0" are the same
    // falsy value, and a regex that silently stopped matching would make the
    // window read as NaN — which fails no comparison at all.
    assert.ok(Number.isFinite(tries) && tries > 1, `could not parse PUBLISH_CHECK_TRIES from release.yml`);
    assert.ok(Number.isFinite(delay) && delay > 0, `could not parse PUBLISH_CHECK_DELAY from release.yml`);

    const windowSec = ((tries - 1) * delay) / 1000;
    assert.ok(
      windowSec >= 240,
      `release.yml's version-probe window is ${windowSec}s ((${tries}-1) x ${delay}ms). ` +
        `Worst measured read-after-write lag on this repo is 157s and the registry CDN's own ` +
        `max-age is 300s, so anything under 240s re-introduces the false "PUBLISH DID NOT HAPPEN" ` +
        `this budget was raised to stop. If you are lowering it deliberately, move this floor and ` +
        `say what measurement justifies the new one.`,
    );
  });

  // ---- clawgate #594 criterion 5: the gate must STILL be able to fail ------

  test('NEGATIVE CONTROL: at the REAL release budget, a genuinely missing version still FAILS', async () => {
    // 🔴 The failure mode being guarded here is the OPPOSITE of the reported
    // one. Raising the budget and cache-busting every read are both changes that
    // make the gate more forgiving; over-correcting yields a gate that cannot
    // fail, which is strictly worse than the false alarm it replaced.
    //
    // So: the workflow's own TRIES (25) — not the suite's fast default — against
    // a registry that is genuinely one minor behind. DELAY=0 keeps it quick; the
    // ATTEMPT COUNT is what this exercises, and 25 attempts of patience must
    // still end in exit 1.
    const yml = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
    const tries = /PUBLISH_CHECK_TRIES:\s*'(\d+)'/.exec(yml)?.[1];
    assert.ok(tries, 'could not parse PUBLISH_CHECK_TRIES from release.yml');

    const behind = await startFakeRegistry({ ...allPublished(), '@civitai/app-sdk': '0.30.0' });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: behind.origin,
        PUBLISH_CHECK_TRIES: tries,
        PUBLISH_CHECK_DELAY: '0',
      });
      assert.equal(r.code, 1, `the gate did not fail on a genuinely missing version:\n${r.out}`);
      assert.match(r.out, /PUBLISH DID NOT HAPPEN/);
      assert.match(r.out, /@civitai\/app-sdk@0\.31\.0/);
      assert.doesNotMatch(r.out, /0 missing/);
      // It spent the whole budget before saying so — the retries are real, not a
      // number printed from a loop that exited early.
      assert.equal(
        behind.hits.filter((h) => h === '/@civitai/app-sdk/0.31.0').length,
        Number(tries),
        `expected ${tries} version probes, got ${behind.hits.filter((h) => h === '/@civitai/app-sdk/0.31.0').length}`,
      );
      // And it reports the patience it actually spent, so the next reader can
      // rule out impatience from the log instead of guessing.
      assert.match(r.out, /Each version was re-checked for up to/);
    } finally {
      destroyFixture(dir);
      await behind.close();
    }
  });

  // ---- clawgate #594 criterion 6: the healthy-but-slow release ------------

  test('POSITIVE CONTROL: the 2026-09-14 timeline replayed — slow propagation now PASSES', async () => {
    // A SIMULATION of run 34908486900, not a live release. That run failed red
    // with both packages healthy: the assertion gave up at 23:22:39 while
    // `@civitai/blocks-react@0.50.0` landed +45s and `@civitai/app-sdk@0.40.0`
    // landed +96s.
    //
    // Modelled in the registry's own units rather than wall-clock, so the test
    // stays fast and deterministic: at the shipped 10000ms delay, +45s is attempt
    // 6 and +96s is attempt 11. Three packages resolve immediately (the three
    // that were already OK in the real log), two lag. The pre-fix budget was 5
    // attempts — both laggards land beyond it, which is why the real run failed.
    const LATE = { '/@civitai/blocks-react/0.39.0': 6, '/@civitai/app-sdk/0.31.0': 11 };
    const slow = await startScriptedRegistry((url, nth) => {
      const appearsAt = LATE[url];
      if (appearsAt && nth < appearsAt) return { status: 404, body: { error: 'not yet' } };
      const version = url.split('/').pop();
      return { status: 200, body: { name: url.replace(/\/[^/]+$/, '').slice(1), version } };
    });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const yml = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
      const tries = /PUBLISH_CHECK_TRIES:\s*'(\d+)'/.exec(yml)?.[1];
      assert.ok(tries, 'could not parse PUBLISH_CHECK_TRIES from release.yml');

      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: slow.origin,
        PUBLISH_CHECK_TRIES: tries,
        PUBLISH_CHECK_DELAY: '0',
      });
      assert.equal(r.code, 0, `a healthy-but-slow release still failed:\n${r.out}`);
      assert.match(r.out, /5\/5 publishable package version\(s\) confirmed/);
      assert.doesNotMatch(r.out, /PUBLISH DID NOT HAPPEN/);
      // The laggards resolved via RETRY, not immediately — otherwise this test
      // would pass without ever exercising the propagation path it claims to.
      assert.match(r.out, /@civitai\/app-sdk@0\.31\.0 is on the registry\s+\(after 11 attempts/);
      assert.match(r.out, /@civitai\/blocks-react@0\.39\.0 is on the registry\s+\(after 6 attempts/);
    } finally {
      destroyFixture(dir);
      await slow.close();
    }
  });

  test('CONTROL for the replay: the SAME timeline at the PRE-FIX budget FAILS', async () => {
    // 🔴 Without this arm the test above is a claim about the command line. The
    // replay must be able to produce the ORIGINAL red — if it passes at 5
    // attempts too, then the fixture is not modelling the defect and the green
    // above proves nothing about the budget.
    const LATE = { '/@civitai/blocks-react/0.39.0': 6, '/@civitai/app-sdk/0.31.0': 11 };
    const slow = await startScriptedRegistry((url, nth) => {
      const appearsAt = LATE[url];
      if (appearsAt && nth < appearsAt) return { status: 404, body: { error: 'not yet' } };
      const version = url.split('/').pop();
      return { status: 200, body: { name: url.replace(/\/[^/]+$/, '').slice(1), version } };
    });
    const dir = createFixture({ scripts: [SCRIPT] });
    try {
      const r = await runGuard(dir, SCRIPT, {
        NPM_REGISTRY: slow.origin,
        PUBLISH_CHECK_TRIES: '5', // the budget that was live on 2026-09-14
        PUBLISH_CHECK_DELAY: '0',
      });
      assert.equal(r.code, 1, `the pre-fix budget did NOT reproduce the false failure:\n${r.out}`);
      assert.match(r.out, /PUBLISH DID NOT HAPPEN/);
      // Both laggards, exactly as the real run reported them.
      assert.match(r.out, /@civitai\/app-sdk@0\.31\.0 -> HTTP 404 after 5 attempt\(s\)/);
      assert.match(r.out, /@civitai\/blocks-react@0\.39\.0 -> HTTP 404 after 5 attempt\(s\)/);
    } finally {
      destroyFixture(dir);
      await slow.close();
    }
  });
});
