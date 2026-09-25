#!/usr/bin/env node
/**
 * check-public-type-closure.mjs
 * -----------------------------
 * PUBLIC-TYPE-CLOSURE GUARD for the published packages (#379). Offline, no
 * network. Reads the BUILT `.d.ts` entry points named by each package's
 * `exports` map and answers, per reference site: can a consumer of the
 * published package NAME this type?
 *
 * ## What #379 asked for, what was measured, and why this is narrower
 *
 * The issue's closing condition was literal: *"No exported declaration
 * references a non-exported type."* Re-derived on `e993cf0` with the scanner in
 * `scripts/lib/dts-public-type-closure.mjs`, that condition has **47 violating
 * reference sites** — the same headline number the 2026-09-19 audit reported,
 * but NOT the same set. #416 had already closed every `Use<Hook>Return` the
 * issue named, and six further names it listed
 * (`ScanEntry`, `OriginMatcher`, `PendingRequest`, `ActiveToast`, and
 * `liveHost`'s three trpc result types) never appear in a public signature at
 * all — they are local-variable and private-field types, which a `.d.ts` elides.
 * `UseImageUploadOptions` is exported today. The overlap is coincidence in the
 * total, not continuity in the finding.
 *
 * ### The audit's NAMES are real — checked, because the diagnostics suggest
 * ### otherwise and the suggestion is a red herring
 *
 * Importing the hidden names produces `TS2724: … has no exported member named
 * 'ManifestSettingFieldBase'. Did you mean 'ManifestSettingField'?`, which reads
 * as "the audit misspelled it". It is not. TypeScript emits the spelling
 * suggestion whenever a near-match exists among the module's EXPORTS, and it
 * does so even when the requested name IS declared in that exact file —
 * MEASURED: importing `ResourceCardCardProps` straight from its own declaring
 * file `dist/ui/ResourceCard.d.ts`, where `interface ResourceCardCardProps` is
 * on line 97, still yields TS2724. `TS2459` ("declares 'CommonOpts' locally, but
 * it is not exported") is the diagnostic that DOES assert existence, but its
 * absence asserts nothing. **The error code is not evidence about existence in
 * either direction** — the authority is the declaration itself.
 *
 * Checked independently by enumerating declarations across every package `src`:
 * 23 of the 24 names the issue cites exist under the exact spelling given. The
 * single exception is `UseBuzzWorkflowReturn`, which is the row #416 already
 * closed. So the issue is inaccurate about what is BROKEN, not about what
 * exists.
 *
 * One name is a third case worth separating: `FieldBaseProps` IS exported from
 * its own module and merely absent from the package barrel — importing it from
 * `dist/internal/field.d.ts` type-checks cleanly. That is the `internal/`
 * directory feeding public signatures, the shape #378 fixed in blocks-react.
 *
 * Classified by POSITION, the 47 were:
 *
 *     20  extends (a base whose members INLINE into the exported derived type)
 *     20  alias-rhs (reachable with Extract / keyof / indexed access)
 *      3  type-param-constraint
 *      2  property (reachable with T['key'])
 *      1  callback-parameter (contextually typed at the call site)
 *      1  parameter  <-- the one real defect
 *
 * ## The evidence that 46 of 47 are not friction
 *
 * MEASURED, not argued. An external consumer project was created outside the
 * workspace, installed from the real `pnpm pack` tarballs of all five packages,
 * and made to do the thing the issue says is impossible — construct, read,
 * store and wrap every affected exported type without ever naming the
 * non-exported one. Two files, one tsc invocation each:
 *
 *     probe.ts    (every affected export, used name-free)  ->  0 errors
 *     control.ts  (import the 8 hidden names directly)     ->  8 errors
 *                  TS2305 / TS2459 / TS2724 — "has no exported member" /
 *                  "declares 'StepTemplateMap' locally, but it is not exported"
 *
 * After the fix below, and re-installed from a freshly packed tarball, the
 * control reports **7** — `RawGenerationResourcesResponse` is the one name that
 * stopped erroring, which is the whole of the code change measured from the
 * consumer's side rather than from ours.
 *
 * The pair is the point. `control.ts` going red proves the harness can fail AND
 * that the bases really are un-importable, so `probe.ts`'s zero is a statement
 * about structural inlining rather than about the types being exported after
 * all. A consumer writes `ExchangeCodeOpts` and gets `clientId` / `clientSecret`
 * / `baseUrl` / `fallbackScope`; `Pick<RefreshTokenOpts, 'clientId' | …>` names
 * the shared half; `Extract<ResourceCardProps, { variant: 'card' }>` names a
 * union arm; `keyof WorkflowStepTemplates` is `keyof StepTemplateMap`.
 *
 * Two of the 47 are deliberate and documented: `StepTemplateMap` and
 * `GuardPeer` are non-exported BY DESIGN, with an invariant written into
 * `packages/civitai-app-sdk/src/orchestrator/steps.ts` and a test
 * (`test/orchestrator/steps-peer-guard.test.ts`) that pins it. Implementing the
 * issue's literal condition would require exporting them, i.e. breaking an
 * invariant another guard already enforces. The literal condition is not just
 * over-broad; it is unimplementable as written.
 *
 * The ONE real defect was `responseToResources(raw: RawGenerationResourcesResponse)`
 * — an exported function's parameter. A consumer calling it must PRODUCE that
 * value, and the only route left was `Parameters<typeof responseToResources>[0]`.
 * That type and its row type are exported now.
 *
 * ## The narrowed condition this file enforces
 *
 * > Every type a public entry's `.d.ts` references must be reachable by a
 * > consumer. In a NAMEABLE POSITION — a function's return type, a function
 * > declaration's parameter, a callback's return — it must be exported outright:
 * > those are the positions where the consumer must produce or store a value and
 * > the name-free route costs them naming the function too. In every other
 * > position, reachability is by a name-free TypeScript operation, and each such
 * > site must be RECORDED on the ledger below with the route a consumer takes.
 *
 * That is strictly the literal condition plus an AUDITED EXEMPTION LIST, not a
 * weaker check: `LEDGER` is a set equality, so a brand-new `extends`-base or
 * alias-rhs violation fails this guard until a human adds the line and states
 * the route. It fails on GROW and on SHRINK — deleting both halves of a
 * relationship cannot quietly satisfy it.
 *
 * ## Controls
 *
 * `--self-test` runs the scanner over two synthetic `.d.ts` fixtures before the
 * real scan is believed:
 *   - NEGATIVE CONTROL (#379's own wording): a deliberately unexported type in a
 *     return position. Must be reported, by name, as a nameable-position
 *     violation.
 *   - POSITIVE CONTROL: the same fixture with that type exported. Must report
 *     zero — and must still have walked a non-zero number of reference nodes,
 *     so a scanner wired to nothing cannot pass as "clean".
 * CI runs `--self-test` BEFORE the real check, like the sibling
 * `check:shipped-sourcemaps` job.
 *
 * 🔴 THE REAL SCAN IS NOT IN `tests/guards/`, ON PURPOSE — same reason as
 * `check-shipped-sourcemaps.mjs`. `pnpm test:guards` runs in the required matrix
 * job BEFORE `pnpm install`, and this needs both the installed `typescript` and
 * a BUILT `dist/`. It fails loudly on an unbuilt or empty tree rather than
 * reporting a vacuous "0 violations" over nothing scanned.
 *
 * This file's own LOGIC is unit-tested over synthetic trees, in
 * `tests/guards/check-public-type-closure-patterns.test.mjs`. That suite needs
 * the installed `typescript` too, so it SKIPS in the pre-install matrix tier
 * and is run from the `public-types` job (`pnpm test:guards:public-types`, with
 * `GUARDS_REQUIRE_INSTALL=1` so it cannot skip there). Both tiers are green;
 * only the second one can see anything.
 */
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NAMEABLE_POSITIONS, ledgerLine, scanEntries } from './lib/dts-public-type-closure.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const PACKAGES = [
  'civitai-app-sdk',
  'civitai-blocks-react',
  'civitai-components',
  'civitai-components-react',
  'civitai-theme',
];

