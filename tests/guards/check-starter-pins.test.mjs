/**
 * Tests for scripts/check-starter-pins.mjs — the pins-vs-published currency
 * guard (CI job `Starter pins vs published`).
 *
 * The regression these tests exist for: the guard classified ANY pin above the
 * published version as "AHEAD … pending release, not stale" and passed. That
 * acceptance was unbounded — `^99.0.0` passed forever — so a pin that can never
 * resolve read as green. A genuine pending-release pin always admits the LOCAL
 * workspace package version, because `changeset version` writes the starter pin
 * and the package version in the same commit; anything above that is drift.
 *
 * Every case runs against a stand-in registry (`NPM_REGISTRY`), so the suite is
 * offline and deterministic.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFixture,
  destroyFixture,
  runGuard,
  startFakeRegistry,
  DEFAULT_STARTERS,
  DEFAULT_PACKAGES,
} from './fixture.mjs';

const GUARD = 'check-starter-pins.mjs';
/** Self-describing message so a failure names the VERDICT, not just the output. */
const exitMsg = (want, r) => `expected exit ${want}, got ${r.code}\n--- guard output ---\n${r.out}`;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** What npm reports as `latest` for each first-party package, by default. */
const PUBLISHED = {
  '@civitai/app-sdk': '0.31.0',
  '@civitai/blocks-react': '0.39.0',
  '@civitai/components': '0.3.0',
  '@civitai/components-react': '0.3.0',
  '@civitai/theme': '0.2.0',
};

describe('check-starter-pins', () => {
  /**
   * @param {object} opts
   * @param {object} [opts.starters]
   * @param {object} [opts.packages]
   * @param {object} [opts.published] overrides merged onto PUBLISHED
   */
  async function run({ starters, packages, published } = {}) {
    const registry = await startFakeRegistry({ ...PUBLISHED, ...(published ?? {}) });
    const dir = createFixture({
      scripts: [GUARD],
      starters: starters ?? DEFAULT_STARTERS,
      packages: packages ?? DEFAULT_PACKAGES,
    });
    try {
      return await runGuard(dir, GUARD, { NPM_REGISTRY: registry.origin });
    } finally {
      destroyFixture(dir);
      await registry.close();
    }
  }

  test('INVARIANT: pins that admit the published version pass', async () => {
    const r = await run();
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.match(r.stdout, /OK   @civitai\/theme \^0\.2\.0 admits published 0\.2\.0/);
  });

  test('INVARIANT: a pin BEHIND published is stale and fails', async () => {
    const starters = clone(DEFAULT_STARTERS);
    starters['next-app']['@civitai/theme'] = '^0.1.0';
    const r = await run({ starters });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /stale @civitai\/\* scaffold pin/);
    assert.match(r.stderr, /fix: bump to "\^0\.2\.0"/);
  });

  test('REGRESSION: an absurd forward pin (^99.0.0) is NOT "pending release" — it fails', async () => {
    const starters = clone(DEFAULT_STARTERS);
    starters['next-app']['@civitai/theme'] = '^99.0.0';
    const r = await run({ starters });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /UNPUBLISHABLE PIN/);
    assert.match(r.stderr, /\^99\.0\.0/);
    assert.match(r.stderr, /local workspace version 0\.2\.0/);
  });

  test('REGRESSION: a pin one minor above BOTH npm and the local package fails', async () => {
    // The quiet shape: someone hand-bumps a caret that `changeset version`
    // never wrote. It is ahead of npm, so the old classifier called it pending.
    const starters = clone(DEFAULT_STARTERS);
    starters['next-app']['@civitai/theme'] = '^0.3.0';
    const r = await run({ starters });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /UNPUBLISHABLE PIN/);
    assert.match(r.stderr, /local workspace version 0\.2\.0/);
  });

  test('REGRESSION: a forward pin on a package with NO local workspace package fails', async () => {
    const starters = clone(DEFAULT_STARTERS);
    starters['next-app']['@civitai/ghost'] = '^9.9.9';
    const r = await run({ starters, published: { '@civitai/ghost': '0.1.0' } });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /UNPUBLISHABLE PIN/);
    assert.match(r.stderr, /@civitai\/ghost/);
    assert.match(r.stderr, /no such package in this workspace/);
  });

  test('a genuine pending release (pin == local version, ahead of npm) still PASSES', async () => {
    // False-positive control for the bound: this is the state `changeset
    // version` produces on the Version Packages PR and it must stay green.
    const starters = clone(DEFAULT_STARTERS);
    starters['next-app']['@civitai/theme'] = '^0.2.1';
    starters['react-pwa']['@civitai/theme'] = '^0.2.1';
    starters['svelte-pwa']['@civitai/theme'] = '^0.2.1';
    starters['sveltekit-app']['@civitai/theme'] = '^0.2.1';
    const packages = clone(DEFAULT_PACKAGES);
    packages['civitai-theme'].version = '0.2.1';
    const r = await run({ starters, packages });
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.match(r.stdout, /AHEAD @civitai\/theme \^0\.2\.1 is ahead of published 0\.2\.0/);
    assert.match(r.stdout, /local workspace version 0\.2\.1/);
    assert.match(r.stdout, /4 ahead pending release/);
  });

  test('INVARIANT: a 404 from the registry is a hard fail, never a skip', async () => {
    const r = await run({ published: { '@civitai/theme': 'notfound' } });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /pins a nonexistent @civitai\/\* package/);
  });

  test('INVARIANT: a 5xx registry is a graceful skip, not a red', async () => {
    const all = Object.fromEntries(Object.keys(PUBLISHED).map((k) => [k, 'error']));
    const r = await run({ published: all });
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.match(r.out, /npm was unreachable for all pins/);
  });

  test('INVARIANT: workspace: pins in starters/examples are skipped by this guard', async () => {
    // check-starter-pins only reasons about PUBLISHED ranges; the workspace:
    // protocol is the other guard's business.
    const r = await run();
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.doesNotMatch(r.out, /workspace:/);
  });
});
