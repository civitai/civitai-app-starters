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
 * this script does not read the SDK source at all.
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
 *     it).
 *
 * USAGE
 *   node scripts/check-orchestrator-catalogs.mjs     # or: pnpm check:catalogs
 *   FIXTURE=... SPEC_URL=... node scripts/check-orchestrator-catalogs.mjs
 *
 * The two env overrides exist so `tests/` can drive this script against a known
 * -bad spec and a known-bad fixture — an unvalidated guard is a claim about the
 * guard, not about the catalogs. See `scripts/__tests__/`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SPEC_URL =
  process.env.SPEC_URL ?? 'https://orchestration.civitai.com/openapi/v2-consumers.json';
const FIXTURE =
  process.env.FIXTURE ??
  resolve(REPO_ROOT, 'packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json');

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

async function main() {
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  } catch (err) {
    fail(`could not read the transcribed fixture at ${FIXTURE}: ${err.message}`);
    return;
  }

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

  console.log('\nNo drift: the transcribed catalogs match the live orchestrator spec.');
}

await main();