/**
 * A scan that walks nothing reports zero violations, which reads exactly like a
 * clean tree. These floors are what make the zero mean something. Both were
 * measured on `e993cf0` (579 exported symbols, 996 reference nodes) and are set
 * well below, so they catch "the build did not happen" without tripping on
 * ordinary churn.
 */
const MIN_EXPORTED_SYMBOLS = 300;
const MIN_REFERENCE_NODES = 400;

/**
 * THE AUDITED EXEMPTION LIST. Every reference site where a public export names a
 * type a consumer cannot import, AND the consumer reaches it by a name-free
 * route anyway. Asserted for SET EQUALITY: adding a line is a deliberate act
 * that says "here is the route"; removing one without fixing the site is a
 * failure too.
 *
 * ROUTES, by group:
 *
 *   CommonOpts / ScopeFallbackOpts  (`@civitai/app-sdk/oauth`)
 *     `extends` bases of ExchangeCodeOpts / RefreshTokenOpts / RevokeTokenOpts.
 *     Members inline; `Pick<RefreshTokenOpts, 'clientId' | 'clientSecret' |
 *     'baseUrl'>` names the shared half.
 *
 *   ManifestSettingFieldBase  (`@civitai/app-sdk/blocks`)
 *     `extends` base of the three ManifestSettingField arms. Members inline;
 *     `Omit<ManifestBooleanField, 'type' | 'widget' | 'default'>` is the base.
 *
 *   FieldBaseProps  (`@civitai/components-react`)
 *     `extends` base of the seven labeled-input prop types. Members inline;
 *     `Pick<SelectProps, 'label' | 'description' | …>` is the shared chrome.
 *     NOTE it lives in `src/internal/` — the shape #378 just moved out of
 *     `internal/` in blocks-react. Worth the same treatment; out of scope here.
 *
 *   ResourceCard{Card,Row}Props / ResourceCard{Static,Interactive}Arm
 *     (`@civitai/blocks-react/ui`) — the four arms of the exported
 *     `ResourceCardProps` union. `Extract<ResourceCardProps, { variant: 'card' }>`
 *     and `Extract<ResourceCardProps, { interactive: true }>` name them.
 *
 *   STORAGE_NAMES  (`@civitai/app-sdk/safe-storage`)
 *     A const, not a type. `SafeStorageName` already IS the resolved string
 *     literal union; there is nothing further to name.
 *
 *   StepTemplateMap / GuardPeer  (`@civitai/app-sdk/orchestrator/steps`)
 *     NON-EXPORTED BY DESIGN — see that module's own invariant and
 *     `test/orchestrator/steps-peer-guard.test.ts`, which requires exactly one
 *     `GuardPeer` on each exported alias's path and would go blind if the raw
 *     map were guarded (i.e. exported) too. `keyof WorkflowStepTemplates` is
 *     `keyof StepTemplateMap`; `WorkflowStepTemplateFor<K>` is a row.
 *
 *   PickerOverlayHandle  (`@civitai/blocks-react/live`)
 *     The parameter of `LiveHostOptions.onPickerReady`, a CALLBACK — the
 *     consumer writes `(handle) => …` and `handle` is contextually typed;
 *     storing it is `Parameters<NonNullable<LiveHostOptions['onPickerReady']>>[0]`.
 *     Exporting it would drag `CatalogCard` (its `cards` member) onto the
 *     `/live` surface too, and `/live` is the dev-harness-only subpath whose
 *     stated rule is to stay at exactly what a `dev:live` harness needs.
 */
