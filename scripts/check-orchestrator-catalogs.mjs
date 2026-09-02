#!/usr/bin/env node
/**
 * check-orchestrator-catalogs.mjs
 * ------------------------------
 * LIVE-spec drift guard for the SDK's hand-maintained orchestrator catalogs
 * (`WORKFLOW_STEP_TYPES` and `IMAGE_GEN_ENGINES` in
 * `packages/civitai-app-sdk/src/orchestrator/index.ts`).
 *
 * WHAT IT COMPARES. The transcribed lists in
 * `packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json`
 * against the LIVE `https://orchestration.civitai.com/openapi/v2-consumers.json`.
 * `test/orchestrator.test.ts` pins the SDK catalogs to that same fixture
 * offline, so the two checks together pin the catalogs to the live spec. Neither
 * alone does: the unit test cannot see the orchestrator shipping a new step, and
 * this script's set comparison does not read the SDK source at all.
 *
 * ⚠️ IT DOES READ THE SDK SOURCE FOR ONE THING, added 2026-09-01 — the
 * PLACEHOLDER SWEEP at the end. `sync-orchestrator-catalogs.mjs` (the scheduled
 * write twin) adds a newly-shipped step type with `PLACEHOLDER_DESCRIPTION`
 * whenever the spec gives it nothing to describe the step with, and this sweep
 * is what SURFACES that placeholder — read the honesty note on
 * `sweepPlaceholders` before describing it as anything stronger. It is offline,
 * so it still reports when the spec is unreachable — it runs BEFORE the fetch
 * for exactly that reason.
 *
 * 🔴 ENUMERATE THE DEFINING SURFACE, DO NOT SAMPLE A DERIVED ONE. The
 * authoritative population is the `discriminator.mapping` of
 * `components.schemas.WorkflowStepTemplate` (the SUBMIT-side union) — NOT the
 * spec's `*Step`/`*Input` schema names and NOT the exports of the generated
 * `@civitai/client`, both of which contain shapes that are not submittable step
 * types. Same for engines: `components.schemas.ImageGenInput.discriminator.mapping`.
 *
 * WHY IT EXISTS. The catalogs are hand-maintained mirrors of a spec that moves
 * per orchestrator build, and until 2026-08 the only guard was a
 * `expect(keys).toContain('textToImage')` spot-check over 7 names. Under it the
 * catalog carried a phantom `audioMix` — a `$type` that appears 0 times in the
 * spec, i.e. a guaranteed 400 for anyone who autocompleted it — and was missing
 * 10 real step types.
 *
 * FAILS (exit 1) when:
 *   - the spec is unreachable or returns a non-200 (this endpoint is expected
 *     live; a silent skip on an unreachable source is indistinguishable from a
 *     pass, which is the failure mode the guard exists to prevent), OR
 *   - the spec's shape is not what this script knows how to read (missing
 *     `components.schemas.<X>.discriminator.mapping`, or a mapping that is empty
 *     — an empty expectation would make every comparison below pass vacuously), OR
 *   - either fixture list differs from the live mapping in ANY direction. Both
 *     directions are reported separately: a name the spec no longer accepts
 *     (STALE — remove it) and one it accepts that we do not list (MISSING — add
 *     it), OR
 *   - a catalog entry in the SDK source still carries the write twin's
 *     placeholder description (see above).
 *
 * USAGE
 *   node scripts/check-orchestrator-catalogs.mjs     # or: pnpm check:catalogs
 *   FIXTURE=... SDK_SRC=... SPEC_URL=... node scripts/check-orchestrator-catalogs.mjs
 *   REPO_ROOT=... node scripts/check-orchestrator-catalogs.mjs   # both paths at once
 *
 * The env overrides exist so a self-test can drive this script against a
 * known-bad spec and a known-bad fixture — an unvalidated guard is a claim about
 * the guard, not about the catalogs.
 *
 * ⚠️ PARTIAL SELF-TEST, added 2026-09-01. `tests/guards/sync-orchestrator-catalogs.test.mjs`
 * drives this script through `REPO_ROOT` / `SDK_SRC` + `SPEC_URL` and covers the
 * PLACEHOLDER SWEEP: it reports on an uncurated catalog, stays silent on a
 * curated one, AND exits non-zero over a placeholder when the spec is REACHABLE
 * and the catalogs are otherwise in sync.
 *
 * 🔴 That third arm exists because the first two do not imply it, and an earlier
 * version of this note claimed coverage "in both directions" that it did not
 * have. Both original arms pointed at an unreachable spec, which fails for its
 * OWN reason — so `process.exitCode = 1` could be deleted from `fail()` and the
 * suite stayed 4/4 GREEN while this script returned rc 0 over two live
 * `TODO(catalog)` entries. Measured, then closed. Do not remove the reachable
 * arm; it is the only one whose green means the exit code works.
 *
 * It covers NOTHING ELSE here: the STALE/MISSING set comparison, the non-200
 * branch and the malformed-mapping branches are still unexercised,
 * so do not read that file as coverage of this one. The convention to follow
 * when closing the rest: the sibling release guards
 * (`scripts/check-starter-pins.mjs`, `scripts/check-starter-workspace-overrides.mjs`)
 * are self-tested by `tests/guards/*.test.mjs` — `node --test`, driven through
 * the synthetic-tree harness in `tests/guards/fixture.mjs`, run in CI and via
 * `pnpm test:guards`. That directory is where a test for this script belongs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PLACEHOLDER_SENTINEL } from './orchestrator-catalog-placeholder.mjs';

// `REPO_ROOT` is honoured here for the same reason the write twin honours it,
// and because the ASYMMETRY was the bug: with only the writer reading it,
// `REPO_ROOT=/tmp/x pnpm check:catalogs` silently checked the REAL repo and
// printed "No drift" — a reassuring statement about the wrong tree. The
// finer-grained `FIXTURE` / `SDK_SRC` overrides still win when set.
const REPO_ROOT =
  process.env.REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SPEC_URL =
  process.env.SPEC_URL ?? 'https://orchestration.civitai.com/openapi/v2-consumers.json';
const FIXTURE =
  process.env.FIXTURE ??
  resolve(REPO_ROOT, 'packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json');
const SDK_SRC =
  process.env.SDK_SRC ??
  resolve(REPO_ROOT, 'packages/civitai-app-sdk/src/orchestrator/index.ts');

/** The catalogs under guard: fixture key → the spec schema whose mapping defines it. */
const CATALOGS = [
  {
    fixtureKey: 'workflowStepTypes',
    schema: 'WorkflowStepTemplate',
    sdkName: 'WORKFLOW_STEP_TYPES',
  },
  { fixtureKey: 'imageGenEngines', schema: 'ImageGenInput', sdkName: 'IMAGE_GEN_ENGINES' },
];

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exitCode = 1;
}

