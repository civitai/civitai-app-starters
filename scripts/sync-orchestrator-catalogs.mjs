#!/usr/bin/env node
/**
 * sync-orchestrator-catalogs.mjs
 * ------------------------------
 * WRITE twin of `check-orchestrator-catalogs.mjs`. That script tells you the
 * hand-maintained SDK catalogs have fallen behind the live orchestrator spec;
 * this one performs the mechanical half of catching them up and leaves exactly
 * the judgement half — the prose — for a human.
 *
 * WHY IT EXISTS. `Orchestrator catalog drift-check` is a pure fetch-and-compare
 * against `https://orchestration.civitai.com/openapi/v2-consumers.json`, so it
 * goes red repo-wide the moment the orchestrator ships a step type, with no
 * change in this repo and nothing to subscribe to. It is advisory (not a
 * required context), which is precisely the hazard: a permanently-red gate
 * trains everyone to click through, and the next REAL drift is then invisible.
 * Measured on 2026-09-01: `main` was red on `webScrape` + `webSearch`, shipped
 * upstream some time after the 2026-08-28 fixture read. Same argument as the
 * sibling `revendor-canonical-schema.yml`, whose cron comment spells it out.
 *
 * WHAT IT WRITES (4 files, the same 4 a human touches by hand — see
 * `da3a9dd`, the `miniMaxMusic3` precedent):
 *   1. packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json
 *      — the transcribed lists, re-read from the live mapping, plus `readOn`.
 *   2. packages/civitai-app-sdk/src/orchestrator/index.ts — the new keys,
 *      appended to the matching catalog in a clearly-marked block.
 *   3. packages/civitai-app-sdk/test/orchestrator.test.ts — the pinned
 *      `toHaveLength` counts, which are a positive control on the fixture and
 *      exist to be bumped deliberately.
 *   4. .changeset/orchestrator-catalog-sync-<date>.md — `minor`, per
 *      RELEASING.md: `WorkflowStepType` is `keyof typeof WORKFLOW_STEP_TYPES`,
 *      so a new key widens an exported union. Purely additive.
 *
 * 🔴 IT NEVER INVENTS A DESCRIPTION. The catalog's whole job is the one-line
 * description a developer reads when picking a step, so a fabricated one is
 * worse than none. `deriveDescription` takes the spec's own
 * `<X>StepTemplate.description` and takes it ONLY when it says something the
 * key does not already say; otherwise it writes `PLACEHOLDER_DESCRIPTION`,
 * which states plainly that there is no description yet. Measured both
 * branches against the live spec on 2026-09-01:
 *   - `MiniMaxMusic3StepTemplate.description` is "Generate a complete song from
 *     a structured caption and lyrics with MiniMax Music 3." — used verbatim.
 *   - `WebScrapeStepTemplate.description` is "WebScrape" — a restatement of the
 *     key, which is what the generator emits when nobody wrote one. Rejected.
 * `check-orchestrator-catalogs.mjs` then REPORTS while any placeholder survives.
 * 🔴 It reports; it does not block. That check is ADVISORY — see the honesty
 * note in its own `sweepPlaceholders` docblock, and do not restate it here as a
 * merge gate. What actually keeps an uncurated entry from living on `main` is
 * that this job re-opens the PR until someone writes the sentence.
 *
 * 🔴 IT NEVER REMOVES A KEY. A key the orchestrator has withdrawn is a
 * BREAKING change to the exported `WorkflowStepType` / `ImageGenEngine` union
 * (a `major`), and deciding whether to drop it, deprecate it, or wait out an
 * orchestrator rollback is judgement this script does not have. It exits 2
 * without writing anything and names the keys.
 *
 * 🔴 IT NEVER EMITS A KEY IT DOES NOT RECOGNISE. The keys come from an
 * unauthenticated remote spec, read unattended by a `contents: write` job whose
 * next step imports the module this generates — so a key is untrusted input that
 * reaches executable position. `tsKey`/`tsString` are safe on their own
 * (`JSON.stringify`, whose output is valid TS and escapes quotes, backslashes,
 * newlines and control characters alike); `SAFE_KEY` is the separate belt that
 * refuses, writing nothing, rather than emitting something merely mangled.
 *
 * EXIT CODES (the workflow distinguishes them; do not collapse them)
 *   0  either nothing drifted (no writes) or the additive drift was written
 *   1  the spec was unreachable / unreadable, carried a key outside `SAFE_KEY`,
 *      or a file this must edit did not have the shape it knows how to edit —
 *      nothing written
 *   2  the drift includes a REMOVAL — nothing written, a human must decide
 *
 * 🔴 "NOTHING WRITTEN" IS LITERAL, AND IT IS LOAD-BEARING NOW THAT THIS IS ALSO
 * A HUMAN-FACING `pnpm sync:catalogs`. Every edit is staged in memory and
 * flushed in one pass at the very end of `main()`; the throwing steps all run
 * before the flush. An earlier version wrote as it went, so an exit 1 from
 * `bumpCount` left the fixture and the SDK source already modified while the
 * message said otherwise.
 *
 * USAGE
 *   node scripts/sync-orchestrator-catalogs.mjs
 *   SPEC_URL=... REPO_ROOT=... node scripts/sync-orchestrator-catalogs.mjs
 *
 * `SPEC_URL` and `REPO_ROOT` are overridable so a self-test can drive this
 * against a synthetic spec and a throwaway tree — an unvalidated writer is a
 * claim about the writer, not about the catalogs. See
 * `tests/guards/sync-orchestrator-catalogs.test.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PLACEHOLDER_DESCRIPTION } from './orchestrator-catalog-placeholder.mjs';

const REPO_ROOT =
  process.env.REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SPEC_URL =
  process.env.SPEC_URL ?? 'https://orchestration.civitai.com/openapi/v2-consumers.json';

const FIXTURE = join(
  REPO_ROOT,
  'packages/civitai-app-sdk/test/fixtures/orchestrator-spec-catalogs.json',
);
const SDK_SRC = join(REPO_ROOT, 'packages/civitai-app-sdk/src/orchestrator/index.ts');
const TEST_SRC = join(REPO_ROOT, 'packages/civitai-app-sdk/test/orchestrator.test.ts');
const CHANGESET_DIR = join(REPO_ROOT, '.changeset');

/**
 * The catalogs under sync. `fixtureKey` / `schema` / `sdkName` are the same
 * triple `check-orchestrator-catalogs.mjs` reads — keep them in step.
 * `countVar` is the identifier the pinned `toHaveLength` assertion is written
 * against in the test file.
 */