const LEDGER = [
  '@civitai/app-sdk#ExchangeCodeOpts :: extends :: CommonOpts',
  '@civitai/app-sdk#ExchangeCodeOpts :: extends :: ScopeFallbackOpts',
  '@civitai/app-sdk#RefreshTokenOpts :: extends :: CommonOpts',
  '@civitai/app-sdk#RefreshTokenOpts :: extends :: ScopeFallbackOpts',
  '@civitai/app-sdk#RevokeTokenOpts :: extends :: CommonOpts',
  '@civitai/app-sdk/blocks#ManifestBooleanField :: extends :: ManifestSettingFieldBase',
  '@civitai/app-sdk/blocks#ManifestNumberField :: extends :: ManifestSettingFieldBase',
  '@civitai/app-sdk/blocks#ManifestStringField :: extends :: ManifestSettingFieldBase',
  '@civitai/app-sdk/blocks#SafeStorageName :: alias-rhs :: STORAGE_NAMES',
  '@civitai/app-sdk/oauth#ExchangeCodeOpts :: extends :: CommonOpts',
  '@civitai/app-sdk/oauth#ExchangeCodeOpts :: extends :: ScopeFallbackOpts',
  '@civitai/app-sdk/oauth#RefreshTokenOpts :: extends :: CommonOpts',
  '@civitai/app-sdk/oauth#RefreshTokenOpts :: extends :: ScopeFallbackOpts',
  '@civitai/app-sdk/oauth#RevokeTokenOpts :: extends :: CommonOpts',
  '@civitai/app-sdk/orchestrator/steps#AnyWorkflowStepTemplate :: alias-rhs :: GuardPeer',
  // `GuardPeer<StepTemplateMap[keyof StepTemplateMap]>` — named twice, once for
  // the lookup and once for the key set. The duplicate is real and the ledger
  // is a MULTISET; collapsing it would hide a count change.
  '@civitai/app-sdk/orchestrator/steps#AnyWorkflowStepTemplate :: alias-rhs :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#AnyWorkflowStepTemplate :: alias-rhs :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#TypedWorkflowTemplate :: alias-rhs :: GuardPeer',
  '@civitai/app-sdk/orchestrator/steps#TypedWorkflowTemplate :: property :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#TypedWorkflowTemplate :: property :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepInputFor :: alias-rhs :: GuardPeer',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepInputFor :: alias-rhs :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepInputFor :: type-param-constraint :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepTemplateFor :: alias-rhs :: GuardPeer',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepTemplateFor :: alias-rhs :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepTemplateFor :: type-param-constraint :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepTemplates :: alias-rhs :: GuardPeer',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepTemplates :: alias-rhs :: StepTemplateMap',
  '@civitai/app-sdk/orchestrator/steps#WorkflowStepTemplates :: type-param-constraint :: StepTemplateMap',
  '@civitai/app-sdk/safe-storage#SafeStorageName :: alias-rhs :: STORAGE_NAMES',
  '@civitai/blocks-react/live#LiveHostOptions :: callback-parameter :: PickerOverlayHandle',
  '@civitai/blocks-react/ui#ResourceCardProps :: alias-rhs :: ResourceCardCardProps',
  '@civitai/blocks-react/ui#ResourceCardProps :: alias-rhs :: ResourceCardCardProps',
  '@civitai/blocks-react/ui#ResourceCardProps :: alias-rhs :: ResourceCardInteractiveArm',
  '@civitai/blocks-react/ui#ResourceCardProps :: alias-rhs :: ResourceCardInteractiveArm',
  '@civitai/blocks-react/ui#ResourceCardProps :: alias-rhs :: ResourceCardRowProps',
  '@civitai/blocks-react/ui#ResourceCardProps :: alias-rhs :: ResourceCardRowProps',
  '@civitai/blocks-react/ui#ResourceCardProps :: alias-rhs :: ResourceCardStaticArm',
  '@civitai/blocks-react/ui#ResourceCardProps :: alias-rhs :: ResourceCardStaticArm',
  '@civitai/components-react#CheckboxProps :: extends :: FieldBaseProps',
  '@civitai/components-react#NumberInputProps :: extends :: FieldBaseProps',
  '@civitai/components-react#RadioProps :: extends :: FieldBaseProps',
  '@civitai/components-react#SliderProps :: extends :: FieldBaseProps',
  '@civitai/components-react#SelectProps :: extends :: FieldBaseProps',
  '@civitai/components-react#TextInputProps :: extends :: FieldBaseProps',
  '@civitai/components-react#TextareaProps :: extends :: FieldBaseProps',

  // ------------------------------------------------------------------------
  // `@civitai/components` custom elements (#415). Two routes, both name-free,
  // both in positions this guard exempts — no nameable-position site is listed
  // here, so none of these bases needs exporting.
  //
  //   extends   — a base class's members INLINE into the derived element's
  //               declared type. A consumer writes `CivitaiTextInput` and gets
  //               every `CivitaiField` member without naming `CivitaiField`;
  //               `CivitaiMediaElement` likewise for image, video and audio;
  //               `HTMLElementBase` likewise for the plain elements. Same shape
  //               as the `ManifestSettingFieldBase` rows above.
  //   property  — reachable by indexed access on the owning element:
  //               `CivitaiSignInButton['transport']`, `['signIn']`, and
  //               `CivitaiConfirmDialog['styles']`. The consumer never writes
  //               `BlockTransport`, `SignIn` or `CivitaiModal` itself.
  //
  // 🔴 ACCEPTED, not fixed — an operator decision (2026-09-22) to ship #415
  // without a round of export-surface changes. Recorded rather than waived: the
  // set equality still fails on GROW, so a base appearing in a return type or a
  // function parameter — the positions that genuinely cost a consumer — breaks
  // this guard rather than sliding under these lines.
  // ------------------------------------------------------------------------
  '@civitai/components/civitai-audio#CivitaiAudio :: extends :: CivitaiMediaElement',
  '@civitai/components/civitai-button-group#CivitaiButtonGroup :: extends :: HTMLElementBase',
  '@civitai/components/civitai-checkbox#CivitaiCheckbox :: extends :: CivitaiField',
  '@civitai/components/civitai-confirm-dialog#CivitaiConfirmDialog :: property :: CivitaiModal.styles',
  '@civitai/components/civitai-image#CivitaiImage :: extends :: CivitaiMediaElement',
  '@civitai/components/civitai-input-group#CivitaiInputGroup :: extends :: HTMLElementBase',
  '@civitai/components/civitai-number-input#CivitaiNumberInput :: extends :: CivitaiField',
  '@civitai/components/civitai-radio-group#CivitaiRadioGroup :: extends :: CivitaiField',
  '@civitai/components/civitai-segmented-control#CivitaiSegmentedControl :: extends :: CivitaiField',
  '@civitai/components/civitai-select#CivitaiSelect :: extends :: CivitaiField',
  // `AppClient` and `WorkflowTemplate` reach a consumer from `@civitai/sdk`,
  // the optional peer this element needs anyway; the element's own `phase` type
  // IS exported beside it.
  '@civitai/components/civitai-workflow-button#CivitaiWorkflowButton :: property :: AppClient',
  '@civitai/components/civitai-workflow-button#CivitaiWorkflowButton :: property :: WorkflowTemplate',
  '@civitai/components/civitai-sign-in-button#CivitaiSignInButton :: property :: BlockTransport',
  '@civitai/components/civitai-sign-in-button#CivitaiSignInButton :: property :: SignIn',
  '@civitai/components/civitai-slider#CivitaiSlider :: extends :: CivitaiField',
  '@civitai/components/civitai-table#CivitaiTable :: extends :: HTMLElementBase',
  '@civitai/components/civitai-tabs#CivitaiTabPanel :: extends :: HTMLElementBase',
  '@civitai/components/civitai-tabs#CivitaiTabs :: extends :: HTMLElementBase',
  '@civitai/components/civitai-textarea#CivitaiTextarea :: extends :: CivitaiField',
  '@civitai/components/civitai-text-input#CivitaiTextInput :: extends :: CivitaiField',
  '@civitai/components/civitai-toast-region#CivitaiToastRegion :: extends :: HTMLElementBase',
  '@civitai/components/civitai-tooltip#CivitaiTooltip :: extends :: HTMLElementBase',
  '@civitai/components/civitai-video#CivitaiVideo :: extends :: CivitaiMediaElement',
];

