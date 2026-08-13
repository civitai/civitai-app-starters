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
import { createFixture, destroyFixture, runGuard, startFakeRegistry, DEFAULT_PACKAGES } from './fixture.mjs';

const SCRIPT = 'assert-published-versions.mjs';
const FAST = { PUBLISH_CHECK_TRIES: '1', PUBLISH_CHECK_DELAY: '0' };

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
