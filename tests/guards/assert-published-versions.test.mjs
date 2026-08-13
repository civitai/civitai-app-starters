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