function loadTypeScript() {
  try {
    const req = createRequire(join(REPO_ROOT, 'packages/civitai-app-sdk/package.json'));
    return req('typescript');
  } catch (err) {
    fail(
      'cannot resolve `typescript` from packages/civitai-app-sdk.\n' +
        'This guard needs the workspace install. Run `pnpm install` first.\n' +
        `  underlying: ${err?.message ?? err}`,
    );
  }
}

function fail(message) {
  console.error(`\n❌ check:public-types — ${message}\n`);
  process.exit(1);
}

const countStars = (s) => s.split('*').length - 1;

/**
 * A subpath pattern is a RELATIONSHIP between the exports KEY and its TARGET,
 * and Node requires exactly one `*` in each: the key's `*` is what the target's
 * `*` is substituted from. So validate the pair, in one place, before either
 * half is used.
 *
 * 🔴 The first revision of this checked only the TARGET, and that is a guard
 * whose comment claimed a relationship while the code inspected one side.
 * CodeQL's `js/incomplete-sanitization` caught the consequence on PR #433:
 * `subpath.replace('*', star)` rewrites only the FIRST match, so an unvalidated
 * key went wrong two silent ways —
 *
 *   key `./a*\/b*` + one-`*` target: the second `*` survives into the label and
 *     the entry is reported under a subpath no consumer can import;
 *   key `./elements` + one-`*` target: `replace` is a NO-OP, so every expanded
 *     file gets the IDENTICAL label — N entries collapse to one name and a
 *     finding cannot be traced back to the file it came from.
 *
 * Both are REFUSED rather than repaired. A manifest in either shape is invalid
 * to Node too, and guessing which half the author meant is how a guard starts
 * lying about what it scanned.
 */