const CATALOGS = [
  {
    fixtureKey: 'workflowStepTypes',
    schema: 'WorkflowStepTemplate',
    sdkName: 'WORKFLOW_STEP_TYPES',
    countVar: 'SPEC_WORKFLOW_STEP_TYPES',
    label: 'step type',
  },
  {
    fixtureKey: 'imageGenEngines',
    schema: 'ImageGenInput',
    sdkName: 'IMAGE_GEN_ENGINES',
    countVar: 'SPEC_IMAGE_GEN_ENGINES',
    label: 'imageGen engine',
  },
];

class Fatal extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** `YYYY-MM-DD`, UTC. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The authoritative key set for one catalog, plus each key's `$ref` target.
 *
 * Every unexpected shape THROWS rather than returning `{}` — an empty mapping
 * here would be read as "the orchestrator accepts nothing", i.e. a removal of
 * every key, which is the most destructive misreading available.
 */
function mapping(spec, schemaName) {
  const schema = spec?.components?.schemas?.[schemaName];
  if (!schema) throw new Fatal(`spec has no components.schemas.${schemaName}`);
  const map = schema?.discriminator?.mapping;
  if (!map || typeof map !== 'object') {
    throw new Fatal(`components.schemas.${schemaName} has no discriminator.mapping`);
  }
  if (Object.keys(map).length === 0) {
    throw new Fatal(`components.schemas.${schemaName}.discriminator.mapping is EMPTY`);
  }
  return map;
}

/** Case- and punctuation-insensitive: `webScrape` and `WebScrape` collapse to one token. */
const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Split an identifier OR a sentence into lowercase word tokens. `imageGen` and
 * `Image Generation` both come back as two tokens — the camelCase split is what
 * lets a key and a prose restatement of it be compared word by word.
 */
const tokenise = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * The crudest useful stemmer: strip ONE trailing inflection, and only when at
 * least three characters survive. `transcoding` (-ing) and `transcode` (-e) both
 * reduce to `transcod`, and `generation` (-ation) to `gener`, which is what lets
 * `Video generation` be recognised as a restatement of `videoGen`.
 *
 * The three-character floor is the whole safety margin: without it a short token
 * like `used` would reduce to `us` and prefix-match half the dictionary.
 */
