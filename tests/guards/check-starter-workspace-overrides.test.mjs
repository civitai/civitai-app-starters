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
import {
  createFixture,
  destroyFixture,
  runGuard,
  DEFAULT_STARTERS,
  DEFAULT_EXAMPLES,
  DEFAULT_OVERRIDES,
  DEFAULT_THIRD_PARTY_OVERRIDES,
  defaultStarterMirrors,
} from './fixture.mjs';

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
    assert.match(r.stdout, /26 published-range/);
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
    starters['react-pwa']['@civitai/components'] = '^0.3.0'; // 26 -> 27 covered
    starters['react-pwa']['@civitai/theme'] = 'workspace:^'; // 27 -> 26 covered, at the floor
    const r = await guard({ starters });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /WORKSPACE-PROTOCOL PIN IN A TIGED-CONSUMED STARTER/);
    assert.doesNotMatch(r.stderr, /COVERAGE FLOOR/);
    assert.doesNotMatch(r.stderr, /has NO\n\s+workspace override/);
    assert.match(r.stdout, /OK   @civitai\/app-sdk/); // the scan really ran
  });

  test('REGRESSION: an EXAMPLE flipped to workspace: FAILS — examples are copied out too', async () => {
    // The examples used to be exempt as "in-repo illustrations" while the docs
    // told people to copy one out, where `workspace:^` cannot install. Isolated
    // like the starter case above: one pin added, one flipped, so coverage stays
    // at the floor and the ban is the only rule that can fail the run.
    const examples = clone(DEFAULT_EXAMPLES);
    examples['kv-storage']['@civitai/theme'] = '^0.2.0'; // 26 -> 27 covered
    examples['kv-storage']['@civitai/app-sdk'] = 'workspace:^'; // 27 -> 26, at the floor
    const r = await guard({ examples });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /WORKSPACE-PROTOCOL PIN IN A TIGED-CONSUMED STARTER/);
    assert.match(r.stderr, /starters\/examples\/kv-storage\/package\.json/);
    assert.doesNotMatch(r.stderr, /COVERAGE FLOOR/);
  });

  test('INVARIANT: the examples\' published pins count toward coverage', async () => {
    // Positive control that the examples are SCANNED, not merely tolerated: the
    // real-shaped tree reports one covered line per example pin.
    const r = await guard();
    assert.equal(r.code, 0, exitMsg(0, r));
    const exampleLines = r.stdout.split('\n').filter((l) => /^OK {3}@civitai\/.*starters\/examples\//.test(l));
    assert.equal(exampleLines.length, 12, r.stdout);
  });

  test('REGRESSION: dropping one covered pin outright trips the coverage floor', async () => {
    // No workspace: protocol involved — the pin is simply deleted. Only an
    // asserted count can see this.
    const starters = clone(DEFAULT_STARTERS);
    delete starters['next-app']['@civitai/theme'];
    const r = await guard({ starters });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /COVERAGE FLOOR/);
    assert.match(r.stderr, /25 covered .*< .*26/s);
  });

  test('the coverage floor does not block GROWTH (a new covered pin passes)', async () => {
    const starters = clone(DEFAULT_STARTERS);
    starters['react-pwa']['@civitai/components'] = '^0.3.0';
    const r = await guard({ starters });
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.match(r.stdout, /27 published-range/);
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

/**
 * RULE 4 — a third-party root override must TRAVEL with a `npx tiged` copy
 * (#390).
 *
 * The defect: `pnpm.overrides` in the ROOT manifest pinned `cookie@<0.7.0` ->
 * `^0.7.0` for the workspace, and the root manifest is not part of a
 * `npx tiged civitai/civitai-app-starters/starters/<name>` copy. So the
 * monorepo installed a safe `cookie` and CI was green while every scaffolded
 * app resolved `cookie@0.6.0`. MEASURED at 8b1c098, on a copy of
 * `starters/sveltekit-app` installed outside the workspace: `cookie@0.6.0` and
 * `npm audit` -> 3 low, all rooted in that one package. With the mirror:
 * `cookie@0.7.2`, 0 advisories, under npm AND pnpm.
 */
describe('check-starter-workspace-overrides — rule 4 (third-party overrides travel)', () => {
  test('INVARIANT: the real-shaped tree mirrors every third-party override and reports the pair count', async () => {
    const r = await guard();
    assert.equal(r.code, 0, exitMsg(0, r));
    // (5 tiged starters + 6 examples) x 2 third-party constraints.
    assert.match(r.stdout, /22 pair\(s\) verified/);
    assert.match(r.stdout, /2 third-party root override\(s\) mirrored/);
  });

  test('REGRESSION: the pre-#390 shape — no starter mirrors anything — FAILS, naming the package', async () => {
    // `starterMirrors: null` IS the tree at 8b1c098.
    const r = await guard({ starterMirrors: null });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /DOES NOT TRAVEL WITH `npx tiged`/);
    assert.match(r.stderr, /cookie/);
    assert.match(r.stderr, /starters\/sveltekit-app\/package\.json/);
  });

  test('REGRESSION: mirroring for pnpm but NOT npm FAILS, naming npm', async () => {
    // 🔴 THE DISCRIMINATING CASE for declaring both keys. The starters' READMEs
    // say `pnpm install`, so a pnpm-only mirror looks complete — and leaves
    // every developer who reaches for `npm install` with the unconstrained
    // resolution. Nothing but this arm can tell the two apart.
    const starterMirrors = defaultStarterMirrors();
    delete starterMirrors['sveltekit-app'].overrides;
    const r = await guard({ starterMirrors });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /DOES NOT TRAVEL/);
    assert.match(r.stderr, /\["overrides"\] — npm/);
    assert.doesNotMatch(r.stderr, /\["pnpm\.overrides"\] — pnpm/);
  });

  test('REGRESSION: mirroring for npm but NOT pnpm FAILS, naming pnpm', async () => {
    const starterMirrors = defaultStarterMirrors();
    delete starterMirrors['react-pwa'].pnpm;
    const r = await guard({ starterMirrors });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /\["pnpm\.overrides"\] — pnpm/);
    assert.doesNotMatch(r.stderr, /\["overrides"\] — npm/);
  });

  test('REGRESSION: a mirror whose VALUE drifted from the root FAILS, showing both', async () => {
    const starterMirrors = defaultStarterMirrors();
    starterMirrors['next-app'].overrides['cookie@<0.7.0'] = '^0.6.0';
    starterMirrors['next-app'].pnpm.overrides['cookie@<0.7.0'] = '^0.6.0';
    const r = await guard({ starterMirrors });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /has "cookie@<0\.7\.0": "\^0\.6\.0"; the root declares "cookie@<0\.7\.0": "\^0\.7\.0"/);
  });

  test('REGRESSION: a mirror that drops the `@<range>` SELECTOR from the key FAILS', async () => {
    // The bare key is a DIFFERENT constraint: unconditional rather than
    // conditional, and npm refuses an unconditional override of a package the
    // manifest also depends on directly — measured:
    //   npm error code EOVERRIDE
    //   npm error Override for postcss@^8.5.15 conflicts with direct dependency
    // `next-app` devDepends on postcss, so the bare spelling of the root's
    // postcss constraint breaks `npm install` in a scaffolded next-app. Exact
    // key equality is what keeps one spelling for both managers.
    const starterMirrors = defaultStarterMirrors();
    for (const block of [starterMirrors['svelte-pwa'].overrides, starterMirrors['svelte-pwa'].pnpm.overrides]) {
      delete block['postcss@<8.5.10'];
      block.postcss = '>=8.5.10';
    }
    const r = await guard({ starterMirrors });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /has "postcss": ">=8\.5\.10"; the root declares "postcss@<8\.5\.10": ">=8\.5\.10"/);
  });

  test('REGRESSION: rule 4 fails the run ON ITS OWN, with every other rule satisfied', async () => {
    // 🔴 ISOLATION. In the cases above the missing mirror ALSO drops the pair
    // count below the floor, so they would still go red with rule 4's own
    // `failed = true` deleted — killed by the floor, not by the rule. This
    // fixture adds a THIRD root constraint and mirrors it everywhere (33 pairs)
    // before breaking one, so the count stays at 32 — above the floor of 22 —
    // and rule 4 is the only thing that can fail the run.
    const overrides = { ...DEFAULT_OVERRIDES, 'braces@<3.0.3': '>=3.0.3' };
    const starterMirrors = defaultStarterMirrors(DEFAULT_STARTERS, overrides);
    delete starterMirrors['next-app'].overrides['braces@<3.0.3'];
    delete starterMirrors['next-app'].pnpm.overrides['braces@<3.0.3'];

    const r = await guard({ overrides, starterMirrors });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /DOES NOT TRAVEL/);
    assert.match(r.stderr, /braces/);
    assert.doesNotMatch(r.stderr, /COVERAGE FLOOR/);
    assert.doesNotMatch(r.stderr, /has NO\n\s+workspace override/);
    assert.doesNotMatch(r.stderr, /WORKSPACE-PROTOCOL PIN/);
    assert.match(r.stdout, /OK   root override "cookie@<0\.7\.0" is mirrored/); // the scan really ran
  });

  test('REGRESSION: deleting the root third-party overrides trips rule 4\'s OWN coverage floor', async () => {
    // Nothing to mirror means nothing to check, and rule 4 then reports a clean
    // run over an empty set — output indistinguishable from a fully mirrored
    // tree. Only an asserted count sees this.
    const overrides = { ...DEFAULT_OVERRIDES };
    for (const k of Object.keys(DEFAULT_THIRD_PARTY_OVERRIDES)) delete overrides[k];
    const r = await guard({ overrides, starterMirrors: null });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /third-party override mirroring dropped/);
    assert.match(r.stderr, /0 verified .*pair\(s\) < floor 22/s);
    // And it must be the FLOOR that fires, not the travel rule: with no
    // third-party override in the root there is genuinely nothing unmirrored.
    assert.doesNotMatch(r.stderr, /DOES NOT TRAVEL/);
  });

  test('the rule-4 floor does not block GROWTH (a third constraint, mirrored, passes)', async () => {
    const overrides = { ...DEFAULT_OVERRIDES, 'braces@<3.0.3': '>=3.0.3' };
    const r = await guard({ overrides, starterMirrors: defaultStarterMirrors(DEFAULT_STARTERS, overrides) });
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.match(r.stdout, /33 pair\(s\) verified/);
  });

  test('REGRESSION: an EXAMPLE that does not mirror a third-party override FAILS', async () => {
    // Examples used to be out of rule 4's scope. A copied-out example resolves
    // its dependencies with no monorepo root above it, so the constraint has to
    // travel in its own manifest exactly as a starter's does.
    const exampleMirrors = defaultStarterMirrors(DEFAULT_EXAMPLES, DEFAULT_OVERRIDES);
    delete exampleMirrors['buzz-workflow'].overrides;
    const r = await guard({ exampleMirrors });
    assert.equal(r.code, 1, exitMsg(1, r));
    assert.match(r.stderr, /DOES NOT TRAVEL/);
    assert.match(r.stderr, /starters\/examples\/buzz-workflow\/package\.json \["overrides"\] — npm/);
  });

  test('SCOPE: rule 4 ignores the first-party @civitai/* overrides', async () => {
    // Those are governed by rules 1-3 and must NOT be mirrored into a starter —
    // a `workspace:` entry in a tiged copy is exactly what #192 reverted. If
    // rule 4's third-party filter broke, it would demand them here and the two
    // halves of this guard would contradict each other.
    const r = await guard();
    assert.equal(r.code, 0, exitMsg(0, r));
    assert.match(r.stdout, /2 third-party root override\(s\)/);
    assert.doesNotMatch(r.stdout, /root override "@civitai/);
  });
});