function assertPatternPair(subpath, dts) {
  const keyStars = countStars(subpath);
  const dtsStars = countStars(dts);
  if (keyStars === 0 && dtsStars === 0) return false;
  if (keyStars !== 1 || dtsStars !== 1) {
    fail(
      `exports pattern \`${subpath}\` -> \`${dts}\` is not a valid subpath pattern:\n` +
        `  the key has ${keyStars} \`*\` and the target has ${dtsStars}.\n` +
        'Node requires EXACTLY ONE in each, and the key\'s `*` is what the target\n' +
        'substitutes. Refusing to guess which half is wrong.',
    );
  }
  return true;
}

/**
 * Expand ONE `exports` subpath pattern against the built tree.
 *
 * Node's `*` matches across `/`. Only a single-directory expansion is implemented
 * here because that is the only shape this repo declares; a pattern whose `*`
 * spans directories would silently match less than Node does, so it is REFUSED
 * rather than under-reported — a guard that quietly scans a subset is the failure
 * this whole script exists to avoid.
 *
 * The key/target pair is already validated by {@link assertPatternPair}, so `dts`
 * holds exactly one `*` by the time it gets here.
 *
 * Returns `[{ abs, star }]` — the resolved file, and what `*` bound to, so the
 * caller can label the entry the way a consumer would actually import it.
 */