const stem = (t) => {
  for (const suffix of ['ation', 'ing', 'ion', 'es', 'ed', 's', 'e']) {
    if (t.length - suffix.length >= 3 && t.endsWith(suffix)) return t.slice(0, -suffix.length);
  }
  return t;
};

/**
 * True when `text` says nothing that `key` does not already say: the same words,
 * in the same order, allowing a morphological ending on either side.
 *
 * 🔴 WIDER THAN AN EXACT MATCH, DELIBERATELY (2026-09-02). The rule used to be
 * `normalise(text) === normalise(key)`, which only catches the generator's
 * verbatim echo (`webScrape` → "WebScrape"). Measured against the live spec that
 * let three morphological restatements through as "derived" while saying
 * nothing: `imageGen` → "Image Generation", `transcode` → "Transcoding",
 * `videoGen` → "Video generation". Those are the expensive case — they LOOK
 * curated, so nobody rewrites them and `check:catalogs` stays green.
 *
 * The token-count equality is what keeps it from over-rejecting: measured over
 * the same live spec, widening the rule moved exactly those 3 of 60 keys and
 * nothing else. A description carrying even one word the key does not have
 * (`comfy` → "Comfy workflows", `polyGen` → "3D model generation") is kept.
 */
function restatesKey(text, key) {
  const words = tokenise(text);
  const keyWords = tokenise(key);
  if (words.length === 0 || words.length !== keyWords.length) return false;
  return words.every((w, i) => {
    if (w === keyWords[i]) return true;
    const [a, b] = [stem(w), stem(keyWords[i])];
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    return short.length >= 3 && long.startsWith(short);
  });
}

/**
 * Text that must never be emitted as a catalog value, after whitespace has been
 * collapsed. C0 controls and DEL only: `\t`, `\n`, `\r`, U+2028 and U+2029 are
 * all `\s` in JavaScript and have therefore already been folded to spaces by the
 * time this runs.
 *
 * Measured 2026-09-02 over all 60 live catalog entries: **0** carry a
 * non-whitespace control character, and 0 trip this after collapsing — while
 * **5 DO contain newlines** (2 of the 47 step schemas, 3 of the 13 engine
 * schemas). That is why the answer is "collapse the whitespace" rather than
 * "reject anything with a control character": rejecting on newlines would have
 * thrown away five real, useful descriptions.
 */
const FORBIDDEN_IN_TEXT = /[\u0000-\u001f\u007f]/;

/**
 * The shape a `discriminator.mapping` key must have before this script will emit
 * it into TypeScript source.
 *
 * 🔴 THIS IS A BELT, NOT THE BUCKLE. `tsKey`/`tsString` below are safe on their
 * own; this exists so a key the emitters would merely MANGLE is refused loudly
 * instead. The keys come from an unauthenticated remote spec, read unattended by
 * a `contents: write` job whose next step imports the file it just generated, so
 * "the emitter handles it" and "we recognise it" are worth asserting separately.
 *
 * Measured 2026-09-02: all 60 live keys (47 step types + 13 imageGen engines)
 * pass, and `flux1-kontext` is the only one that is not a bare identifier. If the
 * orchestrator ever ships a key shape outside this, the sync refuses with exit 1
 * and names it — a human widens the pattern deliberately.
 */
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;

/** A key that can be written into an object literal without quoting. */
const BARE_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * The one-line description for a newly-seen key, or the placeholder.
 *
 * 🔴 The rejection rule is the whole point. An OpenAPI generator emits the
 * schema's C# type name as `description` when the source carries no doc
 * comment, so `WebScrapeStepTemplate` arrives as `"WebScrape"` — text that
 * looks like a description, contains no information the key does not already
 * carry, and would ship as the catalog's answer for that step. Anything that
 * normalises to the referenced schema's own name, or merely RESTATES the key
 * (see `restatesKey`), is therefore not a description.
 *
 * Returns `{ text, derived, rejected }`. `rejected` is a short reason string
 * when a description was present and thrown away, so the run can say WHY it fell
 * back to a placeholder instead of silently looking like "the spec had nothing".
 */
function deriveDescription(spec, key, ref) {
  const name = typeof ref === 'string' ? ref.split('/').pop() : undefined;
  const raw = String(spec?.components?.schemas?.[name]?.description ?? '');
  // Collapse first: the catalog value is a ONE-LINE description, and 5 of the 60
  // live catalog descriptions are multi-line. Emitting one verbatim is not a
  // safety problem (`tsString` escapes it) but it is not a one-liner either.
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return { text: PLACEHOLDER_DESCRIPTION, derived: false };
  if (FORBIDDEN_IN_TEXT.test(text)) {
    return {
      text: PLACEHOLDER_DESCRIPTION,
      derived: false,
      rejected: 'contains control characters',
    };
  }
  if (name && normalise(text) === normalise(name)) {
    return { text: PLACEHOLDER_DESCRIPTION, derived: false, rejected: 'restates the schema name' };
  }
  if (restatesKey(text, key)) {
    return { text: PLACEHOLDER_DESCRIPTION, derived: false, rejected: 'restates the key' };
  }
  return { text, derived: true };
}

