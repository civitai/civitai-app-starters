/**
 * Self-test for `scripts/sync-orchestrator-catalogs.mjs`, the scheduled WRITE
 * twin of the orchestrator catalog drift-check.
 *
 * WHY THIS FILE EXISTS. That script runs on a schedule with `contents: write`
 * and opens PRs against this repo, and the thing it must never do is invent a
 * description for a step type nobody has documented. Nothing else can observe
 * that: the PR it opens is mechanically perfect — right keys, right counts,
 * green typecheck/test/build — so a regression in `deriveDescription` ships a
 * fabricated one-liner to developers with every signal green. This suite is the
 * control on that rule, and on the two other decisions the script makes alone
 * (refuse a removal; write nothing when it refuses).
 *
 * The script under test is byte-for-byte the file CI runs — it is driven by its
 * `REPO_ROOT` / `SPEC_URL` env overrides against a synthetic tree and a
 * synthetic spec, not by a test-only branch inside it.
 *
 * 🔴 EVERY ASSERTION BELOW IS PAIRED. A test that only checks the placeholder
 * branch cannot tell "the rule works" from "the script never writes a
 * description at all" — so the derived branch is asserted in the same shape,
 * off the same spec, differing only in the field under test. Same for the
 * refusal: "exit 2" and "wrote nothing" are separate claims and a refusal that
 * had already written three files would satisfy the first one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYNC = join(REPO_ROOT, 'scripts', 'sync-orchestrator-catalogs.mjs');
const CHECK = join(REPO_ROOT, 'scripts', 'check-orchestrator-catalogs.mjs');

/**
 * A minimal spec with the two shapes the script reads. `steps` maps a step key
 * to the `description` its `<Name>StepTemplate` carries — `null` for a schema
 * with no description at all.
 */
function makeSpec(steps, engines = { comfy: 'A ComfyUI graph run as an imageGen engine.' }) {
  const schemas = {
    WorkflowStepTemplate: { discriminator: { mapping: {} } },
    ImageGenInput: { discriminator: { mapping: {} } },
  };
  for (const [key, description] of Object.entries(steps)) {
    const name = `${key[0].toUpperCase()}${key.slice(1)}StepTemplate`;
    schemas.WorkflowStepTemplate.discriminator.mapping[key] = `#/components/schemas/${name}`;
    schemas[name] = description === null ? { type: 'object' } : { type: 'object', description };
  }
  for (const [key, description] of Object.entries(engines)) {
    const name = `${key[0].toUpperCase()}${key.slice(1)}ImageGenInput`;
    schemas.ImageGenInput.discriminator.mapping[key] = `#/components/schemas/${name}`;
    schemas[name] = description === null ? { type: 'object' } : { type: 'object', description };
  }
  return { components: { schemas } };
}

async function serveSpec(spec) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(spec));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/spec.json`,
    close: () => new Promise((r) => server.close(r)),
  };
}

/**
 * A synthetic tree carrying only the four paths the script writes, in the real
 * repo's shape. The SDK source and test file are REAL excerpts — same anchors
 * the script does text surgery against — so a change to those anchors upstream
 * fails here rather than in production.
 */
function makeTree({ stepTypes, engines }) {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-sync-'));
  mkdirSync(join(dir, 'packages/civitai-app-sdk/test/fixtures'), { recursive: true });
  mkdirSync(join(dir, 'packages/civitai-app-sdk/src/orchestrator'), { recursive: true });
  mkdirSync(join(dir, '.changeset'), { recursive: true });

  writeFileSync(
    join(dir, 'packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json'),
    `${JSON.stringify(
      { specUrl: 'http://example.invalid', readOn: '2000-01-01', workflowStepTypes: stepTypes, imageGenEngines: engines },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, 'packages/civitai-app-sdk/src/orchestrator/index.ts'),
    [
      'export const WORKFLOW_STEP_TYPES = {',
      ...stepTypes.map((k) => `  ${k}: 'existing description for ${k}',`),
      '} as const;',
      '',
      'export type WorkflowStepType = keyof typeof WORKFLOW_STEP_TYPES;',
      '',
      'export const IMAGE_GEN_ENGINES = {',
      ...engines.map((k) => `  ${k}: 'existing description for ${k}',`),
      '} as const;',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'packages/civitai-app-sdk/test/orchestrator.test.ts'),
    [
      '    expect(body.steps).toHaveLength(1);',
      `    expect(SPEC_WORKFLOW_STEP_TYPES).toHaveLength(${stepTypes.length});`,
      `    expect(SPEC_IMAGE_GEN_ENGINES).toHaveLength(${engines.length});`,
      '',
    ].join('\n'),
  );
  return dir;
}