function expandPattern(pkgDir, dts) {
  const star = dts.indexOf('*');
  const prefix = dts.slice(0, star);
  const suffix = dts.slice(star + 1);
  if (suffix.includes('/')) {
    fail(
      `exports pattern \`${dts}\` expands across directories (\`*\` before a \`/\`).\n` +
        'Only a single-directory `*` is supported here; widen expandPattern() rather\n' +
        'than let this scan a subset of what Node would resolve.',
    );
  }
  const dir = resolve(pkgDir, prefix.slice(0, prefix.lastIndexOf('/') + 1));
  if (!existsSync(dir)) return [];
  const leaf = prefix.slice(prefix.lastIndexOf('/') + 1);
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(leaf) || !name.endsWith(suffix)) continue;
    const abs = join(dir, name);
    // An empty match is as unscannable as a missing one — same reason as below.
    if (!existsSync(abs) || statSync(abs).size === 0) continue;
    out.push({ abs, star: name.slice(leaf.length, name.length - suffix.length) });
  }
  return out;
}

/** Entry points, from the REAL `exports` maps. Fails loudly on an unbuilt tree. */
function collectEntries() {
  const entries = [];
  const unbuilt = [];
  for (const dir of PACKAGES) {
    const pkgDir = join(REPO_ROOT, 'packages', dir);
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const dts = target && typeof target === 'object' ? target.types : null;
      if (!dts) continue;

      // A SUBPATH PATTERN (`"./elements/*": "./dist/elements/*.d.ts"`) names a SET,
      // not a file. `existsSync` on the literal string — `*` and all — is false for
      // every built tree there has ever been, so treating it like a plain target
      // reports UNBUILT over a directory full of `.d.ts` and the gate is red forever.
      // Measured on #415, the first PR here to declare one: `dist/elements/` held 44
      // `.d.ts` files and `index.d.ts` at 2,413 B while this said "missing or empty".
      // Expand it instead, and keep the guard's teeth — a pattern matching NOTHING is
      // exactly the unbuilt case it exists to catch, so that still fails.
      //
      // Branch on the validated PAIR, not on `dts` alone: a `*` in either half
      // makes this a pattern, and a `*` in only one half is a refusal. Branching
      // on the target alone would let a `*`-bearing KEY with a plain target slip
      // through as an ordinary entry and be labelled with a literal `*`.
      if (assertPatternPair(subpath, dts)) {
        const matches = expandPattern(pkgDir, dts);
        if (matches.length === 0) {
          unbuilt.push(`${manifest.name}${subpath.slice(1)} -> ${dts} (pattern matched no file)`);
          continue;
        }
        for (const m of matches) {
          entries.push({
            pkg: manifest.name,
            // `replaceAll` on a string with EXACTLY ONE `*` (assertPatternPair
            // guarantees it) — spelled so neither a reader nor a scanner has to
            // reconstruct that proof to see the substitution is total.
            label: `${manifest.name}${subpath.slice(1).replaceAll('*', m.star)}`,
            dts: m.abs,
          });
        }
        continue;
      }

      const abs = resolve(pkgDir, dts);
      if (!existsSync(abs) || statSync(abs).size === 0) {
        unbuilt.push(`${manifest.name}${subpath.slice(1)} -> ${dts}`);
        continue;
      }
      entries.push({ pkg: manifest.name, label: `${manifest.name}${subpath.slice(1)}`, dts: abs });
    }
  }
  if (unbuilt.length > 0) {
    fail(
      'UNBUILT TREE — these declared `exports` targets are missing or empty:\n' +
        unbuilt.map((u) => `  ${u}`).join('\n') +
        '\n\nRun `pnpm -r --filter "./packages/*" build` first. Refusing to report\n' +
        '"0 violations" over a tree that was never scanned.',
    );
  }
  if (entries.length === 0) fail('no entry points found — every `exports` map lacks a `types` target.');
  return entries;
}

// --------------------------------------------------------------------------
// Controls
// --------------------------------------------------------------------------