/**
 * A TypeScript string literal for arbitrary text.
 *
 * 🔴 `JSON.stringify`, NOT hand-rolled quoting (2026-09-02). The previous
 * implementation escaped backslashes and quotes only, which leaves NEWLINES —
 * present in 5 of the 60 live descriptions — to terminate the literal and turn
 * the generated module into a syntax error. JSON's string grammar is a subset of
 * TypeScript's, so `JSON.stringify` is valid TS, and it escapes quotes,
 * backslashes, newlines and every other control character, always on one line.
 *
 * ⚠️ HONEST SCOPE, measured rather than assumed. Swapping ONLY this function back
 * to the old escaper does NOT re-open the description injection, because
 * `deriveDescription` now collapses whitespace before calling it and rejects any
 * surviving control character — so by the time text arrives here the old escaper
 * would handle it too. What `JSON.stringify` buys is that the safety stops
 * depending on a CALLER doing the right thing first: a future second call site
 * that forgets to collapse cannot reintroduce the class. The place where this
 * function's own escaping is load-bearing is `tsKey`, which has no such
 * pre-processing — verified by deleting `SAFE_KEY` and watching the hostile key
 * still land inert as a single quoted key.
 *
 * The cost is double quotes in a file that otherwise uses single ones. Checked
 * before accepting it: this repo has NO root prettier or eslint config, the SDK
 * package has no `lint` script at all (`pnpm lint` fails repo-wide with
 * ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT), and `.editorconfig` says nothing about
 * quotes — so nothing enforces the style, and contorting the escaping to
 * preserve it would be trading correctness for cosmetics. The reviewer who
 * rewrites the line anyway can restyle it then.
 */
const tsString = (s) => JSON.stringify(String(s));

/**
 * A TS object key: bare when it is a plain identifier, JSON-quoted otherwise
 * (`flux1-kontext`).
 *
 * 🔴 BOTH BRANCHES MUST BE SAFE ON THEIR OWN. The bare branch is safe because
 * `BARE_IDENTIFIER` cannot match a string containing a quote, a backslash, a
 * newline or a brace. The quoted branch used to be `'${k}'` with NO escaping at
 * all, which let a hostile key from the remote spec close the object literal and
 * inject top-level statements into the generated module — which the workflow's
 * own validate step then imports. Verified dead: see the `tsKey` cases in
 * `tests/guards/sync-orchestrator-catalogs.test.mjs`.
 */
const tsKey = (k) => (BARE_IDENTIFIER.test(k) ? k : JSON.stringify(String(k)));

/**
 * Append entries to the `export const <constName> = { … } as const;` object in
 * `src`, immediately before its closing brace.
 *
 * Appending rather than slotting into the right section is deliberate: the
 * sections are SEMANTIC (`// ----- Audio ---`, `// ----- Web ---`) and picking
 * one is judgement this script does not have. The block says so, and the
 * reviewer moves the entry while writing its description.
 */
function appendToCatalog(src, constName, entries, date) {
  const open = `export const ${constName} = {`;
  const start = src.indexOf(open);
  if (start === -1) throw new Fatal(`could not find \`${open}\` in ${SDK_SRC}`);
  const close = src.indexOf('\n} as const;', start);
  if (close === -1) {
    throw new Fatal(`could not find the closing \`} as const;\` of ${constName} in ${SDK_SRC}`);
  }

  const lines = [
    '',
    `  // ----- Auto-added ${date} from the orchestrator spec ----------------------`,
    '  // Added by scripts/sync-orchestrator-catalogs.mjs: the live spec accepts',
    '  // these and this catalog did not list them. MOVE each entry into the right',
    '  // section above, and replace any TODO(catalog) line with a real one-line',
    '  // description — `pnpm check:catalogs` names every placeholder that is left.',
    '  // (That check is advisory, so it will not stop this merging. It is a',
    '  // reminder, not a gate.)',
  ];
  for (const { key, text, derived } of entries) {
    lines.push(
      derived
        ? `  /** Description taken verbatim from the spec's ${constName === 'IMAGE_GEN_ENGINES' ? 'engine' : 'step'} schema — confirm it reads well here. */`
        : `  /** 🔴 PLACEHOLDER — the spec carries no usable description for this one. Write it. */`,
      `  ${tsKey(key)}: ${tsString(text)},`,
    );
  }
  return src.slice(0, close) + lines.join('\n') + src.slice(close);
}