const read = (dir, p) => readFileSync(join(dir, p), 'utf8');
const SDK = 'packages/civitai-app-sdk/src/orchestrator/index.ts';
const FIXTURE = 'packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json';
const TEST = 'packages/civitai-app-sdk/test/orchestrator.test.ts';

async function run(script, env) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    return { code: err.code ?? 1, out: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

const runSync = (dir, specUrl) => run(SYNC, { REPO_ROOT: dir, SPEC_URL: specUrl });
const runCheck = (env) => run(CHECK, env);

/**
 * Load the generated catalog module and report whether anything in it EXECUTED.
 *
 * The generated file is `.ts`, and the only TypeScript in it is erasable
 * (`as const`, an `export type` alias). Both are stripped here and the result is
 * imported as plain ESM, so this asserts the JavaScript-level question — does an
 * injected statement reach executable position — without depending on which
 * Node versions strip types.
 */
async function importGenerated(dir, tag) {
  // Line-scoped on purpose: a global `as const` strip also rewrites the payload
  // INSIDE a catalog value, which would quietly change the thing under test. The
  // real terminator is the only line that is exactly `} as const;`.
  const src = read(dir, SDK)
    .split('\n')
    .filter((l) => !l.startsWith('export type '))
    .map((l) => (l === '} as const;' ? '};' : l))
    .join('\n');
  const mjs = join(dir, `generated-${tag}.mjs`);
  writeFileSync(mjs, src);
  try {
    const mod = await import(`file://${mjs}`);
    return { loaded: true, mod };
  } catch (err) {
    return { loaded: false, error: err };
  }
}

test('a spec description that merely RESTATES the key becomes a placeholder, a real one is used', async (t) => {
  // The pair is the point. `webScrape` gets "WebScrape" — what the OpenAPI
  // generator emits when the source carries no doc comment, measured verbatim
  // in the live spec on 2026-09-01. `songGen` gets a real sentence. Both arrive
  // through the same code path in the same run, so a regression that collapses
  // the rule in EITHER direction fails: always-placeholder loses the second
  // assertion, always-derive loses the first.
  const spec = makeSpec({
    echo: 'Echo the input back.',
    webScrape: 'WebScrape',
    songGen: 'Generate a complete song from a caption and lyrics.',
  });
  const server = await serveSpec(spec);
  const dir = makeTree({ stepTypes: ['echo'], engines: ['comfy'] });
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const { code, out } = await runSync(dir, server.url);
  assert.equal(code, 0, `sync should succeed; got ${code}\n${out}`);

  // Double-quoted since 2026-09-02: values are emitted with `JSON.stringify`,
  // which is the only escaper here that also covers newlines and control
  // characters. Nothing in this repo enforces a quote style on
  // `packages/civitai-app-sdk/src/**` — no root prettier/eslint config, and the
  // SDK package has no `lint` script — so correctness wins over cosmetics.
  const sdk = read(dir, SDK);
  assert.match(
    sdk,
    /webScrape: "TODO\(catalog\): no description yet/,
    'a description that restates the key must NOT be shipped as the catalog entry',
  );
  assert.match(
    sdk,
    /songGen: "Generate a complete song from a caption and lyrics\."/,
    'a real spec description must be used verbatim — otherwise this rule is just "never write anything"',
  );

  // The other three files, so a green on the two above cannot mean "it wrote
  // the SDK file and nothing else".
  const fixture = JSON.parse(read(dir, FIXTURE));
  assert.deepEqual(fixture.workflowStepTypes, ['echo', 'songGen', 'webScrape']);
  assert.match(read(dir, TEST), /expect\(SPEC_WORKFLOW_STEP_TYPES\)\.toHaveLength\(3\)/);
  assert.match(
    read(dir, TEST),
    /expect\(body\.steps\)\.toHaveLength\(1\)/,
    'the count bump must not have rewritten an unrelated toHaveLength assertion',
  );
  const changesets = readdirSync(join(dir, '.changeset'));
  assert.equal(changesets.length, 1, `expected exactly 1 changeset, got ${changesets.join(', ')}`);
  assert.match(read(dir, join('.changeset', changesets[0])), /'@civitai\/app-sdk': minor/);
});

test('a WITHDRAWN key is refused with exit 2 and NOTHING is written', async (t) => {
  const server = await serveSpec(makeSpec({ echo: 'Echo the input back.' }));
  const dir = makeTree({ stepTypes: ['echo', 'goneFromTheSpec'], engines: ['comfy'] });
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const before = [SDK, FIXTURE, TEST].map((p) => read(dir, p));
  const { code, out } = await runSync(dir, server.url);

  assert.equal(code, 2, `a removal must exit 2 (its own code), got ${code}\n${out}`);
  assert.match(out, /goneFromTheSpec/, 'the refusal must name the withdrawn key');
  // Separate claim from the exit code: a script that wrote three files and THEN
  // refused would satisfy the assertion above.
  assert.deepEqual(
    [SDK, FIXTURE, TEST].map((p) => read(dir, p)),
    before,
    'a refused sync must leave every file byte-identical',
  );
  assert.deepEqual(readdirSync(join(dir, '.changeset')), [], 'a refused sync must write no changeset');
});

test('an unreachable spec FAILS rather than reporting a clean sync', async (t) => {
  const dir = makeTree({ stepTypes: ['echo'], engines: ['comfy'] });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Port 0 is not connectable; any refusal is the shape under test.
  const { code, out } = await runSync(dir, 'http://127.0.0.1:1/spec.json');
  assert.equal(code, 1, `an unreachable spec must fail, got ${code}\n${out}`);
  assert.doesNotMatch(out, /No drift/, 'a skipped sync must not read like a clean one');
});

test('check-orchestrator-catalogs.mjs REPORTS while a placeholder survives', async (t) => {
  // 🔴 This is an ADVISORY signal, not a gate, and an earlier version of this
  // comment called it "the ONLY mechanism stopping an uncurated description
  // reaching `main`". That was false: `Orchestrator catalog drift-check` is not
  // a required context (measured 2026-09-02 — 9 required contexts on `main`, and
  // it is not one of them), so a `TODO(catalog)` line CAN be merged past it. What
  // the sweep buys is that the placeholder is NAMED, loudly, in the log a
  // reviewer reads and in `pnpm check:catalogs` locally. Worth testing; not worth
  // overstating.
  const dir = mkdtempSync(join(tmpdir(), 'catalog-sweep-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const withPlaceholder = join(dir, 'with.ts');
  const withoutPlaceholder = join(dir, 'without.ts');
  writeFileSync(
    withPlaceholder,
    "export const WORKFLOW_STEP_TYPES = {\n  webScrape: 'TODO(catalog): no description yet — replace me',\n} as const;\n",
  );
  writeFileSync(
    withoutPlaceholder,
    "export const WORKFLOW_STEP_TYPES = {\n  webScrape: 'Fetch one URL and return its content',\n} as const;\n",
  );

  // Both arms point at an unreachable spec so this stays offline: the sweep runs
  // BEFORE the fetch, so the arms differ only in whether the placeholder message
  // appears — not in the exit code, which is 1 either way here.
  //
  // 🔴 THAT IS EXACTLY WHY THIS TEST IS NOT ENOUGH ON ITS OWN, and why the
  // reachable-spec test below exists. Because both arms fail for the fetch's own
  // reason, neither one observes the sweep's CONTRIBUTION to the exit code:
  // measured, deleting `process.exitCode = 1` from `fail()` left this file 4/4
  // green while the script returned rc 0 over live `TODO(catalog)` entries.
  const runOffline = async (sdkSrc) => {
    const { out } = await runCheck({ SDK_SRC: sdkSrc, SPEC_URL: 'http://127.0.0.1:1/spec.json' });
    return out;
  };

  assert.match(
    await runOffline(withPlaceholder),
    /still carries a PLACEHOLDER description/,
    'the sweep must report a placeholder',
  );
  // The negative arm: without it, a sweep hardcoded to always report would pass.
  assert.doesNotMatch(
    await runOffline(withoutPlaceholder),
    /PLACEHOLDER description/,
    'the sweep must NOT report on a curated catalog — otherwise it is reporting unconditionally',
  );
});

test('a placeholder alone EXITS NON-ZERO when the spec is reachable and in sync', async (t) => {
  // 🔴 THE ARM THE SUITE WAS MISSING, and the one state the sweep exists for:
  // spec reachable, catalogs in perfect sync, a placeholder still unwritten.
  // Every other arm here fails for the fetch's own reason, so the sweep's own
  // `process.exitCode = 1` was never observed — deleting that line kept the
  // suite 4/4 green while `check:catalogs` returned rc 0 over two live
  // `TODO(catalog)` entries, which is precisely the silent skip its docblock
  // says it exists to prevent.
  //
  // Both the exit CODE and the message are asserted, separately: a run that
  // printed the placeholder text and still exited 0 would satisfy the message
  // assertion alone, and rc 0 is the whole defect.
  const server = await serveSpec(makeSpec({ echo: 'Echo the input back.' }));
  const dir = mkdtempSync(join(tmpdir(), 'catalog-sweep-live-'));
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Fixture matches the served spec EXACTLY, so the set comparison finds no
  // drift and cannot be the source of the failure.
  const fixture = join(dir, 'fixture.json');
  writeFileSync(
    fixture,
    `${JSON.stringify({ specUrl: server.url, readOn: '2000-01-01', workflowStepTypes: ['echo'], imageGenEngines: ['comfy'] }, null, 2)}\n`,
  );

  const curated = join(dir, 'curated.ts');
  const uncurated = join(dir, 'uncurated.ts');
  writeFileSync(curated, "export const WORKFLOW_STEP_TYPES = {\n  echo: 'Echo the input back.',\n} as const;\n");
  writeFileSync(
    uncurated,
    "export const WORKFLOW_STEP_TYPES = {\n  echo: 'TODO(catalog): no description yet — replace me',\n} as const;\n",
  );

  const env = (sdkSrc) => ({ SDK_SRC: sdkSrc, FIXTURE: fixture, SPEC_URL: server.url });

  // Control arm FIRST: the same fixture, the same spec, a curated catalog. If
  // this is not 0 then the arm under test proves nothing about the placeholder —
  // it would just be failing for the drift the control shares.
  const ok = await runCheck(env(curated));
  assert.equal(ok.code, 0, `a curated catalog against a matching spec must exit 0; got ${ok.code}\n${ok.out}`);
  assert.match(ok.out, /No drift/, 'the control arm must report a clean run');

  const bad = await runCheck(env(uncurated));
  assert.notEqual(bad.code, 0, `a surviving placeholder must exit NON-ZERO, got ${bad.code}\n${bad.out}`);
  assert.match(bad.out, /still carries a PLACEHOLDER description/, 'and must say which entry');
  assert.doesNotMatch(
    bad.out,
    /\nNo drift/,
    'the summary must not contradict the failure it just reported',
  );
});

test('a hostile discriminator key is REFUSED, with nothing written', async (t) => {
  // 🔴 The keys come from an unauthenticated remote spec that a `contents: write`
  // job fetches unattended, and the job's next step imports the module this
  // generates. A key that closes the object literal therefore reaches executable
  // position on the runner. Before the fix this exited 0, wrote the file, and
  // `globalThis.PWNED` came back 1 on import.
  const hostileKey = "x': 'y',\n} as const;\nglobalThis.PWNED=1;\nconst _pad = {'z";
  const server = await serveSpec(
    makeSpec({ echo: 'Echo the input back.', [hostileKey]: 'Looks like an ordinary sentence.' }),
  );
  const dir = makeTree({ stepTypes: ['echo'], engines: ['comfy'] });
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const before = [SDK, FIXTURE, TEST].map((p) => read(dir, p));
  const { code, out } = await runSync(dir, server.url);

  assert.notEqual(code, 0, `a key outside SAFE_KEY must fail, got ${code}\n${out}`);
  assert.match(out, /refuses to emit/, 'the refusal must say what it refused to do');
  assert.match(out, /globalThis\.PWNED/, 'and must name the offending key so it is diagnosable');
  // Separate claim from the exit code — the whole point of F6's deferred writes.
  assert.deepEqual(
    [SDK, FIXTURE, TEST].map((p) => read(dir, p)),
    before,
    'a refused sync must leave every file byte-identical',
  );
  assert.deepEqual(readdirSync(join(dir, '.changeset')), [], 'a refused sync must write no changeset');
});

test('a hostile DESCRIPTION is contained by the emitter, not merely by the key belt', async (t) => {
  // 🔴 `SAFE_KEY` cannot help here. A description is free prose — it legitimately
  // contains quotes, apostrophes and (in 5 of the 60 live catalog schemas) newlines
  // — so it can never be pattern-restricted, which makes it the end-to-end
  // control on `tsString` ITSELF. If this passes only because of the key belt,
  // the belt is doing work the emitter should be doing.
  //
  // The old emitter escaped backslashes and quotes but NOT newlines, so this
  // payload produced an unterminated string literal: fail-closed, but as a
  // syntax error in a file the next CI step imports. Verified against the
  // pre-change script — it exited 0, wrote the file, and the module then failed
  // to load with `SyntaxError: Expected unicode escape`.
  //
  // ⚠️ What this test pins is the COMPOSITE. Two independent changes close the
  // vector — `deriveDescription` collapsing whitespace, and `tsString` using
  // `JSON.stringify` — and reverting either ONE alone still leaves the payload
  // inert. Measured, so do not read a green here as isolating the emitter; the
  // emitter is isolated by the `tsKey` path, which has no pre-processing at all.
  const hostile =
    "Fetches a URL.',\n} as const;\nglobalThis.PWNED_BY_DESC=1;\nconst _pad = {\n  filler: 'x";
  const server = await serveSpec(makeSpec({ echo: 'Echo the input back.', evil: hostile }));
  const dir = makeTree({ stepTypes: ['echo'], engines: ['comfy'] });
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const { code, out } = await runSync(dir, server.url);
  assert.equal(code, 0, `an ordinary key with an ugly description must still sync; got ${code}\n${out}`);

  // 🔴 THE SUBSTANTIVE ASSERTIONS COME FIRST, DELIBERATELY. The shape checks
  // below would also fail under a bad emitter, but they would fail on QUOTE
  // STYLE — a cosmetic reason that reads like a passing safety test. Assert the
  // behaviour (does it parse; does the payload run) before the spelling.
  const sdk = read(dir, SDK);
  const { loaded, error, mod } = await importGenerated(dir, 'desc');
  assert.ok(
    loaded,
    `the generated module must still parse — a payload that merely breaks the file is ` +
      `still a self-inflicted DoS on a job that imports it: ${error?.message}`,
  );
  assert.equal(globalThis.PWNED_BY_DESC, undefined, '🔴 the payload EXECUTED — the emitter is unsafe');
  // Positive control on the whole check: the description really did travel
  // through the emitter and land in the object, rather than being dropped.
  assert.equal(
    mod.WORKFLOW_STEP_TYPES.evil,
    hostile.replace(/\s+/g, ' ').trim(),
    'the description must round-trip intact (whitespace-collapsed), not be silently discarded',
  );

  // One line: the catalog value is a one-line description, and a value that
  // spans lines is the shape that breaks out of a literal.
  const evilLines = sdk.split('\n').filter((l) => l.trimStart().startsWith('evil:'));
  assert.equal(evilLines.length, 1, `the entry must be exactly one line, got:\n${sdk}`);
  assert.doesNotMatch(
    evilLines[0],
    /^\s*evil: '/,
    'the value must not be emitted as a hand-escaped single-quoted literal',
  );
});

test('a description that merely RESTATES the key morphologically is a placeholder', async (t) => {
  // 🔴 The rule used to be an exact normalised match, which caught only the
  // generator's verbatim echo. Measured against the live spec, three real keys
  // slipped through it while saying nothing: `imageGen` -> "Image Generation",
  // `transcode` -> "Transcoding", `videoGen` -> "Video generation". Those are the
  // expensive case, because they LOOK curated and nobody rewrites them.
  //
  // Paired, in the same run and off the same spec, with keys whose descriptions
  // add a word — otherwise "widened the rule" is indistinguishable from "rejects
  // everything now", which would make every entry a placeholder.
  const spec = makeSpec({
    echo: 'Echo the input back.',
    imageGen: 'Image Generation',
    transcode: 'Transcoding',
    videoGen: 'Video generation',
    polyGen: '3D model generation',
    comfy: 'Comfy workflows',
    videoUpscaler: 'Upscale videos using FlashVSR',
  });
  const server = await serveSpec(spec);
  const dir = makeTree({ stepTypes: ['echo'], engines: ['comfy'] });
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const { code, out } = await runSync(dir, server.url);
  assert.equal(code, 0, `sync should succeed; got ${code}\n${out}`);
  const sdk = read(dir, SDK);

  for (const key of ['imageGen', 'transcode', 'videoGen']) {
    assert.match(
      sdk,
      new RegExp(`${key}: "TODO\\(catalog\\): no description yet`),
      `${key}: a morphological restatement of the key must NOT ship as a description`,
    );
  }
  for (const [key, text] of [
    ['polyGen', '3D model generation'],
    ['comfy', 'Comfy workflows'],
    ['videoUpscaler', 'Upscale videos using FlashVSR'],
  ]) {
    assert.match(
      sdk,
      new RegExp(`${key}: ${JSON.stringify(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      `${key}: a description carrying a word the key does not have must be KEPT`,
    );
  }
});

test('a failure PART WAY THROUGH leaves every file byte-identical', async (t) => {
  // 🔴 The EXIT CODES docblock promises "nothing written" on exit 1. It used to
  // be false: the fixture and the SDK source were written BEFORE `bumpCount`
  // ran, so a test file without the expected assertion left a maintainer who ran
  // `pnpm sync:catalogs` with a half-applied change and a message saying
  // otherwise. This drives exactly that ordering — a valid spec, real drift, and
  // a test file `bumpCount` cannot edit.
  const server = await serveSpec(makeSpec({ echo: 'Echo the input back.', songGen: 'Generate a song.' }));
  const dir = makeTree({ stepTypes: ['echo'], engines: ['comfy'] });
  t.after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Remove the assertion `bumpCount` requires — the LAST of the three edits.
  writeFileSync(join(dir, TEST), '    expect(body.steps).toHaveLength(1);\n');
  const before = [SDK, FIXTURE, TEST].map((p) => read(dir, p));

  const { code, out } = await runSync(dir, server.url);
  assert.equal(code, 1, `an unrecognised file shape must exit 1, got ${code}\n${out}`);
  assert.match(out, /toHaveLength/, 'the failure must name what it could not edit');
  assert.deepEqual(
    [SDK, FIXTURE, TEST].map((p) => read(dir, p)),
    before,
    'exit 1 must mean NOTHING was written — including the fixture and the SDK source, which are computed first',
  );
  assert.deepEqual(readdirSync(join(dir, '.changeset')), [], 'and no changeset');
});
