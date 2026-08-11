/**
 * Tests for scripts/check-starter-workspace-overrides.mjs — the release-deadlock
 * guard that runs in the REQUIRED `Starter` CI job before the install.
 *
 * The regression these tests exist for: the guard used to `continue` on ANY
 * `workspace:` starter pin, so re-doing exactly what `2a453e6` (#192) reverted —
 * putting `workspace:*` back in the starters and deleting the root override —
 * exited 0 while silently dropping coverage from 15 pins to 11. The guard's own
 * remediation text said "do NOT do this" and nothing enforced it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createFixture, destroyFixture, runGuard, DEFAULT_STARTERS, DEFAULT_OVERRIDES } from './fixture.mjs';

const GUARD = 'check-starter-workspace-overrides.mjs';
/** Self-describing message so a failure names the VERDICT, not just the output. */
const exitMsg = (want, r) => `expected exit ${want}, got ${r.code}\n--- guard output ---\n${r.out}`;
const clone = (v) => JSON.parse(JSON.stringify(v));

/** Build a fixture, run the guard in it, tear it down. */
async function guard(opts = {}) {
  const dir = createFixture({ ...opts, scripts: [GUARD] });
  try {
    return await runGuard(dir, GUARD);
  } finally {
    destroyFixture(dir);
  }
}

describe('check-starter-workspace-overrides', () => {
  test('INVARIANT: the real-shaped tree passes and reports its coverage count', async () => {
    const r = await guard();
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.match(r.stdout, /15 published-range/);
  });

  test('INVARIANT: a published-range pin with no workspace override fails, naming the package', async () => {
    const overrides = clone(DEFAULT_OVERRIDES);
    delete overrides['@civitai/theme'];
    const r = await guard({ overrides });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /has NO\n\s+workspace override/);
    assert.match(r.stderr, /@civitai\/theme/);
  });

  test('REGRESSION: re-doing the 2a453e6 revert (workspace:* in a starter + override deleted) FAILS', async () => {
    // The exact shape #192 reverted: the starter carries the workspace protocol
    // and the root override is gone. Every pin is then "not a published range",
    // so the pre-fix guard saw nothing to check and exited 0.
    const starters = clone(DEFAULT_STARTERS);
    for (const pkg of Object.keys(starters['next-app'])) starters['next-app'][pkg] = 'workspace:*';
    const overrides = clone(DEFAULT_OVERRIDES);
    delete overrides['@civitai/theme'];

    const r = await guard({ starters, overrides });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /WORKSPACE-PROTOCOL PIN IN A TIGED-CONSUMED STARTER/);
    assert.match(r.stderr, /starters\/next-app\/package\.json/);
    assert.match(r.stderr, /2a453e6/);
  });

  test('REGRESSION: a SINGLE top-level starter pin flipped to workspace: FAILS, naming file + package', async () => {
    const starters = clone(DEFAULT_STARTERS);
    starters['react-pwa']['@civitai/theme'] = 'workspace:^';
    const r = await guard({ starters });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /WORKSPACE-PROTOCOL PIN IN A TIGED-CONSUMED STARTER/);
    assert.match(r.stderr, /starters\/react-pwa\/package\.json/);
    assert.match(r.stderr, /@civitai\/theme.*workspace:\^/s);
  });

  test('REGRESSION: the workspace: ban fails the run ON ITS OWN, with coverage still at the floor', async () => {
    // Isolation matters here. In the cases above the flipped pin ALSO drops
    // coverage below the floor (or orphans an override), so those tests would
    // still go red with the ban's own `failed = true` deleted — they would be
    // killed by a different rule. This fixture adds a pin before flipping one,
    // so covered stays at exactly MIN_COVERED_PINS and the ban is the only rule
    // that can fail the run.
    const starters = clone(DEFAULT_STARTERS);
    starters['react-pwa']['@civitai/components'] = '^0.3.0'; // 15 -> 16 covered
    starters['react-pwa']['@civitai/theme'] = 'workspace:^'; // 16 -> 15 covered, at the floor
    const r = await guard({ starters });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /WORKSPACE-PROTOCOL PIN IN A TIGED-CONSUMED STARTER/);
    assert.doesNotMatch(r.stderr, /COVERAGE FLOOR/);
    assert.doesNotMatch(r.stderr, /has NO\n\s+workspace override/);
    assert.match(r.stdout, /OK   @civitai\/app-sdk/); // the scan really ran
  });

  test('SCOPE: starters/examples/* may use the workspace: protocol (they are not tiged targets)', async () => {
    // Positive control for the rule's scoping: the examples in the default
    // fixture are workspace:^ pins and must NOT trip the ban.
    const r = await guard();
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.doesNotMatch(r.out, /WORKSPACE-PROTOCOL PIN/);
  });

  test('SCOPE: an example declaring ONLY workspace: pins is exempt and does not fail the run', async () => {
    const examples = { 'hello-world': { '@civitai/app-sdk': 'workspace:^' } };
    const r = await guard({ examples });
    assert.equal(r.code, 0, exitMsg(0, r));
  });

  test('REGRESSION: dropping one covered pin outright trips the coverage floor', async () => {
    // No workspace: protocol involved — the pin is simply deleted. Only an
    // asserted count can see this.
    const starters = clone(DEFAULT_STARTERS);
    delete starters['next-app']['@civitai/theme'];
    const r = await guard({ starters });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /COVERAGE FLOOR/);
    assert.match(r.stderr, /14 covered .*< .*15/s);
  });

  test('the coverage floor does not block GROWTH (a new covered pin passes)', async () => {
    const starters = clone(DEFAULT_STARTERS);
    starters['react-pwa']['@civitai/components'] = '^0.3.0';
    const r = await guard({ starters });
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.match(r.stdout, /16 published-range/);
  });

  test('the workspace: ban covers devDependencies, not just dependencies', async () => {
    const starters = clone(DEFAULT_STARTERS);
    starters['svelte-pwa']['@civitai/theme'] = 'workspace:*';
    const r = await guard({ starters, depField: 'devDependencies' });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /WORKSPACE-PROTOCOL PIN IN A TIGED-CONSUMED STARTER/);
  });

  test('INVARIANT: an empty starters/ tree is an error, not a vacuous pass', async () => {
    const r = await guard({ starters: null, examples: null });
    assert.equal(r.code, 1, exitMsg(1, r));
  });
});