/**
 * Bump `expect(<countVar>).toHaveLength(<n>)` to the live count.
 *
 * Asserts the pattern occurs EXACTLY once before replacing. A `count=1`
 * replace over a pattern that occurs twice edits whichever one comes first,
 * which is not the one you pictured — and here the two catalogs' assertions sit
 * three lines apart.
 */
function bumpCount(src, countVar, n) {
  const re = new RegExp(`expect\\(${countVar}\\)\\.toHaveLength\\((\\d+)\\)`, 'g');
  const hits = [...src.matchAll(re)];
  if (hits.length !== 1) {
    throw new Fatal(
      `expected exactly 1 \`expect(${countVar}).toHaveLength(N)\` in ${TEST_SRC}, found ${hits.length}`,
    );
  }
  return src.replace(re, `expect(${countVar}).toHaveLength(${n})`);
}

async function main() {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

  console.log(`Fetching orchestrator spec from ${SPEC_URL} ...`);
  let spec;
  try {
    const res = await fetch(SPEC_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    spec = await res.json();
  } catch (err) {
    // Same reasoning as the read guard: a skipped sync is indistinguishable
    // from a clean one, so fail rather than exit 0 on an unreachable spec.
    throw new Fatal(`orchestrator spec fetch failed (${err.message}) from ${SPEC_URL}`);
  }

  const plans = [];
  const removals = [];

  for (const cat of CATALOGS) {
    const declared = fixture?.[cat.fixtureKey];
    if (!Array.isArray(declared) || declared.length === 0) {
      throw new Fatal(`fixture key "${cat.fixtureKey}" is missing or empty in ${FIXTURE}`);
    }
    const map = mapping(spec, cat.schema);
    const live = Object.keys(map);

    // ---- the key belt, BEFORE anything is planned or written ----------------
    // Every live key ends up somewhere this script writes: a newly-seen one is
    // emitted into TypeScript source, and every one of them is transcribed into
    // the fixture. A key outside SAFE_KEY means the spec is not the shape this
    // script believes it is reading, which is not a thing to paper over — refuse
    // and name it. Fail-closed AND diagnosable: emitting something that merely
    // fails to parse three steps later is the worse outcome.
    const unsafe = live.filter((k) => !SAFE_KEY.test(k));
    if (unsafe.length) {
      throw new Fatal(
        `${cat.schema}.discriminator.mapping carries ${unsafe.length} key${unsafe.length === 1 ? '' : 's'} this script refuses to emit:\n` +
          unsafe.map((k) => `    - ${JSON.stringify(k)}`).join('\n') +
          `\n  A step type / engine key becomes a TypeScript object key and a member of an\n` +
          `  exported union, so it must be an ordinary identifier-shaped token\n` +
          `  (${SAFE_KEY}). Every one of the 60 keys live on 2026-09-02 satisfies that.\n` +
          `  If the orchestrator has legitimately started shipping a new key SHAPE, widen\n` +
          `  SAFE_KEY deliberately in the same commit as the entry. Nothing was written.`,
      );
    }

    const liveSet = new Set(live);
    const declaredSet = new Set(declared);

    for (const k of declared) if (!liveSet.has(k)) removals.push(`${cat.sdkName}: ${k}`);

    const missing = live.filter((k) => !declaredSet.has(k)).sort();
    plans.push({ ...cat, live, missing });
  }

  if (removals.length) {
    throw new Fatal(
      `the orchestrator has WITHDRAWN keys this catalog still lists:\n` +
        removals.map((r) => `    - ${r}`).join('\n') +
        `\n  Removing an exported key is a BREAKING change to WorkflowStepType /\n` +
        `  ImageGenEngine (a \`major\`), and whether to drop it, deprecate it, or wait\n` +
        `  out an orchestrator rollback is a call this script does not get to make.\n` +
        `  Nothing was written. Handle it by hand.`,
      2,
    );
  }

  if (plans.every((p) => p.missing.length === 0)) {
    console.log('\nNo drift: the transcribed catalogs already match the live orchestrator spec.');
    return;
  }

  const date = today();

  // 🔴 EVERY EDIT IS STAGED IN MEMORY AND FLUSHED AT THE END. The EXIT CODES
  // block promises "nothing written" on exit 1, and this script's later steps
  // throw: `appendToCatalog` on an unrecognised catalog literal, `bumpCount` on
  // a `toHaveLength` assertion that is not there exactly once. Writing as it
  // went made that promise false — a maintainer running `pnpm sync:catalogs`
  // was told nothing had been written and found the fixture and the SDK source
  // already rewritten in their tree. Nothing below calls writeFileSync.
  const pending = [];

  // ---- 1. the transcribed fixture -----------------------------------------
  for (const p of plans) fixture[p.fixtureKey] = [...p.live].sort();
  fixture.readOn = date;
  pending.push({ path: FIXTURE, content: `${JSON.stringify(fixture, null, 2)}\n` });

  // ---- 2. the SDK catalogs -------------------------------------------------
  let sdk = readFileSync(SDK_SRC, 'utf8');
  const added = [];
  for (const p of plans) {
    if (!p.missing.length) continue;
    const map = mapping(spec, p.schema);
    const entries = p.missing.map((key) => ({
      key,
      ...deriveDescription(spec, key, map[key]),
    }));
    added.push({ ...p, entries });
    sdk = appendToCatalog(sdk, p.sdkName, entries, date);
  }
  pending.push({ path: SDK_SRC, content: sdk });

  // ---- 3. the pinned counts ------------------------------------------------
  let test = readFileSync(TEST_SRC, 'utf8');
  for (const p of plans) test = bumpCount(test, p.countVar, p.live.length);
  pending.push({ path: TEST_SRC, content: test });

  // ---- 4. the changeset ----------------------------------------------------
  const bullets = added.flatMap(({ sdkName, label, entries }) =>
    entries.map(
      ({ key, derived }) =>
        `- \`${sdkName}\`: add the \`${key}\` ${label}${derived ? '' : ' *(description still a placeholder — see below)*'}`,
    ),
  );
  const anyPlaceholder = added.some(({ entries }) => entries.some((e) => !e.derived));
  const changeset =
    `---\n'@civitai/app-sdk': minor\n---\n\n` +
    `Catalog sync: the orchestrator spec accepts ${bullets.length} entr${bullets.length === 1 ? 'y' : 'ies'} the SDK catalogs did not list.\n\n` +
    `${bullets.join('\n')}\n\n` +
    `\`WORKFLOW_STEP_TYPES\` / \`IMAGE_GEN_ENGINES\` are hand-maintained mirrors of the ` +
    `\`discriminator.mapping\`s in \`${SPEC_URL}\`, which moves per orchestrator build — so ` +
    `they drift without anyone touching this repo. Read on ${date}.\n\n` +
    `**Why \`minor\`.** \`WorkflowStepType\` is \`keyof typeof WORKFLOW_STEP_TYPES\`, so this ` +
    `widens an exported union. Purely additive: nothing that compiled before stops compiling, ` +
    `and there is no runtime behaviour change.\n` +
    (anyPlaceholder
      ? `\n🔴 **This changeset was written by \`scripts/sync-orchestrator-catalogs.mjs\` and at least ` +
        `one description is still a placeholder.** Replace it, then rewrite this paragraph to say ` +
        `what the new entries actually do.\n`
      : '');
  pending.push({
    path: join(CHANGESET_DIR, `orchestrator-catalog-sync-${date}.md`),
    content: changeset,
  });

  // ---- flush ---------------------------------------------------------------
  // The first write in the run. Everything above either produced a complete
  // buffer or threw before reaching here.
  for (const { path, content } of pending) writeFileSync(path, content);

  // ---- report --------------------------------------------------------------
  console.log('');
  for (const { sdkName, entries } of added) {
    for (const { key, derived, rejected } of entries) {
      const how = derived
        ? 'description from the spec'
        : `PLACEHOLDER description${rejected ? ` (the spec's own ${rejected})` : ' (the spec carried none)'}`;
      console.log(`  + ${sdkName}.${key} — ${how}`);
    }
  }
  console.log(
    `\nWrote ${pending.length} files. ${
      anyPlaceholder
        ? '🔴 At least one description is a PLACEHOLDER — `pnpm check:catalogs` reports it (advisory) until a maintainer replaces it.'
        : 'Every description came from the spec; still read them before merging.'
    }`,
  );
}

try {
  await main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(err instanceof Fatal ? err.code : 1);
}