/**
 * Pull one catalog's authoritative key set out of the spec.
 *
 * Every unexpected shape THROWS rather than returning `[]`. An empty array here
 * would sail through the set comparison below and report "no drift" for a spec
 * this script failed to read — the reassuring-zero failure mode.
 */
function mappingKeys(spec, schemaName) {
  const schema = spec?.components?.schemas?.[schemaName];
  if (!schema) throw new Error(`spec has no components.schemas.${schemaName}`);
  const mapping = schema?.discriminator?.mapping;
  if (!mapping || typeof mapping !== 'object') {
    throw new Error(`components.schemas.${schemaName} has no discriminator.mapping`);
  }
  const keys = Object.keys(mapping);
  if (keys.length === 0) {
    throw new Error(`components.schemas.${schemaName}.discriminator.mapping is EMPTY`);
  }
  return keys;
}

/**
 * Report while any catalog entry still carries the write twin's placeholder.
 *
 * 🔴 THIS STOPS NOTHING. IT IS AN ADVISORY SIGNAL, AND SAYING OTHERWISE IS A
 * CLAIM THE CODE CANNOT HONOUR. An earlier draft of this docblock called it "THE
 * ONLY MECHANISM STOPPING AN UNCURATED DESCRIPTION FROM SHIPPING", which was
 * false in the way that matters: `Orchestrator catalog drift-check` is NOT a
 * required context on `main` (measured 2026-09-02 — 9 required contexts, and it
 * is not among them; ci.yml says "do NOT add it to branch protection", because a
 * required check that depends on a LIVE external spec freezes the whole repo
 * every time upstream ships a step type). A `TODO(catalog)` line CAN reach
 * `main` and npm with every required check green, if someone merges past a red
 * advisory job.
 *
 * That is a deliberate trade, not an oversight. What actually keeps drift
 * short-lived is the scheduled bot re-opening the sync PR, plus this line being
 * loud in the log a reviewer reads. Nothing here enforces it.
 *
 * The sweep is still worth running, and the shape below is still deliberate: it
 * runs BEFORE the network fetch so it reports even when the spec is unreachable,
 * and it is a substring test rather than an equality test so an editor can
 * extend the placeholder sentence without defeating it. It also sets a non-zero
 * exit code, which is what makes it usable as a LOCAL gate (`pnpm
 * check:catalogs` in a pre-merge script), even though CI does not gate on it.
 *
 * It reads the SDK source as TEXT, deliberately: this script must run with no
 * `pnpm install` (that is why the CI job has no install step), so it cannot
 * import the module. The cost is that it sees a placeholder anywhere in the
 * file, not only inside a catalog literal — which errs toward reporting, and
 * the sentinel is not a string anyone writes for another reason.
 */