/**
 * 🔴 THE TRAILING `export {};` IS LOAD-BEARING, AND IT IS WHAT tsc REALLY EMITS.
 * In an ambient `.d.ts` WITHOUT it, every top-level declaration is exported from
 * the module — so a fixture spelled the obvious way reports ZERO violations and
 * the negative control passes vacuously. MEASURED: the first revision of this
 * fixture did exactly that (`getExportsOfModule` returned all six names,
 * findings `[]`). `tsc` appends the marker to precisely the files that have a
 * non-exported top-level declaration — 10 of the 151 `dist/*.d.ts` at the time
 * of writing, and every one of the real sites on {@link LEDGER} lives in one of
 * those 10. The fixture has to be built the way the compiler really emits, not
 * the way a textbook example is written.
 */
const FIXTURE_UNEXPORTED = `
interface HiddenRow { id: number; }
interface HiddenResult { rows: HiddenRow[]; }
interface HiddenBase { shared: string; }
export interface Derived extends HiddenBase { own: number; }
export declare function readAll(): HiddenResult;
export declare function writeOne(row: HiddenRow): void;
export {};
`;

const FIXTURE_EXPORTED = `
export interface HiddenRow { id: number; }
export interface HiddenResult { rows: HiddenRow[]; }
export interface HiddenBase { shared: string; }
export interface Derived extends HiddenBase { own: number; }
export declare function readAll(): HiddenResult;
export declare function writeOne(row: HiddenRow): void;
export {};
`;