function sweepPlaceholders() {
  let src;
  try {
    src = readFileSync(SDK_SRC, 'utf8');
  } catch (err) {
    fail(`could not read the SDK catalog source at ${SDK_SRC}: ${err.message}`);
    return true;
  }
  const offenders = src
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.includes(PLACEHOLDER_SENTINEL));
  if (offenders.length === 0) return false;

  fail(
    `${offenders.length} catalog entr${offenders.length === 1 ? 'y' : 'ies'} in ${SDK_SRC}\n` +
      `       still carr${offenders.length === 1 ? 'ies' : 'y'} a PLACEHOLDER description:\n` +
      offenders.map(({ line, n }) => `         ${n}: ${line.trim()}`).join('\n') +
      `\n       These were auto-added from the orchestrator spec, which gave nothing to\n` +
      `       describe them with. WORKFLOW_STEP_TYPES is the catalog developers browse to\n` +
      `       pick a step, so each one needs a real one-line description written by hand —\n` +
      `       read the step's input/output schemas in the spec and say what it does.`,
  );
  return true;
}

async function main() {
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  } catch (err) {
    fail(`could not read the transcribed fixture at ${FIXTURE}: ${err.message}`);
    return;
  }

  const placeholders = sweepPlaceholders();

  console.log(`Fetching orchestrator spec from ${SPEC_URL} ...`);
  let spec;
  try {
    const res = await fetch(SPEC_URL);
    if (!res.ok) {
      fail(
        `orchestrator spec fetch failed (HTTP ${res.status}) from ${SPEC_URL}\n` +
          `       The spec is expected live; failing rather than skipping — a skipped\n` +
          `       drift check reads exactly like a passing one.`,
      );
      return;
    }
    spec = await res.json();
  } catch (err) {
    fail(
      `orchestrator spec fetch failed (${err.message}) from ${SPEC_URL}\n` +
        `       Failing rather than skipping — see above.`,
    );
    return;
  }

  let drifted = false;

  for (const { fixtureKey, schema, sdkName } of CATALOGS) {
    const declared = fixture?.[fixtureKey];
    if (!Array.isArray(declared) || declared.length === 0) {
      fail(`fixture key "${fixtureKey}" is missing or empty in ${FIXTURE}`);
      drifted = true;
      continue;
    }

    let live;
    try {
      live = mappingKeys(spec, schema);
    } catch (err) {
      fail(`${err.message} — cannot check ${sdkName}`);
      drifted = true;
      continue;
    }

    const liveSet = new Set(live);
    const declaredSet = new Set(declared);
    const stale = declared.filter((k) => !liveSet.has(k)).sort();
    const missing = live.filter((k) => !declaredSet.has(k)).sort();

    if (stale.length === 0 && missing.length === 0) {
      console.log(`  OK  ${sdkName}: ${live.length} entries match ${schema}.discriminator.mapping`);
      continue;
    }

    drifted = true;
    console.error(`\nDRIFT in ${sdkName} (spec schema: ${schema})`);
    if (stale.length) {
      console.error(
        `  STALE — listed here but NOT accepted by the orchestrator (a submit would 400):\n` +
          stale.map((k) => `    - ${k}`).join('\n'),
      );
    }
    if (missing.length) {
      console.error(
        `  MISSING — accepted by the orchestrator but not listed:\n` +
          missing.map((k) => `    + ${k}`).join('\n'),
      );
    }
  }

  if (drifted) {
    console.error(
      `\nFix: update BOTH\n` +
        `  ${FIXTURE}\n` +
        `  packages/civitai-app-sdk/src/orchestrator/index.ts\n` +
        `in the same PR (a new step type also needs a one-line description in the\n` +
        `catalog). \`pnpm --filter @civitai/app-sdk test\` pins the two to each other.`,
    );
    process.exitCode = 1;
    return;
  }

  // `placeholders` has already called fail(), so the exit code is right either
  // way — this only stops the summary line CONTRADICTING it. A trailing "No
  // drift" over a failing run is exactly the reassuring output that gets quoted
  // instead of the exit code.
  console.log(
    placeholders
      ? '\nThe transcribed catalogs match the live orchestrator spec, but a PLACEHOLDER description is still unwritten (above).'
      : '\nNo drift: the transcribed catalogs match the live orchestrator spec.',
  );
}

await main();