function selfTest(ts) {
  const dir = mkdtempSync(join(tmpdir(), 'public-type-closure-'));
  const bad = join(dir, 'unexported.d.ts');
  const good = join(dir, 'exported.d.ts');
  writeFileSync(bad, FIXTURE_UNEXPORTED);
  writeFileSync(good, FIXTURE_EXPORTED);

  const run = (dts) =>
    scanEntries({ ts, entries: [{ pkg: 'fixture', label: 'fixture', dts }], isFirstParty: () => true });

  // NEGATIVE CONTROL — #379's own wording: a deliberately unexported type. The
  // scanner MUST see it, in the right position, by name.
  const badRun = run(bad);
  const badHard = badRun.findings.filter((f) => NAMEABLE_POSITIONS.includes(f.position));
  const badNames = badHard.map(ledgerLine).sort();
  const expectedHard = [
    'fixture#readAll :: return-type :: HiddenResult',
    'fixture#writeOne :: parameter :: HiddenRow',
  ];
  if (JSON.stringify(badNames) !== JSON.stringify(expectedHard)) {
    fail(
      'SELF-TEST FAILED (negative control). The scanner did not report the ' +
        'deliberately unexported types.\n' +
        `  expected: ${JSON.stringify(expectedHard, null, 2)}\n` +
        `  actual:   ${JSON.stringify(badNames, null, 2)}`,
    );
  }
  const badExtends = badRun.findings.filter((f) => f.position === 'extends').map(ledgerLine);
  if (JSON.stringify(badExtends) !== JSON.stringify(['fixture#Derived :: extends :: HiddenBase'])) {
    fail(
      'SELF-TEST FAILED (position classifier). An `extends` base was not classified ' +
        `as 'extends': ${JSON.stringify(badExtends)}`,
    );
  }

  // POSITIVE CONTROL — the same shapes, exported. Zero violations, but only
  // believable because the walker demonstrably walked something.
  const goodRun = run(good);
  if (goodRun.findings.length !== 0) {
    fail(
      'SELF-TEST FAILED (positive control). An all-exported fixture reported ' +
        `${goodRun.findings.length} violation(s): ${goodRun.findings.map(ledgerLine).join(', ')}`,
    );
  }
  if (goodRun.stats.referenceNodes === 0) {
    fail(
      'SELF-TEST FAILED. The clean fixture reported 0 violations AND walked 0 type ' +
        'references — a scanner wired to nothing looks exactly like a clean tree.',
    );
  }

  console.log('check:public-types --self-test');
  console.log(
    `  NEGATIVE CONTROL  ${badHard.length} nameable-position violation(s) reported on the ` +
      `unexported fixture: ${badNames.join(' | ')}`,
  );
  console.log(
    `  POSITIVE CONTROL  ${goodRun.findings.length} violation(s) on the exported fixture, ` +
      `over ${goodRun.stats.referenceNodes} walked type reference(s)`,
  );
  console.log('  ✅ the scanner can go red, and its zero is not a zero from an empty scan.');
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

const ts = loadTypeScript();

if (process.argv.includes('--self-test')) {
  selfTest(ts);
  process.exit(0);
}

const entries = collectEntries();
const { findings, stats } = scanEntries({ ts, entries, rel: `${REPO_ROOT}/` });

if (stats.exportedSymbols < MIN_EXPORTED_SYMBOLS) {
  fail(
    `only ${stats.exportedSymbols} exported symbol(s) across ${entries.length} entries ` +
      `(floor ${MIN_EXPORTED_SYMBOLS}). The tree looks unbuilt or half-built; a zero here ` +
      'would mean nothing. Run `pnpm -r --filter "./packages/*" build`.',
  );
}
if (stats.referenceNodes < MIN_REFERENCE_NODES) {
  fail(
    `walked only ${stats.referenceNodes} type reference(s) (floor ${MIN_REFERENCE_NODES}). ` +
      'Refusing to report a clean scan over nothing.',
  );
}

const hard = findings.filter((f) => NAMEABLE_POSITIONS.includes(f.position));
const ledgered = findings.filter((f) => !NAMEABLE_POSITIONS.includes(f.position));

const byPosition = new Map();
for (const f of findings) byPosition.set(f.position, (byPosition.get(f.position) ?? 0) + 1);

console.log(`check:public-types — ${entries.length} built entries, ${stats.exportedSymbols} exported symbols`);
console.log(
  `  walked ${stats.referenceNodes} type reference(s): ` +
    `${stats.libDeclared} lib, ${stats.thirdParty} third-party, ${stats.typeParameters} type params, ` +
    `${stats.firstParty} first-party (${stats.firstPartyNameable} nameable)`,
);
console.log(`  ${findings.length} reference(s) to a type no public entry exports:`);
for (const [position, count] of [...byPosition].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(count).padStart(3)}  ${position}`);
}

let failed = false;

if (hard.length > 0) {
  console.error(
    `\n❌ ${hard.length} public export(s) reference a non-exported type in a NAMEABLE POSITION.\n` +
      'A consumer must produce or store a value of these types and has no name to write.\n' +
      'Export the type from the package entry (or restate the signature in already-exported terms):\n',
  );
  for (const f of hard) {
    console.error(`  ${ledgerLine(f)}\n      declared in ${f.declaredIn}`);
  }
  failed = true;
}

const actualLedger = ledgered.map(ledgerLine).sort();
const expectedLedger = [...LEDGER].sort();
if (JSON.stringify(actualLedger) !== JSON.stringify(expectedLedger)) {
  // MULTISET diff, not a set diff. Several ledger lines legitimately repeat —
  // `ResourceCardProps` names each of its four arms twice, once per union arm
  // it appears in — and a set-based diff reports NOTHING when only the COUNT
  // moves, which is a guard that fails without saying why. (Measured: the first
  // revision of this file did exactly that.)
  const tally = (list) => {
    const m = new Map();
    for (const l of list) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const have = tally(actualLedger);
  const want = tally(expectedLedger);
  const surplus = [];
  const missing = [];
  for (const line of new Set([...have.keys(), ...want.keys()])) {
    const h = have.get(line) ?? 0;
    const w = want.get(line) ?? 0;
    if (h > w) surplus.push(`${line}${w === 0 ? '' : `   (x${h}, ledger has x${w})`}`);
    if (w > h) missing.push(`${line}${h === 0 ? '' : `   (x${h}, ledger has x${w})`}`);
  }
  surplus.sort();
  missing.sort();
  console.error(
    `\n❌ the EXEMPTION LEDGER no longer matches the tree ` +
      `(${actualLedger.length} found, ${expectedLedger.length} recorded).\n`,
  );
  if (surplus.length > 0) {
    console.error(
      'NEW exempt-position references (an exported declaration now names a type a\n' +
        'consumer cannot import). Either export the type, or add the line to LEDGER in\n' +
        'scripts/check-public-type-closure.mjs AND write down the name-free route a\n' +
        'consumer takes to it:\n',
    );
    for (const l of surplus) console.error(`  + ${l}`);
  }
  if (missing.length > 0) {
    console.error(
      '\nLEDGER lines with nothing behind them. If you exported the type or deleted the\n' +
        'export, delete the line too — a stale exemption is an exemption nobody reviews:\n',
    );
    for (const l of missing) console.error(`  - ${l}`);
  }
  failed = true;
}

if (failed) process.exit(1);

console.log(
  `\n✅ 0 in a nameable position; ${ledgered.length} on the audited exemption ledger ` +
    `(exact set match).`,
);
