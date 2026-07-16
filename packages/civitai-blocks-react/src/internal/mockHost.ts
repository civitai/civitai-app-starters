/**
 * `createMockHost` — a framework-agnostic, test-and-dev-only fake of the
 * civitai.com embedding host.
 *
 * The real host (civitai/civitai `IframeHost.tsx` / `PageBlockHost.tsx`) mounts
 * a block in a cross-origin iframe and answers its `postMessage` protocol:
 * mints a token, runs the lazy-consent round-trip, brokers the orchestrator
 * money path (estimate → submit → poll), opens the native Buzz-purchase and
 * resource-picker modals, and serves the App-Blocks KV datastore. Locally — in
 * a `vitest` test OR a starter's dev harness — there is no host, so this plays
 * one.
 *
 * It is the portable core that the React `<Harness>` (a.k.a. `<MockHostProvider>`
 * in `../testing`) wraps. Every block app used to hand-roll ~250 lines of this;
 * now they configure it with {@link MockHostOptions} instead.
 *
 * Mechanism (mirrors the gen-matrix reference Harness):
 *  1. Patches `window.parent.postMessage` via `Object.defineProperty(window,
 *     'parent', …)` so the block's OUTBOUND messages are intercepted.
 *  2. Replies as `MessageEvent`s fired from `window.location.origin` — the SDK
 *     `IframeTransport` DROPS any inbound message whose `origin` ≠ the allowed
 *     parent origin, so a block using this in dev MUST allow
 *     `window.location.origin` (the React `<Harness>` is documented for that).
 *  3. Dispatches a configurable `BLOCK_INIT`, then answers the full protocol.
 *
 * SCENARIOS (Layer 1 of the local-dev DX): the {@link MockHostOptions.generation},
 * {@link MockHostOptions.buzz}, and {@link MockHostOptions.storage} groups let a
 * dev simulate REAL costs, slow gens, FAILURES, an insufficient-Buzz balance,
 * and a working KV store with a quota — entirely synthetically, so the full
 * money / error / storage UX is exercisable locally without spending a single
 * Buzz or touching the network. The returned {@link MockHost} exposes
 * `setScenario()` + a `buzz` handle so a harness UI can flip scenarios
 * mid-session.
 *
 * PURE + SYNTHETIC: NOT a real RS256 JWT, NO real Buzz, NO orchestrator, and
 * — asserted by the test suite — NO network (`fetch`/`XMLHttpRequest` are never
 * called). Only the postMessage bridge round-trips are exercised. Never import
 * this from production code.
 */

import {
  BrowsingLevel,
  SFW_LEVELS,
  type BlockContext,
  type BlockInitPayload,
  type BlockResourceInfo,
  type BlockResourcePickerType,
  type BlockUploadedImageInfo,
  type BlockGenerationSourceImageInfo,
  type BlockImageScanResult,
  type BuzzAccountType,
  type BlockBuzzTransaction,
  type BlockBuzzAccount,
  type BlockDailyCompensationResource,
  type BlockViewer,
  type BlockWildcardPack,
  type BlockWildcardPackErrorCode,
  type ColorDomain,
  type SharedStorageValue,
  type Theme,
  type ViewerInfo,
  type WorkflowBody,
  type WrappedToken,
} from '@civitai/app-sdk/blocks';

/** The full all-levels ceiling a `red` domain projects (mirrors the server). */
const ALL_LEVELS =
  BrowsingLevel.PG |
  BrowsingLevel.PG13 |
  BrowsingLevel.R |
  BrowsingLevel.X |
  BrowsingLevel.XXX;

const DEV_TOKEN = 'dev.mockhost.mock.jwt.NOT.A.REAL.RS256';
const BUDGETED_SCOPE = 'ai:write:budgeted';

/** v0 host storage ceilings (mirror civitai/civitai's APP_STORAGE limits). */
const DEFAULT_STORAGE_QUOTA_BYTES = 50 * 1024 * 1024; // 50 MB per app
const DEFAULT_STORAGE_VALUE_CAP_BYTES = 64 * 1024; // 64 KB per value
const DEFAULT_STORAGE_LIMIT_ROWS = 1_000_000;

/**
 * How submits resolve. `'none'` = everything succeeds; `'all'` /
 * `'insufficient'` = every submit returns an insufficient-Buzz `failed`
 * snapshot (exercises the per-cell Top-Up CTA); `'some'` = ~1 in 3 submits
 * fail (a mixed grid).
 */
export type MockHostFailMode = 'none' | 'some' | 'all' | 'insufficient';

/**
 * A canned resource the mock host "returns" from `OPEN_RESOURCE_PICKER`.
 * Mirrors the host's narrow `BlockResourceInfo` projection (versionId/modelId/
 * names/baseModel/modelType). Returning `undefined`/`null` simulates a
 * user-dismissed picker (→ `RESOURCE_PICKER_RESULT` with no `selected`).
 */
export type CannedPick = BlockResourceInfo;

/**
 * The canned ASYNC scan verdict the mock host streams (on `IMAGE_SCAN_RESOLVED`)
 * after early-resolving an `asyncScan:true` display upload. Mirrors the three
 * {@link BlockImageScanResult} outcomes:
 *  - `'scanned'` (default) — clean; the verdict carries the moderated image
 *    projection (reuses {@link MockHostOptions.cannedImageUpload}).
 *  - `{ status:'blocked'; reason? }` — terminal non-clean; NO usable image.
 *  - `'error'` — transient/host-side error (retryable); NO usable image.
 */
export type MockCannedImageScan =
  | 'scanned'
  | { status: 'blocked'; reason?: string }
  | 'error';

/**
 * A per-generation cost: a fixed number, or a function of the submitted
 * {@link WorkflowBody} (so a dev can vary cost by model / step count).
 */
export type CostSpec = number | ((req: WorkflowBody) => number);

/**
 * A result image url: a fixed string, or a function of the submitted body
 * (so a dev can echo the prompt into a placeholder).
 */
export type ImageSpec = string | ((req: WorkflowBody) => string);

/**
 * GENERATION scenario controls — simulate real costs, slow gens, and failures
 * on the orchestrator money path WITHOUT a real orchestrator. All optional.
 */
export interface MockGenerationScenario {
  /**
   * Cost reported on `ESTIMATE_RESULT` + the succeeded snapshot. A number, or
   * a `(body) => number`. Overrides the legacy top-level `cost`. Default `8`.
   */
  costPerGen?: CostSpec;
  /**
   * Synthetic latency before the SUBMITTED→succeeded transition lands, in ms.
   * A single number, or a `[min, max]` range (uniform random). Applied to the
   * poll that flips a workflow to `succeeded`. Default `0` (immediate).
   */
  latencyMs?: number | [number, number];
  /**
   * Probability (0..1) that any given submit fails with a generic generation
   * error. Independent of {@link failRate}'s sibling controls. Default `0`.
   */
  failRate?: number;
  /**
   * Force the next N submits to fail (counts down). Deterministic companion to
   * {@link failRate} — handy for "first try fails, retry succeeds" UX tests.
   */
  failNext?: number;
  /** A single result image url (or `(body) => url`). */
  image?: ImageSpec;
  /**
   * Multiple result image urls (or `(body) => url[]`). Takes precedence over
   * {@link image} when both are set.
   */
  images?: string[] | ((req: WorkflowBody) => string[]);
}

/**
 * BUZZ scenario controls — simulate a balance so the insufficient-Buzz / top-up
 * UX is exercisable. The mock host treats `balance` as a spendable wallet:
 * each succeeding generation DEBITS its cost; a submit whose cost would exceed
 * the remaining balance resolves to an insufficient-Buzz `failed` snapshot
 * (exercising the Top-Up CTA), and `OPEN_BUZZ_PURCHASE` REFILLS the balance.
 */
export interface MockBuzzScenario {
  /**
   * Simulated spendable balance. When set, generations debit against it and a
   * gen that would exceed it returns an insufficient-Buzz outcome. When
   * `undefined`, balance is NOT simulated (back-compat: only the legacy
   * `failMode` drives insufficiency).
   */
  balance?: number;
  /**
   * Force every submit down the insufficient-Buzz path regardless of balance.
   * Equivalent to the legacy `failMode: 'insufficient'`; provided here so the
   * insufficient UX is reachable from the `buzz` group alone.
   */
  insufficient?: boolean;
}

/**
 * Per-pool Buzz wallet the mock host reports on `GET_BUZZ_BALANCE`. Mirrors the
 * SDK `BuzzBalance` / block-side `isValidBuzzBalanceResult` shape (each a finite
 * number; never the platform-internal `red`/`purple` pools).
 */
export interface MockBuzzBalance {
  blue: number;
  green: number;
  yellow: number;
}

/**
 * STORAGE scenario controls — drive the in-memory KV backend that answers the
 * `APP_STORAGE_*` protocol, so the W4 KV apps (e.g. Prompt Library) can test
 * load / quota / error states against `createMockHost` directly instead of
 * hand-injecting a fake store.
 */
export interface MockStorageScenario {
  /**
   * Initial KV contents (key → JSON value) the store is seeded with. `get`
   * returns these immediately; they count against the simulated quota.
   */
  seed?: Record<string, unknown>;
  /**
   * Simulated per-app quota in bytes. A `set` that would cross it resolves
   * `{ ok: false, error: 'PAYLOAD_TOO_LARGE' }` (the host doesn't leak which
   * cap tripped). Default 50 MB.
   */
  quotaBytes?: number;
  /**
   * Per-value byte cap. A `set` whose serialized value exceeds it resolves
   * `{ ok: false, error: 'PAYLOAD_TOO_LARGE' }`. Default 64 KB.
   */
  valueCapBytes?: number;
  /** Simulated row ceiling reported by `getQuota`. Default 1,000,000. */
  limitRows?: number;
  /**
   * Force the next N storage MUTATIONS (`set`/`delete`) to fail with a generic
   * `STORAGE_UNAVAILABLE` error (counts down) — exercises the error UX.
   */
  failNext?: number;
}

/**
 * A seed entry for the in-memory SHARED store. `value` is the contributed
 * `{ title, body? }` record; `authorUserId` defaults to the viewer's id;
 * `voters` seeds the set of user-ids who've up-voted it (so `count` and the
 * per-user one-vote invariant start populated). Newest seeds list first.
 */
export interface MockSharedSeed {
  value: SharedStorageValue;
  authorUserId?: number;
  voters?: number[];
}

/**
 * SHARED-storage scenario controls — drive the in-memory, app-scoped, votable
 * backend that answers the `SHARED_*` protocol, so App-Blocks SHARED apps can
 * develop/test against `createMockHost` directly. Sibling of
 * {@link MockStorageScenario}.
 */
export interface MockSharedScenario {
  /** Initial entries the store is seeded with (listed newest-first, in order). */
  seed?: MockSharedSeed[];
  /**
   * Force the next N SHARED mutations (`append`/`vote`/`unvote`/`withdraw`) to
   * fail with a generic `SHARED_UNAVAILABLE` error (counts down) — exercises the
   * error UX.
   */
  failNext?: number;
}

/**
 * Drives `createMockHost`. Every field is optional with a sensible default so
 * `createMockHost()` works out of the box. Each block configures SCENARIOS
 * here instead of forking the host code.
 *
 * Backward-compatible: the legacy top-level `cost`/`failMode`/`buzzBudget`/
 * `pollsUntilDone` knobs still work. When BOTH a legacy knob and its scenario
 * equivalent are set, the SCENARIO wins (it's the newer, richer control).
 */
export interface MockHostOptions {
  /**
   * The signed-in viewer, or `null` for anonymous (→ sign-in CTA). Defaults to
   * a `dev-viewer`. Pass `null` to exercise the anon path.
   */
  viewer?: ViewerInfo | null;
  /**
   * Start WITH the consent-gated `ai:write:budgeted` scope already granted. The
   * real mint WITHHOLDS it until the viewer consents, so this defaults to
   * `false` — the first token carries NO budgeted scope, and `REQUEST_CONSENT`
   * grants it + pushes a `TOKEN_REFRESH` (the lazy-consent round-trip).
   */
  consentGranted?: boolean;
  /** How submits resolve. Default `'none'` (all succeed). */
  failMode?: MockHostFailMode;
  /**
   * Canned picks keyed by requested resource type, returned from
   * `OPEN_RESOURCE_PICKER`. A `null`/absent entry simulates a dismissed picker
   * for that type. Defaults to a curated Checkpoint + LoRA pick.
   */
  cannedPicks?: Partial<Record<BlockResourcePickerType, CannedPick | null>>;
  /**
   * The canned moderated image returned from `OPEN_IMAGE_UPLOAD` when the block
   * requests `purpose:'display'` (the default) — what `useImageUpload().open()`
   * resolves with. `null` simulates a dismissed upload modal (→
   * `IMAGE_UPLOAD_RESULT` with no `selected`). Absent → {@link DEFAULT_IMAGE_UPLOAD}
   * (a plausible SFW Civitai-hosted image).
   */
  cannedImageUpload?: BlockUploadedImageInfo | null;
  /**
   * The canned source image returned from `OPEN_IMAGE_UPLOAD` when the block
   * requests `purpose:'generationSource'` — what
   * `useImageUpload({ purpose:'generationSource' }).open()` resolves with. The
   * UNSCANNED private img2img shape `{ url, width, height }`. `null` simulates a
   * dismissed modal (→ no `selected`). Absent →
   * {@link DEFAULT_GENERATION_SOURCE_UPLOAD}.
   */
  cannedGenerationSourceUpload?: BlockGenerationSourceImageInfo | null;
  /**
   * The canned ASYNC scan verdict streamed on `IMAGE_SCAN_RESOLVED` after an
   * `asyncScan:true` display upload early-resolves (what
   * `useImageUpload({ asyncScan: true }).scanStatus()` resolves with). Default
   * `'scanned'` (the `'scanned'` verdict reuses {@link cannedImageUpload} for its
   * moderated image projection). Set `{ status:'blocked', reason }` or `'error'`
   * to exercise the terminal-blocked / retryable-error UX. Only applies to the
   * `asyncScan` path — the blocking display + generationSource paths are
   * unaffected. Live-tunable via {@link MockHost.setScenario}.
   */
  cannedImageScan?: MockCannedImageScan;
  /** Number of `POLL_WORKFLOW` round-trips before a workflow succeeds. Default 2. */
  pollsUntilDone?: number;
  /**
   * The `cost.total` reported on estimate + succeeded snapshots. Default 8.
   * @deprecated Prefer {@link MockGenerationScenario.costPerGen} on `generation`.
   */
  cost?: number;
  /** The Buzz budget reported on a granted token. Default 200. */
  buzzBudget?: number;
  /**
   * GENERATION scenario: cost / latency / failure / result-image controls. See
   * {@link MockGenerationScenario}.
   */
  generation?: MockGenerationScenario;
  /**
   * BUZZ scenario: simulated balance + force-insufficient. See
   * {@link MockBuzzScenario}.
   */
  buzz?: MockBuzzScenario;
  /**
   * The viewer's per-pool Buzz WALLET ({ blue, green, yellow }) reported to a
   * block via the host-mediated `GET_BUZZ_BALANCE` → `BUZZ_BALANCE_RESULT`
   * bridge (what the `useBuzzBalance` hook reads). Distinct from the
   * {@link MockBuzzScenario.balance} spendable-wallet knob, which only drives
   * the insufficient-Buzz / top-up SUBMIT path — this is the displayable
   * per-pool balance. Absent → {@link DEFAULT_BUZZ_BALANCE} (a plausible
   * non-zero wallet, so a block shows a balance out of the box).
   */
  buzzBalance?: MockBuzzBalance;
  /**
   * Force `GET_BUZZ_BALANCE` to FAIL instead of returning a wallet — exercises
   * the block's balance-read error UI (what `useBuzzBalance().error` surfaces).
   * `true` → a default `'balance unavailable'` message; a string → that exact
   * message; an `Error` → its `.message`. The reply mirrors the real
   * (`createLiveHost`) error shape exactly: `BUZZ_BALANCE_RESULT` with
   * `{ requestId, error }` and NO `balance`. Absent → the balance read
   * succeeds (back-compat). Live-tunable via {@link MockHost.setScenario}.
   */
  buzzBalanceError?: boolean | string | Error;
  /**
   * The canned viewer returned to a block via the host-mediated `GET_VIEWER` →
   * `VIEWER_RESULT` bridge (what the `useViewer` hook reads). Distinct from the
   * install-time {@link MockHostOptions.viewer} (the coarse BLOCK_INIT snapshot,
   * a nullable-username `ViewerInfo`): this is the authoritative self-read shape
   * ({@link BlockViewer} — `active`/`muted` status; `username` + `buzzBudget` are
   * present-but-nullable). Absent → {@link DEFAULT_VIEWER_RESULT}. Live-tunable via
   * {@link MockHost.setScenario}.
   */
  viewerResult?: BlockViewer;
  /**
   * Force `GET_VIEWER` to FAIL instead of returning a viewer — exercises the
   * block's viewer-read error UI (what `useViewer().error` surfaces). `true` → a
   * default `'viewer unavailable'` message; a string → that exact message; an
   * `Error` → its `.message`. The reply mirrors the real (`createLiveHost`) error
   * shape exactly: `VIEWER_RESULT` with `{ requestId, error }` and NO `viewer`.
   * Absent → the viewer read succeeds (back-compat). Live-tunable via
   * {@link MockHost.setScenario}.
   */
  viewerError?: boolean | string | Error;
  /**
   * The Buzz-transaction ledger reported on `GET_BUZZ_TRANSACTIONS` (what
   * `useBuzzTransactions` reads). `transactions` mirror the host projection;
   * `cursor` (when set) drives the block's "next page" affordance. Absent →
   * {@link DEFAULT_BUZZ_TRANSACTIONS}. Live-tunable via {@link MockHost.setScenario}.
   */
  buzzTransactions?: { transactions: BlockBuzzTransaction[]; cursor?: string };
  /**
   * The all-pool balances reported on `GET_BUZZ_ACCOUNTS` (what
   * `useBuzzAccounts` reads). Absent → {@link DEFAULT_BUZZ_ACCOUNTS}.
   */
  buzzAccounts?: BlockBuzzAccount[];
  /**
   * The per-modelVersion compensation reported on `GET_DAILY_COMPENSATION` (what
   * `useDailyCompensation` reads). Absent → {@link DEFAULT_DAILY_COMPENSATION}.
   */
  dailyCompensation?: {
    resources: BlockDailyCompensationResource[];
    hasPublishedResources: boolean;
  };
  /**
   * Force the three buzz SELF-READ bridges (`GET_BUZZ_TRANSACTIONS` /
   * `GET_BUZZ_ACCOUNTS` / `GET_DAILY_COMPENSATION`) to reply with the FREE-TEXT
   * `error` variant instead of data — exercises those hooks' error UI. `true` →
   * a default message; a string → that message; an `Error` → its `.message`.
   * Absent → the reads succeed. Live-tunable via {@link MockHost.setScenario}.
   */
  buzzReadError?: boolean | string | Error;
  /**
   * The parsed pack returned from `GET_WILDCARD_PACK` (what `useWildcardPack`
   * reads). Absent → {@link DEFAULT_WILDCARD_PACK}. Ignored when
   * {@link wildcardPackError} is set.
   */
  wildcardPack?: BlockWildcardPack;
  /**
   * Force `GET_WILDCARD_PACK` to reply with the DISCRIMINATED `error` code
   * (`not-found` | `forbidden` | `too-large` | `parse-failed` | `busy`) instead
   * of a pack — exercises `useWildcardPack`'s typed-error UI. Absent → a pack is
   * returned. Live-tunable via {@link MockHost.setScenario}.
   */
  wildcardPackError?: BlockWildcardPackErrorCode;
  /**
   * Buzz pools a `SUBMIT_WORKFLOW` must REJECT when named in `body.accountType`
   * — simulates the real backend's content-rating clamp. The real host throws a
   * `BAD_REQUEST` at the currency-resolution boundary (before any spend) when a
   * block picks a pool the app's maturity policy disallows; the mock mirrors
   * that: a submit whose `accountType` is in this set resolves to a `failed`
   * snapshot carrying {@link disallowedAccountError}'s message (checked BEFORE
   * the insufficient-Buzz / generic-failure paths, matching the real ordering).
   * Absent/empty → any pool is accepted (back-compat). Live-tunable via
   * {@link MockHost.setScenario}.
   */
  disallowedAccountTypes?: BuzzAccountType[];
  /**
   * STORAGE scenario: in-memory KV backend (seed / quota / failNext). See
   * {@link MockStorageScenario}. When omitted, the store starts EMPTY with the
   * v0 defaults — `APP_STORAGE_*` is answered either way (the mock host always
   * serves storage now).
   */
  storage?: MockStorageScenario;
  /**
   * SHARED scenario: in-memory, app-scoped, votable backend (seed / failNext).
   * See {@link MockSharedScenario}. When omitted, the shared store starts EMPTY
   * — the `SHARED_*` protocol is answered either way (the mock host always
   * serves shared storage now).
   */
  shared?: MockSharedScenario;
  /** Host theme delivered in `BLOCK_INIT` + context. Default `'dark'`. */
  theme?: Theme;
  /**
   * The `BLOCK_INIT` context. Defaults to a PAGE context
   * (`{ slotId: 'app.page' }`). Pass a `ModelSlotContext` for a model-slot
   * block. `theme` is merged in from {@link MockHostOptions.theme}.
   */
  context?: BlockContext;
  /**
   * The color-domain the host projects into `BLOCK_INIT` (civitai #2670),
   * surfaced on the top-level `domain` field. When set WITHOUT an explicit
   * {@link MockHostOptions.maxBrowsingLevel}, the mock host derives a matching
   * ceiling: `green`/`blue` → SFW (`SFW_LEVELS`), `red` → all levels — so
   * `useDomainMaturity()`/`<SfwGate>` are exercisable. Omit for a host that
   * predates #2670 (neither field is emitted → the hook fail-closes to SFW).
   */
  domain?: ColorDomain;
  /**
   * The authoritative browsing-level ceiling BITMASK emitted on `BLOCK_INIT`
   * (`maxBrowsingLevel`). Overrides whatever {@link MockHostOptions.domain} /
   * {@link MockHostOptions.maturity} would derive. Use `BrowsingLevel` bits
   * from `@civitai/app-sdk/blocks` to compose one.
   */
  maxBrowsingLevel?: number;
  /**
   * Convenience for the common case: `'sfw'` → an SFW ceiling (`SFW_LEVELS`),
   * `'mature'` → an all-levels ceiling. Lower precedence than an explicit
   * {@link MockHostOptions.maxBrowsingLevel}, higher than the
   * {@link MockHostOptions.domain}-derived default.
   */
  maturity?: 'sfw' | 'mature';
  /** Identity fields delivered in `BLOCK_INIT`. Sensible dev defaults. */
  blockInstanceId?: string;
  blockId?: string;
  appId?: string;
  /**
   * Called with every intercepted OUTBOUND message (`{ type, payload }`) — the
   * React `<Harness>` uses this to render its on-screen message log. RESIZE
   * messages are included; filter them out in the callback if undesired.
   */
  onOutbound?: (msg: { type: string; payload?: unknown }) => void;
  /**
   * Override `window`. Defaults to `globalThis.window`. Tests pass happy-dom's
   * window; the dev harness uses the default.
   */
  window?: Window & typeof globalThis;
}

/**
 * The mutable slice of {@link MockHostOptions} a harness UI can flip mid-session
 * via {@link MockHost.setScenario}. (Identity/init-only fields like `viewer`,
 * `context`, `theme`, and `appId` are fixed at install time — change them by
 * re-installing.)
 */
export type MockHostScenarioPatch = Pick<
  MockHostOptions,
  | 'failMode'
  | 'cost'
  | 'pollsUntilDone'
  | 'cannedPicks'
  | 'cannedImageUpload'
  | 'cannedGenerationSourceUpload'
  | 'cannedImageScan'
  | 'generation'
  | 'buzz'
  | 'storage'
  | 'shared'
  | 'buzzBalanceError'
  | 'viewerResult'
  | 'viewerError'
  | 'buzzTransactions'
  | 'buzzAccounts'
  | 'dailyCompensation'
  | 'buzzReadError'
  | 'wildcardPack'
  | 'wildcardPackError'
  | 'disallowedAccountTypes'
>;

/** Runtime Buzz-balance handle exposed on {@link MockHost.buzz}. */
export interface MockBuzzHandle {
  /** Current simulated balance, or `undefined` when balance isn't simulated. */
  getBalance: () => number | undefined;
  /** Set (or start simulating) the balance. Pass `undefined` to stop simulating. */
  setBalance: (n: number | undefined) => void;
}

/** Handle returned by {@link createMockHost}.
 *
 * Call `install()` to patch the host in; it returns the `uninstall()` that
 * restores `window.parent` and removes timers (so the historical
 * `const uninstall = createMockHost(opts).install()` keeps working unchanged).
 *
 * After install, a harness UI can drive scenarios live:
 *  - `setScenario(patch)` — merge new generation/buzz/storage/failMode controls.
 *  - `buzz.setBalance(n)` / `buzz.getBalance()` — flip the simulated wallet.
 *
 * `install()` is idempotent — calling it twice returns the same teardown;
 * `uninstall()` is safe to call more than once. */
export interface MockHost {
  install: () => () => void;
  /** Merge a partial scenario into the live mock host (no re-install). */
  setScenario: (patch: MockHostScenarioPatch) => void;
  /** Runtime Buzz-balance control for a harness UI. */
  buzz: MockBuzzHandle;
}

// The canned picks carry the WIDENED BlockResourceInfo projection (PR-C) — the
// public recommended settings a real host now returns — so dev:mock mirrors prod
// (a picked resource seeds a weight slider + trigger words). Defaults match the
// host's `projectSafeGenerationResource` (strength 1, min -1, max 2, no clipSkip).
const DEFAULT_CHECKPOINT_PICK: CannedPick = {
  versionId: 691639,
  modelId: 618692,
  modelName: 'FLUX.1 [dev]',
  versionName: 'fp8',
  baseModel: 'Flux.1 D',
  modelType: 'Checkpoint',
  strength: 1,
  minStrength: -1,
  maxStrength: 2,
  trainedWords: [],
  clipSkip: null,
};

const DEFAULT_LORA_PICK: CannedPick = {
  versionId: 666002,
  modelId: 555002,
  modelName: 'Sinfully Stylish',
  versionName: 'v2.0',
  baseModel: 'SDXL 1.0',
  modelType: 'LORA',
  strength: 1,
  minStrength: -1,
  maxStrength: 2,
  trainedWords: ['sinfully stylish'],
  clipSkip: null,
};

/**
 * The canned image the mock host "returns" from `OPEN_IMAGE_UPLOAD`. Mirrors the
 * host's moderated {@link BlockUploadedImageInfo} projection (imageId/nsfwLevel/
 * contentRating/url). `null` simulates a user-dismissed upload modal (→
 * `IMAGE_UPLOAD_RESULT` with no `selected`). The url is a Civitai-hosted image so
 * a dev can feed it straight into a `sourceImage` (img2img) body.
 */
const DEFAULT_IMAGE_UPLOAD: BlockUploadedImageInfo = {
  imageId: 12345678,
  nsfwLevel: 1,
  contentRating: 'pg',
  url: 'https://image.civitai.com/mock/original=true/dev-upload.jpeg',
};

/**
 * The canned source image the mock host "returns" from `OPEN_IMAGE_UPLOAD` when
 * the block requested `purpose:'generationSource'`. Mirrors the host's
 * UNSCANNED {@link BlockGenerationSourceImageInfo} shape (`{ url, width, height }`
 * — no imageId/nsfwLevel). `null` simulates a user-dismissed modal. The url is a
 * Civitai-hosted image so a dev can feed it straight into a `sourceImage` body.
 */
const DEFAULT_GENERATION_SOURCE_UPLOAD: BlockGenerationSourceImageInfo = {
  url: 'https://image.civitai.com/mock/original=true/dev-generation-source.jpeg',
  width: 1024,
  height: 1024,
};

const DEFAULT_VIEWER: ViewerInfo = { id: 2, username: 'dev-viewer', status: 'active' };

const INSUFFICIENT_BUZZ_ERROR = 'Insufficient Buzz to run this generation.';
const GENERIC_GEN_ERROR = 'Generation failed (simulated).';

/** Default message for a simulated balance-read failure ({@link MockHostOptions.buzzBalanceError}). */
const DEFAULT_BUZZ_BALANCE_ERROR = 'balance unavailable';

/**
 * The error a `SUBMIT_WORKFLOW` fails with when its `body.accountType` names a
 * pool the app's content rating disallows — byte-for-byte the message the real
 * backend throws (civitai/civitai `blocks.router` `resolveBlockCurrenciesForAccount`,
 * `TRPCError` `BAD_REQUEST`) so a block's error UI can assert the same copy
 * locally. Exported for tests + block-side assertions.
 */
export function disallowedAccountError(accountType: BuzzAccountType): string {
  return `buzz account '${accountType}' is not spendable for this app's content rating`;
}

/**
 * Normalize a {@link MockHostOptions.buzzBalanceError} value to an error string
 * (or `undefined` when genuinely unset — `false`/`undefined`).
 *
 * An intentionally-EMPTY string (or an `Error` with an empty `.message`) is
 * coerced to {@link DEFAULT_BUZZ_BALANCE_ERROR} rather than treated as "unset":
 * once a caller opts into the error mode, the balance read must FAIL — a blank
 * message would otherwise silently re-enable the successful read and diverge
 * from the `Error`-with-empty-message branch. Only `false`/`undefined` disable.
 */
function normalizeBalanceError(e: boolean | string | Error | undefined): string | undefined {
  if (e === undefined || e === false) return undefined;
  if (e === true) return DEFAULT_BUZZ_BALANCE_ERROR;
  if (typeof e === 'string') return e || DEFAULT_BUZZ_BALANCE_ERROR;
  return e.message || DEFAULT_BUZZ_BALANCE_ERROR;
}

/**
 * Default viewer reported on `GET_VIEWER` when {@link MockHostOptions.viewerResult}
 * is omitted — mirrors {@link DEFAULT_VIEWER}'s id/username (the authoritative
 * self-read shape: `active` status + a plausible buzzBudget; `username`/`buzzBudget`
 * are present-but-nullable on the wire) so `useViewer()` resolves out of the box.
 */
const DEFAULT_VIEWER_RESULT: BlockViewer = {
  id: 2,
  username: 'dev-viewer',
  status: 'active',
  buzzBudget: 200,
};

/** Default message for a simulated viewer-read failure ({@link MockHostOptions.viewerError}). */
const DEFAULT_VIEWER_ERROR = 'viewer unavailable';

/** Normalize a {@link MockHostOptions.viewerError} value to an error string (or `undefined`). */
function normalizeViewerError(e: boolean | string | Error | undefined): string | undefined {
  if (e === undefined || e === false) return undefined;
  if (e === true) return DEFAULT_VIEWER_ERROR;
  if (typeof e === 'string') return e || DEFAULT_VIEWER_ERROR;
  return e.message || DEFAULT_VIEWER_ERROR;
}

/** Default message for a simulated buzz SELF-READ failure ({@link MockHostOptions.buzzReadError}). */
const DEFAULT_BUZZ_READ_ERROR = 'buzz read unavailable';

/** Normalize a {@link MockHostOptions.buzzReadError} value to an error string (or `undefined`). */
function normalizeReadError(e: boolean | string | Error | undefined): string | undefined {
  if (e === undefined || e === false) return undefined;
  if (e === true) return DEFAULT_BUZZ_READ_ERROR;
  if (typeof e === 'string') return e || DEFAULT_BUZZ_READ_ERROR;
  return e.message || DEFAULT_BUZZ_READ_ERROR;
}

/**
 * Default per-pool wallet reported on `GET_BUZZ_BALANCE` when
 * {@link MockHostOptions.buzzBalance} is omitted — a plausible non-zero balance
 * (some free/earned blue, some purchased yellow) so a block renders a real
 * balance out of the box.
 */
const DEFAULT_BUZZ_BALANCE: MockBuzzBalance = { blue: 1000, green: 0, yellow: 5000 };

/**
 * Default Buzz-transaction ledger reported on `GET_BUZZ_TRANSACTIONS`. `date`s
 * are `Date` INSTANCES (not ISO strings) to mirror the REAL host, which forwards
 * the raw tRPC `result` over structured-clone `postMessage` (see the DATE WIRE
 * CAVEAT on `BlockBuzzTransaction`). Newest-first; `externalTransactionId` nulled
 * on the purchase row exactly as the host's projection does.
 */
const DEFAULT_BUZZ_TRANSACTIONS: BlockBuzzTransaction[] = [
  {
    date: new Date('2026-07-14T12:00:00.000Z') as unknown as string,
    type: 'Tip',
    amount: 250,
    fromAccountId: 2,
    toAccountId: 5,
    fromAccountType: 'yellow',
    toAccountType: 'yellow',
    description: 'Tip on an image',
    details: { entityType: 'Image', entityId: 12345, url: '/images/12345' },
    externalTransactionId: null,
    toUser: { id: 5, username: 'creator' },
    fromUser: { id: 2, username: 'dev-viewer' },
  },
  {
    date: new Date('2026-07-10T09:30:00.000Z') as unknown as string,
    type: 'Purchase',
    amount: 5000,
    fromAccountId: 0,
    toAccountId: 2,
    fromAccountType: 'yellow',
    toAccountType: 'yellow',
    description: 'Buzz purchase',
    // Host nulls externalTransactionId on Purchase rows (processor-ref leak class).
    externalTransactionId: null,
  },
];

/** Default all-pool balances reported on `GET_BUZZ_ACCOUNTS` (spendable + payout pools). */
const DEFAULT_BUZZ_ACCOUNTS: BlockBuzzAccount[] = [
  { accountType: 'yellow', balance: 5000 },
  { accountType: 'blue', balance: 1000 },
  { accountType: 'green', balance: 0 },
  { accountType: 'creatorProgramBank', balance: 0 },
  { accountType: 'cashSettled', balance: 1234 },
];

/** Default per-modelVersion compensation reported on `GET_DAILY_COMPENSATION`. */
const DEFAULT_DAILY_COMPENSATION: {
  resources: BlockDailyCompensationResource[];
  hasPublishedResources: boolean;
} = {
  resources: [
    {
      id: 691639,
      name: 'fp8',
      modelName: 'FLUX.1 [dev]',
      data: [
        { createdAt: '2026-07-01', total: 120 },
        { createdAt: '2026-07-02', total: 80 },
      ],
      cashData: [{ createdAt: '2026-07-01', total: 45 }],
      totalSum: 200,
      cashCents: 45,
    },
  ],
  hasPublishedResources: true,
};

/** Default parsed pack reported on `GET_WILDCARD_PACK` (a small SFW pack). */
const DEFAULT_WILDCARD_PACK: BlockWildcardPack = {
  modelId: 618692,
  modelVersionId: 691639,
  modelName: 'Sample Wildcard Pack',
  versionName: 'v1.0',
  creatorUsername: 'creator',
  lists: {
    'clothing/tops': ['t-shirt', 'hoodie', 'tank top'],
    colors: ['red', 'green', 'blue'],
  },
  truncated: false,
  truncatedLists: [],
  maturity: { browsingLevel: SFW_LEVELS, sfwOnly: true },
};

/**
 * The pool that "funded" a mock generation — the largest wallet pool, mirroring
 * the backend's primary-funder (largest-debit) stamp on
 * `BlockWorkflowSnapshot.spentAccountType`. Ties resolve to the conservative
 * free `blue` pool.
 */
function primaryFunder(balance: MockBuzzBalance): BuzzAccountType {
  const { blue, green, yellow } = balance;
  if (yellow > blue && yellow >= green) return 'yellow';
  if (green > blue && green > yellow) return 'green';
  return 'blue';
}

/** Byte size of a JSON value as the mock store would persist it. */
function jsonByteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return 0;
  }
}

/**
 * Reads the URL query toggles the gen-matrix dev harness uses, so a starter's
 * dev harness keeps working with `?viewer/?consent/?fail/?theme/?pick/?pickCkpt`.
 * Layer-1 additions: `?balance/?latency/?costPerGen/?failNext/?failRate/?seed`
 * map onto the new scenario groups so a dev can flip insufficient-buzz /
 * failures / latency without editing code.
 *
 * Returns a partial overlay applied ON TOP of explicit {@link MockHostOptions}
 * (URL wins — it's the interactive dev knob). No-op outside a browser.
 */
export function readMockHostUrlOptions(
  win: (Window & typeof globalThis) | undefined = (globalThis as { window?: Window & typeof globalThis })
    .window,
): Partial<MockHostOptions> {
  if (!win?.location?.search) return {};
  const params = new URLSearchParams(win.location.search);
  const out: Partial<MockHostOptions> = {};

  if (params.get('viewer') === 'anon') out.viewer = null;
  if (params.get('consent') === 'granted') out.consentGranted = true;

  const fail = params.get('fail');
  if (fail === 'insufficient' || fail === 'some' || fail === 'all' || fail === 'none') {
    out.failMode = fail;
  }
  if (params.get('theme') === 'light') out.theme = 'light';
  else if (params.get('theme') === 'dark') out.theme = 'dark';

  // ?domain=green|blue|red projects a color-domain (and its derived ceiling);
  // ?maturity=sfw|mature sets the ceiling directly.
  const domain = params.get('domain');
  if (domain === 'green' || domain === 'blue' || domain === 'red') out.domain = domain;
  const maturity = params.get('maturity');
  if (maturity === 'sfw' || maturity === 'mature') out.maturity = maturity;

  // ?pick (LoRA) / ?pickCkpt (Checkpoint): 'cancel' → dismissed; 'pony' → an
  // incompatible Pony LoRA; any other value → the default curated pick.
  const pick = params.get('pick');
  const pickCkpt = params.get('pickCkpt');
  if (pick || pickCkpt) {
    const cannedPicks: Partial<Record<BlockResourcePickerType, CannedPick | null>> = {};
    if (pick === 'cancel') cannedPicks.LORA = null;
    else if (pick === 'pony')
      cannedPicks.LORA = {
        versionId: 555001,
        modelId: 444001,
        modelName: 'Incompatible Pony LoRA',
        versionName: 'v1.0',
        baseModel: 'Pony',
        modelType: 'LORA',
      };
    else if (pick) cannedPicks.LORA = DEFAULT_LORA_PICK;
    if (pickCkpt === 'cancel') cannedPicks.Checkpoint = null;
    else if (pickCkpt) cannedPicks.Checkpoint = DEFAULT_CHECKPOINT_PICK;
    out.cannedPicks = cannedPicks;
  }

  // --- Layer-1 scenario toggles ---
  const generation: MockGenerationScenario = {};
  const buzz: MockBuzzScenario = {};

  const balance = params.get('balance');
  if (balance !== null && balance.trim() !== '' && Number.isFinite(Number(balance))) {
    buzz.balance = Number(balance);
  }
  if (params.get('insufficient') === '1' || params.get('insufficient') === 'true') {
    buzz.insufficient = true;
  }

  const latency = params.get('latency');
  if (latency !== null && latency.trim() !== '') {
    // ?latency=2000 or ?latency=500-2000
    const range = latency.split('-').map((s) => Number(s.trim()));
    const lo = range[0] ?? NaN;
    const hi = range[1] ?? NaN;
    if (range.length === 2 && Number.isFinite(lo) && Number.isFinite(hi)) {
      generation.latencyMs = [lo, hi];
    } else if (Number.isFinite(lo)) {
      generation.latencyMs = lo;
    }
  }

  const costPerGen = params.get('costPerGen') ?? params.get('cost');
  if (costPerGen !== null && Number.isFinite(Number(costPerGen))) {
    generation.costPerGen = Number(costPerGen);
  }

  const failNext = params.get('failNext');
  if (failNext !== null && Number.isInteger(Number(failNext))) {
    generation.failNext = Number(failNext);
  }
  const failRate = params.get('failRate');
  if (failRate !== null && Number.isFinite(Number(failRate))) {
    generation.failRate = Number(failRate);
  }

  if (Object.keys(generation).length > 0) out.generation = generation;
  if (Object.keys(buzz).length > 0) out.buzz = buzz;

  const seed = params.get('seed');
  if (seed) {
    try {
      const parsed = JSON.parse(seed) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') out.storage = { seed: parsed };
    } catch {
      /* ignore malformed ?seed= */
    }
  }

  return out;
}

/**
 * Create a framework-agnostic mock host. Call the returned `install()` to patch
 * `window.parent` + start answering the block's protocol; it returns an
 * `uninstall()` teardown (restores `window.parent`, clears timers). Safe to use
 * from a node/jsdom/happy-dom test OR a browser dev harness.
 *
 * FIDELITY CAVEAT — `spentAccountType`: on a successful gen the mock stamps the
 * PICKED pool (`body.accountType`), which equals the real backend's primary
 * realized debit only in the common FULL-COVERAGE case. The mock's
 * single-total-balance model cannot simulate split/fallback debits, so when a
 * real gen would split across pools the stamped pool may DIFFER from the
 * backend; and the mock ALWAYS stamps on success, so it cannot model the
 * no-debit / field-OMITTED case (e.g. a credits-only gen, or picking an empty
 * pool). Treat the mock stamp as an approximation, not a guarantee.
 *
 * @example
 * const host = createMockHost({ generation: { failNext: 1, latencyMs: 1500 }, buzz: { balance: 5 } });
 * const uninstall = host.install();
 * // … drive the block / assertions …
 * host.buzz.setBalance(0);       // flip to insufficient mid-session
 * host.setScenario({ generation: { failRate: 1 } });
 * uninstall();
 */
export function createMockHost(options: MockHostOptions = {}): MockHost {
  const maybeWin =
    options.window ?? (globalThis as { window?: Window & typeof globalThis }).window;
  if (!maybeWin) {
    throw new Error('createMockHost: no window available (call from a DOM environment).');
  }
  // Bind to a non-nullable local so the `install()` closure keeps the narrowing.
  const win: Window & typeof globalThis = maybeWin;

  const viewer = options.viewer === undefined ? DEFAULT_VIEWER : options.viewer;
  const buzzBudget = options.buzzBudget ?? 200;
  // Per-pool wallet reported on GET_BUZZ_BALANCE (install-time, threaded like
  // `viewer`). Defaulted so `useBuzzBalance()` resolves out of the box.
  const buzzBalance: MockBuzzBalance = options.buzzBalance ?? DEFAULT_BUZZ_BALANCE;
  const theme: Theme = options.theme ?? 'dark';
  const blockInstanceId = options.blockInstanceId ?? 'page_mock';
  const blockId = options.blockId ?? 'mock-block';
  const appId = options.appId ?? 'app_dev';

  // ---- LIVE, mutable scenario state (so setScenario / buzz.setBalance work) ----
  // Legacy + scenario knobs are merged into one mutable record; `setScenario`
  // rewrites these in place without re-installing.
  let failMode: MockHostFailMode = options.failMode ?? 'none';
  let pollsUntilDone = options.pollsUntilDone ?? 2;
  let gen: MockGenerationScenario = { ...(options.generation ?? {}) };
  let buzz: MockBuzzScenario = { ...(options.buzz ?? {}) };
  // Legacy `cost` feeds costPerGen unless the scenario set its own.
  let legacyCost = options.cost ?? 8;
  let cannedPicks: Partial<Record<BlockResourcePickerType, CannedPick | null>> =
    options.cannedPicks ?? { Checkpoint: DEFAULT_CHECKPOINT_PICK, LORA: DEFAULT_LORA_PICK };
  // Canned image-upload result. `null` = dismissed; undefined = default image.
  let cannedImageUpload: BlockUploadedImageInfo | null =
    options.cannedImageUpload === undefined ? DEFAULT_IMAGE_UPLOAD : options.cannedImageUpload;
  // Canned generationSource-upload result (purpose:'generationSource').
  let cannedGenerationSourceUpload: BlockGenerationSourceImageInfo | null =
    options.cannedGenerationSourceUpload === undefined
      ? DEFAULT_GENERATION_SOURCE_UPLOAD
      : options.cannedGenerationSourceUpload;
  // Canned async scan verdict (asyncScan:true display path). Default 'scanned'.
  let cannedImageScan: MockCannedImageScan = options.cannedImageScan ?? 'scanned';
  // Simulated balance-read failure (undefined = read succeeds).
  let buzzBalanceError: string | undefined = normalizeBalanceError(options.buzzBalanceError);
  // Canned viewer reported on GET_VIEWER + forced-error knob.
  let viewerResult: BlockViewer = options.viewerResult ?? DEFAULT_VIEWER_RESULT;
  let viewerError: string | undefined = normalizeViewerError(options.viewerError);
  // Buzz self-read bridge data + forced-error knob.
  let buzzTransactions: { transactions: BlockBuzzTransaction[]; cursor?: string } =
    options.buzzTransactions ?? { transactions: DEFAULT_BUZZ_TRANSACTIONS };
  let buzzAccounts: BlockBuzzAccount[] = options.buzzAccounts ?? DEFAULT_BUZZ_ACCOUNTS;
  let dailyCompensation: {
    resources: BlockDailyCompensationResource[];
    hasPublishedResources: boolean;
  } = options.dailyCompensation ?? DEFAULT_DAILY_COMPENSATION;
  let buzzReadError: string | undefined = normalizeReadError(options.buzzReadError);
  // Wildcard-pack bridge data + forced discriminated-error knob.
  let wildcardPack: BlockWildcardPack = options.wildcardPack ?? DEFAULT_WILDCARD_PACK;
  let wildcardPackError: BlockWildcardPackErrorCode | undefined = options.wildcardPackError;
  // Pools a submit must reject (content-rating clamp). Normalized to a Set.
  let disallowedAccounts = new Set<BuzzAccountType>(options.disallowedAccountTypes ?? []);

  // ---- Storage scenario (in-memory KV backend) ----
  const storageScenario: MockStorageScenario = { ...(options.storage ?? {}) };
  const store = new Map<string, { value: unknown; updatedAt: string }>();
  const seedNow = new Date().toISOString();
  for (const [k, v] of Object.entries(storageScenario.seed ?? {})) {
    store.set(k, { value: v, updatedAt: seedNow });
  }
  let storageFailNext = storageScenario.failNext ?? 0;
  const quotaBytes = storageScenario.quotaBytes ?? DEFAULT_STORAGE_QUOTA_BYTES;
  const valueCapBytes = storageScenario.valueCapBytes ?? DEFAULT_STORAGE_VALUE_CAP_BYTES;
  const limitRows = storageScenario.limitRows ?? DEFAULT_STORAGE_LIMIT_ROWS;

  const usedBytes = () => {
    let total = 0;
    for (const [k, row] of store) total += jsonByteSize(row.value) + k.length;
    return total;
  };

  // ---- SHARED scenario (in-memory, app-scoped, votable backend) ----
  // The "current mock user" whose identity the host injects — every SHARED
  // vote/append is attributed to it. A single-user mock, so the per-user
  // one-vote set is naturally satisfied (voting twice keeps count at 1).
  const mockUserId = viewer?.id ?? 0;
  const sharedScenario: MockSharedScenario = { ...(options.shared ?? {}) };
  interface SharedRow {
    key: string;
    seq: number;
    authorUserId: number;
    value: SharedStorageValue;
    voters: Set<number>;
    createdAt: string;
    updatedAt: string;
  }
  const sharedStore = new Map<string, SharedRow>();
  let sharedSeq = 0;
  let sharedFailNext = sharedScenario.failNext ?? 0;
  const sharedNow = new Date().toISOString();
  // Seed newest-LAST so the last-listed seed has the highest seq (newest-first).
  for (const s of sharedScenario.seed ?? []) {
    sharedSeq += 1;
    const key = `shared_${sharedSeq}`;
    sharedStore.set(key, {
      key,
      seq: sharedSeq,
      authorUserId: s.authorUserId ?? mockUserId,
      value: s.value,
      voters: new Set(s.voters ?? []),
      createdAt: sharedNow,
      updatedAt: sharedNow,
    });
  }
  const sharedItemWire = (row: SharedRow) => ({
    key: row.key,
    authorUserId: row.authorUserId,
    value: row.value,
    count: row.voters.size,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

  // Resolve a per-gen cost from the scenario (or legacy `cost`).
  const costFor = (body: WorkflowBody): number => {
    const spec: CostSpec | undefined = gen.costPerGen ?? legacyCost;
    return typeof spec === 'function' ? spec(body) : (spec ?? legacyCost);
  };

  const latencyFor = (): number => {
    const l = gen.latencyMs;
    if (l === undefined) return 0;
    if (Array.isArray(l)) {
      const [min, max] = l;
      return Math.round(min + Math.random() * Math.max(0, max - min));
    }
    return l;
  };

  const imagesFor = (workflowId: string, body: WorkflowBody): string[] => {
    if (gen.images) return typeof gen.images === 'function' ? gen.images(body) : gen.images;
    if (gen.image) return [typeof gen.image === 'function' ? gen.image(body) : gen.image];
    // Default synthetic result: prominently labeled MOCK so a first-run dev in
    // `dev:harness` can't mistake the scaffold's placeholder for a real (or
    // broken) generation. "MOCK" is the dominant line; the short workflow id
    // keeps per-gen uniqueness. (`%0A` is a newline in placehold.co's text.)
    return [
      `https://placehold.co/512x512/1971c2/ffffff/png?text=MOCK%0A${encodeURIComponent(
        workflowId.slice(-4),
      )}`,
    ];
  };

  let installed = false;
  let teardown: () => void = () => {};

  function install(): () => void {
    if (installed) return teardown;
    installed = true;

    const parentOrigin = win.location.origin;
    const originalParent = win.parent;
    let consentGranted = !!options.consentGranted;
    let tokenSerial = 0;
    let submitCount = 0;
    // body + cost remembered per workflow so the succeeded snapshot can echo them.
    const workflows = new Map<string, { polls: number; cost: number; body: WorkflowBody }>();
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const dispatchToBlock = (data: unknown) => {
      win.dispatchEvent(new MessageEvent('message', { data, origin: parentOrigin }));
    };
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };

    const nextToken = (): WrappedToken => {
      tokenSerial += 1;
      return {
        raw: `${DEV_TOKEN}.${tokenSerial}`,
        scopes: consentGranted ? [BUDGETED_SCOPE] : [],
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        ...(consentGranted ? { buzzBudget } : {}),
      };
    };

    const succeededSnapshot = (workflowId: string) => {
      const wf = workflows.get(workflowId);
      const cost = wf?.cost ?? legacyCost;
      const body = wf?.body ?? ({} as WorkflowBody);
      return {
        workflowId,
        status: 'succeeded' as const,
        cost: { total: cost },
        imageUrls: imagesFor(workflowId, body),
        // Pick-aware APPROXIMATION of the real backend's
        // BlockWorkflowSnapshot.spentAccountType. The real backend stamps the
        // LARGEST realized debit (`primaryDebitedAccountType`), and its currency
        // resolution is preferred-first + fallback/SPLIT — so when the picked
        // pool can't cover the cost the realized primary debit is a DIFFERENT
        // (fallback) pool than the pick. The mock's single-total-balance model
        // can't simulate splits, so it stamps the PICKED pool: that equals the
        // primary debit only in the common FULL-COVERAGE case, and always stamps
        // on success (it can't model the no-debit / field-OMITTED case). When no
        // pool was submitted, fall back to the largest-wallet heuristic.
        spentAccountType: body.accountType ?? primaryFunder(buzzBalance),
      };
    };

    const parentMock = {
      postMessage: (msg: unknown) => {
        if (
          typeof msg !== 'object' ||
          msg === null ||
          typeof (msg as { type?: unknown }).type !== 'string'
        ) {
          return;
        }
        const typed = msg as {
          type: string;
          payload?: {
            requestId?: string;
            workflowId?: string;
            resourceType?: BlockResourcePickerType;
            purpose?: 'display' | 'generationSource';
            asyncScan?: boolean;
            body?: WorkflowBody;
            key?: string;
            keys?: string[];
            value?: unknown;
            prefix?: string;
            limit?: number;
            cursor?: string;
          };
        };

        options.onOutbound?.({ type: typed.type, payload: typed.payload });

        const requestId = typed.payload?.requestId;

        switch (typed.type) {
          case 'REQUEST_TOKEN':
            dispatchToBlock({
              type: 'TOKEN_REFRESH_RESPONSE',
              payload: { ...(requestId ? { requestId } : {}), token: nextToken() },
            });
            return;

          case 'REQUEST_CONSENT': {
            // Lazy-consent round-trip: grant the scope, then push a
            // host-initiated TOKEN_REFRESH carrying it (the App's auto-resume
            // depends on seeing the new scope on its token).
            consentGranted = true;
            after(0, () => {
              dispatchToBlock({ type: 'TOKEN_REFRESH', payload: { token: nextToken() } });
            });
            return;
          }

          case 'REQUEST_SIGN_IN':
            // The real host opens its login UI; nothing to reply.
            return;

          case 'ESTIMATE_WORKFLOW': {
            const body = typed.payload?.body ?? ({} as WorkflowBody);
            dispatchToBlock({
              type: 'ESTIMATE_RESULT',
              payload: {
                requestId,
                snapshot: {
                  workflowId: 'wf_estimate',
                  status: 'pending',
                  cost: { total: costFor(body) },
                },
              },
            });
            return;
          }

          case 'SUBMIT_WORKFLOW': {
            submitCount += 1;
            const body = typed.payload?.body ?? ({} as WorkflowBody);
            const cost = costFor(body);

            // Disallowed-account path (content-rating clamp): the real backend
            // rejects a picked pool outside the app's maturity policy at the
            // currency-resolution boundary — BEFORE any Buzz spend — so this is
            // checked first. Surfaces as a `failed` snapshot (mirrors how a
            // submit tRPC BAD_REQUEST becomes an errorSnapshot in createLiveHost).
            if (body.accountType && disallowedAccounts.has(body.accountType)) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: `wf_fail_${submitCount}`,
                    status: 'failed',
                    error: disallowedAccountError(body.accountType),
                  },
                },
              });
              return;
            }

            // Insufficient-Buzz path: legacy failMode, the buzz scenario's
            // force flag, OR a simulated balance that can't cover this gen.
            const balanceSimulated = typeof buzz.balance === 'number';
            const insufficient =
              failMode === 'all' ||
              failMode === 'insufficient' ||
              buzz.insufficient === true ||
              (balanceSimulated && (buzz.balance as number) < cost);

            // Generic generation failure: failNext countdown, failRate dice, or
            // the legacy 'some' (~1 in 3) mode.
            let genericFail = false;
            if (!insufficient) {
              if ((gen.failNext ?? 0) > 0) {
                gen.failNext = (gen.failNext as number) - 1;
                genericFail = true;
              } else if (typeof gen.failRate === 'number' && Math.random() < gen.failRate) {
                genericFail = true;
              } else if (failMode === 'some' && submitCount % 3 === 0) {
                genericFail = true;
              }
            }

            if (insufficient) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: `wf_fail_${submitCount}`,
                    status: 'failed',
                    error: INSUFFICIENT_BUZZ_ERROR,
                  },
                },
              });
              return;
            }
            if (genericFail) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: `wf_fail_${submitCount}`,
                    status: 'failed',
                    error: GENERIC_GEN_ERROR,
                  },
                },
              });
              return;
            }

            // Success path: debit the simulated balance + remember body/cost.
            if (balanceSimulated) buzz.balance = (buzz.balance as number) - cost;
            const workflowId = `wf_${submitCount}_${Date.now()}`;
            workflows.set(workflowId, { polls: 0, cost, body });
            dispatchToBlock({
              type: 'WORKFLOW_SUBMITTED',
              payload: { requestId, snapshot: { workflowId, status: 'pending' } },
            });
            return;
          }

          case 'POLL_WORKFLOW': {
            const workflowId = typed.payload?.workflowId ?? '';
            const wf = workflows.get(workflowId);
            const polls = (wf?.polls ?? 0) + 1;
            if (wf) wf.polls = polls;
            if (polls >= pollsUntilDone) {
              // Apply synthetic latency on the terminal (succeeded) poll only.
              const delay = latencyFor();
              if (delay > 0) {
                after(delay, () =>
                  dispatchToBlock({
                    type: 'WORKFLOW_STATUS',
                    payload: { requestId, snapshot: succeededSnapshot(workflowId) },
                  }),
                );
              } else {
                dispatchToBlock({
                  type: 'WORKFLOW_STATUS',
                  payload: { requestId, snapshot: succeededSnapshot(workflowId) },
                });
              }
            } else {
              dispatchToBlock({
                type: 'WORKFLOW_STATUS',
                payload: { requestId, snapshot: { workflowId, status: 'processing' as const } },
              });
            }
            return;
          }

          case 'CANCEL_WORKFLOW': {
            const workflowId = typed.payload?.workflowId ?? '';
            workflows.delete(workflowId);
            dispatchToBlock({
              type: 'WORKFLOW_CANCELED',
              payload: { requestId, snapshot: { workflowId, status: 'canceled' } },
            });
            return;
          }

          case 'OPEN_BUZZ_PURCHASE': {
            // Refill the simulated balance so the post-top-up retry succeeds.
            const newBalance = typeof buzz.balance === 'number' ? buzz.balance + 1000 : 1000;
            if (typeof buzz.balance === 'number') buzz.balance = newBalance;
            buzz.insufficient = false;
            dispatchToBlock({
              type: 'BUZZ_PURCHASE_RESULT',
              payload: { requestId, purchased: true, newBalance },
            });
            return;
          }

          case 'GET_BUZZ_BALANCE': {
            // Reply with the synthetic per-pool wallet (what useBuzzBalance
            // reads). Mirrors createLiveHost's BUZZ_BALANCE_RESULT reply shape
            // exactly. Drop a request with no requestId — the block correlates
            // the reply by it, so a reply without one is unroutable (matches
            // the sibling request cases + createLiveHost).
            if (typeof requestId !== 'string') return;
            // Simulated read failure: reply with the error shape
            // (`{ requestId, error }`, no `balance`) — byte-for-byte
            // createLiveHost's failure reply — so the block's error UI fires.
            if (buzzBalanceError !== undefined) {
              dispatchToBlock({
                type: 'BUZZ_BALANCE_RESULT',
                payload: { requestId, error: buzzBalanceError },
              });
              return;
            }
            dispatchToBlock({
              type: 'BUZZ_BALANCE_RESULT',
              payload: { requestId, balance: { ...buzzBalance } },
            });
            return;
          }

          case 'GET_VIEWER': {
            // Reply with the canned viewer (what useViewer reads). Mirrors
            // createLiveHost's VIEWER_RESULT reply shape exactly. Drop a request
            // with no requestId — the block correlates the reply by it, so a
            // reply without one is unroutable (matches the sibling request cases
            // + createLiveHost).
            if (typeof requestId !== 'string') return;
            // Simulated read failure: reply with the error shape
            // (`{ requestId, error }`, no `viewer`) — byte-for-byte
            // createLiveHost's failure reply — so the block's error UI fires.
            if (viewerError !== undefined) {
              dispatchToBlock({
                type: 'VIEWER_RESULT',
                payload: { requestId, error: viewerError },
              });
              return;
            }
            dispatchToBlock({
              type: 'VIEWER_RESULT',
              payload: { requestId, viewer: { ...viewerResult } },
            });
            return;
          }

          case 'GET_BUZZ_TRANSACTIONS': {
            // Buzz-dashboard ledger read. Drop a request with no requestId
            // (unroutable). A forced read error replies with the FREE-TEXT error
            // variant (mirrors the real host forwarding err.message).
            if (typeof requestId !== 'string') return;
            if (buzzReadError !== undefined) {
              dispatchToBlock({
                type: 'BUZZ_TRANSACTIONS_RESULT',
                payload: { requestId, error: buzzReadError },
              });
              return;
            }
            dispatchToBlock({
              type: 'BUZZ_TRANSACTIONS_RESULT',
              payload: {
                requestId,
                result: {
                  transactions: buzzTransactions.transactions,
                  ...(buzzTransactions.cursor !== undefined
                    ? { cursor: buzzTransactions.cursor }
                    : {}),
                },
              },
            });
            return;
          }

          case 'GET_BUZZ_ACCOUNTS': {
            if (typeof requestId !== 'string') return;
            if (buzzReadError !== undefined) {
              dispatchToBlock({
                type: 'BUZZ_ACCOUNTS_RESULT',
                payload: { requestId, error: buzzReadError },
              });
              return;
            }
            dispatchToBlock({
              type: 'BUZZ_ACCOUNTS_RESULT',
              payload: { requestId, result: { accounts: buzzAccounts } },
            });
            return;
          }

          case 'GET_DAILY_COMPENSATION': {
            if (typeof requestId !== 'string') return;
            if (buzzReadError !== undefined) {
              dispatchToBlock({
                type: 'DAILY_COMPENSATION_RESULT',
                payload: { requestId, error: buzzReadError },
              });
              return;
            }
            dispatchToBlock({
              type: 'DAILY_COMPENSATION_RESULT',
              payload: {
                requestId,
                result: {
                  resources: dailyCompensation.resources,
                  hasPublishedResources: dailyCompensation.hasPublishedResources,
                },
              },
            });
            return;
          }

          case 'GET_WILDCARD_PACK': {
            // Token-INDEPENDENT import. A forced error replies with the
            // DISCRIMINATED enum code (NOT free-text) — mirrors the real host.
            if (typeof requestId !== 'string') return;
            if (wildcardPackError !== undefined) {
              dispatchToBlock({
                type: 'WILDCARD_PACK_RESULT',
                payload: { requestId, error: wildcardPackError },
              });
              return;
            }
            dispatchToBlock({
              type: 'WILDCARD_PACK_RESULT',
              payload: { requestId, pack: wildcardPack },
            });
            return;
          }

          case 'OPEN_CHECKPOINT_PICKER': {
            const selected = cannedPicks.Checkpoint;
            dispatchToBlock({
              type: 'CHECKPOINT_PICKER_RESULT',
              payload: {
                requestId,
                ...(selected
                  ? {
                      selected: {
                        versionId: selected.versionId,
                        modelId: selected.modelId,
                        modelName: selected.modelName,
                        versionName: selected.versionName,
                        baseModel: selected.baseModel,
                      },
                    }
                  : {}),
              },
            });
            return;
          }

          case 'OPEN_RESOURCE_PICKER': {
            const rtype = typed.payload?.resourceType;
            const selected = rtype ? cannedPicks[rtype] : undefined;
            dispatchToBlock({
              type: 'RESOURCE_PICKER_RESULT',
              payload: { requestId, ...(selected ? { selected } : {}) },
            });
            return;
          }

          case 'OPEN_IMAGE_UPLOAD': {
            // Host-chrome image upload: return the canned result keyed by the
            // requested `purpose` (mirrors the real host's IMAGE_UPLOAD_RESULT).
            //   • 'generationSource' → the UNSCANNED source { url, width, height }
            //   • 'display' (default / absent) → the MODERATED image
            // `null` → dismissed (no `selected`), so the hook resolves to null.
            const isGenerationSource = typed.payload?.purpose === 'generationSource';

            // NON-BLOCKING display path (asyncScan:true): early-resolve with a
            // PENDING handle, then stream the canned scan verdict on a later tick.
            // Ignored for generationSource (no host-side scan on that path).
            if (typed.payload?.asyncScan === true && !isGenerationSource) {
              // `null` cannedImageUpload = dismissed → bare result, no verdict.
              if (!cannedImageUpload) {
                dispatchToBlock({ type: 'IMAGE_UPLOAD_RESULT', payload: { requestId } });
                return;
              }
              const { imageId, url } = cannedImageUpload;
              // 1) early-resolve on persist (imageId known, NOT yet scanned).
              dispatchToBlock({
                type: 'IMAGE_UPLOAD_RESULT',
                payload: { requestId, selected: { status: 'pending', imageId, url } },
              });
              // 2) stream the canned verdict on a later tick (mirrors the host's
              //    async BlockImageScanPoller resolving after the modal closed).
              const result: BlockImageScanResult =
                cannedImageScan === 'scanned'
                  ? { status: 'scanned', image: cannedImageUpload }
                  : cannedImageScan === 'error'
                    ? { status: 'error', message: 'Image scan failed (simulated).' }
                    : {
                        status: 'blocked',
                        ...(cannedImageScan.reason !== undefined
                          ? { reason: cannedImageScan.reason }
                          : {}),
                      };
              after(0, () =>
                dispatchToBlock({
                  type: 'IMAGE_SCAN_RESOLVED',
                  payload: { requestId, imageId, result },
                }),
              );
              return;
            }

            // BLOCKING display / generationSource (unchanged).
            const selected = isGenerationSource ? cannedGenerationSourceUpload : cannedImageUpload;
            dispatchToBlock({
              type: 'IMAGE_UPLOAD_RESULT',
              payload: { requestId, ...(selected ? { selected } : {}) },
            });
            return;
          }

          // ---- Civitai Apps KV datastore (W4) — in-memory backend ----
          case 'APP_STORAGE_GET': {
            const key = typed.payload?.key ?? '';
            const row = store.get(key);
            dispatchToBlock({
              type: 'APP_STORAGE_GET_RESULT',
              payload: { requestId, value: row ? row.value : null },
            });
            return;
          }

          case 'APP_STORAGE_SET': {
            const key = typed.payload?.key ?? '';
            const value = typed.payload?.value;
            if (storageFailNext > 0) {
              storageFailNext -= 1;
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                payload: { requestId, ok: false, error: 'STORAGE_UNAVAILABLE' },
              });
              return;
            }
            const sizeBytes = jsonByteSize(value);
            if (sizeBytes > valueCapBytes) {
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                payload: { requestId, ok: false, error: 'PAYLOAD_TOO_LARGE' },
              });
              return;
            }
            // Quota check: projected usage after this upsert.
            const existing = store.get(key);
            const existingBytes = existing ? jsonByteSize(existing.value) + key.length : 0;
            const projected = usedBytes() - existingBytes + sizeBytes + key.length;
            if (projected > quotaBytes) {
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                payload: { requestId, ok: false, error: 'PAYLOAD_TOO_LARGE' },
              });
              return;
            }
            store.set(key, { value, updatedAt: new Date().toISOString() });
            dispatchToBlock({
              type: 'APP_STORAGE_SET_RESULT',
              payload: { requestId, ok: true, sizeBytes },
            });
            return;
          }

          case 'APP_STORAGE_DELETE': {
            const key = typed.payload?.key ?? '';
            if (storageFailNext > 0) {
              storageFailNext -= 1;
              dispatchToBlock({
                type: 'APP_STORAGE_DELETE_RESULT',
                payload: { requestId, ok: false, deleted: false, error: 'STORAGE_UNAVAILABLE' },
              });
              return;
            }
            const had = store.delete(key);
            dispatchToBlock({
              type: 'APP_STORAGE_DELETE_RESULT',
              payload: { requestId, ok: true, deleted: had },
            });
            return;
          }

          case 'APP_STORAGE_LIST': {
            const prefix = typed.payload?.prefix ?? '';
            const limit = typed.payload?.limit ?? 100;
            const cursor = typed.payload?.cursor;
            // Cursor = base64 of the last returned key (matches the hook's
            // documented `nextCursor` contract).
            const afterKey = cursor ? safeAtob(cursor) : undefined;
            const allKeys = [...store.entries()]
              .filter(([k]) => k.startsWith(prefix))
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
            const startIdx = afterKey
              ? allKeys.findIndex(([k]) => k > afterKey)
              : 0;
            const slice = (startIdx < 0 ? [] : allKeys.slice(startIdx)).slice(0, limit);
            const keys = slice.map(([key, row]) => ({ key, updatedAt: row.updatedAt }));
            const last = slice[slice.length - 1]?.[0];
            const hasMore =
              last !== undefined &&
              allKeys.findIndex(([k]) => k === last) < allKeys.length - 1;
            dispatchToBlock({
              type: 'APP_STORAGE_LIST_RESULT',
              payload: {
                requestId,
                keys,
                ...(hasMore && last ? { nextCursor: safeBtoa(last) } : {}),
              },
            });
            return;
          }

          case 'APP_STORAGE_QUOTA': {
            dispatchToBlock({
              type: 'APP_STORAGE_QUOTA_RESULT',
              payload: {
                requestId,
                usedBytes: usedBytes(),
                rowCount: store.size,
                limitBytes: quotaBytes,
                limitRows,
              },
            });
            return;
          }

          // ---- Civitai Apps SHARED datastore — in-memory votable backend ----
          case 'SHARED_LIST': {
            const prefix = typed.payload?.prefix ?? '';
            const limit = typed.payload?.limit ?? 100;
            const cursor = typed.payload?.cursor;
            // Newest-first: highest seq first.
            const all = [...sharedStore.values()]
              .filter((r) => r.key.startsWith(prefix))
              .sort((a, b) => b.seq - a.seq);
            // Cursor = base64 of the last returned key (matches the hook's
            // opaque-nextCursor contract).
            const afterKey = cursor ? safeAtob(cursor) : undefined;
            const startIdx = afterKey ? all.findIndex((r) => r.key === afterKey) + 1 : 0;
            const slice = (startIdx <= 0 && afterKey ? [] : all.slice(startIdx)).slice(0, limit);
            const items = slice.map(sharedItemWire);
            const last = slice[slice.length - 1]?.key;
            const hasMore =
              last !== undefined && all.findIndex((r) => r.key === last) < all.length - 1;
            dispatchToBlock({
              type: 'SHARED_LIST_RESULT',
              payload: {
                requestId,
                items,
                ...(hasMore && last ? { nextCursor: safeBtoa(last) } : {}),
              },
            });
            return;
          }

          case 'SHARED_GET_COUNT': {
            const key = typed.payload?.key ?? '';
            const row = sharedStore.get(key);
            dispatchToBlock({
              type: 'SHARED_GET_COUNT_RESULT',
              payload: { requestId, count: row ? row.voters.size : 0 },
            });
            return;
          }

          case 'SHARED_GET_COUNTS': {
            const keys = typed.payload?.keys ?? [];
            const counts: Record<string, number> = {};
            for (const k of keys) counts[k] = sharedStore.get(k)?.voters.size ?? 0;
            dispatchToBlock({
              type: 'SHARED_GET_COUNTS_RESULT',
              payload: { requestId, counts },
            });
            return;
          }

          case 'SHARED_APPEND': {
            if (sharedFailNext > 0) {
              sharedFailNext -= 1;
              dispatchToBlock({
                type: 'SHARED_APPEND_RESULT',
                payload: { requestId, key: '', error: 'SHARED_UNAVAILABLE' },
              });
              return;
            }
            const value = typed.payload?.value as SharedStorageValue | undefined;
            if (!value || typeof value.title !== 'string' || value.title.length === 0) {
              dispatchToBlock({
                type: 'SHARED_APPEND_RESULT',
                payload: { requestId, key: '', error: 'INVALID_VALUE' },
              });
              return;
            }
            sharedSeq += 1;
            const key = `shared_${sharedSeq}`;
            const now = new Date().toISOString();
            sharedStore.set(key, {
              key,
              seq: sharedSeq,
              authorUserId: mockUserId,
              value: {
                title: value.title,
                ...(value.body !== undefined ? { body: value.body } : {}),
                // Echo the opaque app-owned `data` blob unmodified (mirrors the
                // real host storing it alongside the moderated title/body).
                ...(value.data !== undefined ? { data: value.data } : {}),
              },
              voters: new Set<number>(),
              createdAt: now,
              updatedAt: now,
            });
            dispatchToBlock({
              type: 'SHARED_APPEND_RESULT',
              payload: { requestId, key },
            });
            return;
          }

          case 'SHARED_VOTE': {
            const key = typed.payload?.key ?? '';
            if (sharedFailNext > 0) {
              sharedFailNext -= 1;
              dispatchToBlock({
                type: 'SHARED_VOTE_RESULT',
                payload: { requestId, count: 0, error: 'SHARED_UNAVAILABLE' },
              });
              return;
            }
            const row = sharedStore.get(key);
            if (!row) {
              dispatchToBlock({
                type: 'SHARED_VOTE_RESULT',
                payload: { requestId, count: 0, error: 'NOT_FOUND' },
              });
              return;
            }
            // Set membership → one vote per user (voting twice is a no-op).
            row.voters.add(mockUserId);
            row.updatedAt = new Date().toISOString();
            dispatchToBlock({
              type: 'SHARED_VOTE_RESULT',
              payload: { requestId, count: row.voters.size },
            });
            return;
          }

          case 'SHARED_UNVOTE': {
            const key = typed.payload?.key ?? '';
            if (sharedFailNext > 0) {
              sharedFailNext -= 1;
              dispatchToBlock({
                type: 'SHARED_UNVOTE_RESULT',
                payload: { requestId, count: 0, error: 'SHARED_UNAVAILABLE' },
              });
              return;
            }
            const row = sharedStore.get(key);
            if (!row) {
              dispatchToBlock({
                type: 'SHARED_UNVOTE_RESULT',
                payload: { requestId, count: 0, error: 'NOT_FOUND' },
              });
              return;
            }
            row.voters.delete(mockUserId);
            row.updatedAt = new Date().toISOString();
            dispatchToBlock({
              type: 'SHARED_UNVOTE_RESULT',
              payload: { requestId, count: row.voters.size },
            });
            return;
          }

          case 'SHARED_WITHDRAW': {
            const key = typed.payload?.key ?? '';
            if (sharedFailNext > 0) {
              sharedFailNext -= 1;
              dispatchToBlock({
                type: 'SHARED_WITHDRAW_RESULT',
                payload: { requestId, ok: false, deleted: false, error: 'SHARED_UNAVAILABLE' },
              });
              return;
            }
            const had = sharedStore.delete(key);
            dispatchToBlock({
              type: 'SHARED_WITHDRAW_RESULT',
              payload: { requestId, ok: true, deleted: had },
            });
            return;
          }

          case 'SHARED_UPDATE': {
            const key = typed.payload?.key ?? '';
            if (sharedFailNext > 0) {
              sharedFailNext -= 1;
              dispatchToBlock({
                type: 'SHARED_UPDATE_RESULT',
                payload: { requestId, ok: false, error: 'SHARED_UNAVAILABLE' },
              });
              return;
            }
            const row = sharedStore.get(key);
            // NOT_FOUND — the key is missing (mirrors the host's missing/hidden
            // rejection). Checked before the author gate so a non-author can't
            // probe for a row's existence.
            if (!row) {
              dispatchToBlock({
                type: 'SHARED_UPDATE_RESULT',
                payload: { requestId, ok: false, error: 'NOT_FOUND' },
              });
              return;
            }
            // FORBIDDEN — author gate: only the contributing viewer can update
            // in place (the real host re-derives `author_user_id === caller`).
            if (row.authorUserId !== mockUserId) {
              dispatchToBlock({
                type: 'SHARED_UPDATE_RESULT',
                payload: { requestId, ok: false, error: 'FORBIDDEN' },
              });
              return;
            }
            // Belt on title (mirrors SHARED_APPEND's INVALID_VALUE check).
            const value = typed.payload?.value as SharedStorageValue | undefined;
            if (!value || typeof value.title !== 'string' || value.title.length === 0) {
              dispatchToBlock({
                type: 'SHARED_UPDATE_RESULT',
                payload: { requestId, ok: false, error: 'INVALID_VALUE' },
              });
              return;
            }
            // In-place update: preserve key/voters/createdAt; replace the value
            // and bump updatedAt (mirrors the real "preserving key/votes/reports").
            row.value = {
              title: value.title,
              ...(value.body !== undefined ? { body: value.body } : {}),
              ...(value.data !== undefined ? { data: value.data } : {}),
            };
            row.updatedAt = new Date().toISOString();
            dispatchToBlock({
              type: 'SHARED_UPDATE_RESULT',
              payload: { requestId, ok: true },
            });
            return;
          }

          default:
            return;
        }
      },
    };

    Object.defineProperty(win, 'parent', {
      value: parentMock,
      configurable: true,
      writable: true,
    });

    // Merge theme into the init context.
    const baseContext: BlockContext = options.context ?? { slotId: 'app.page' };
    const context: BlockContext = { ...baseContext, theme };

    // Color-domain maturity (civitai #2670). Resolve the ceiling by precedence:
    // explicit maxBrowsingLevel > maturity convenience > domain-derived. Only
    // EMIT a field when the corresponding option was set, so the default mock
    // host stays a #2670-predating host (the hook fail-closes to SFW).
    const resolvedCeiling: number | undefined =
      options.maxBrowsingLevel !== undefined
        ? options.maxBrowsingLevel
        : options.maturity === 'sfw'
          ? SFW_LEVELS
          : options.maturity === 'mature'
            ? ALL_LEVELS
            : options.domain !== undefined
              ? options.domain === 'red'
                ? ALL_LEVELS
                : SFW_LEVELS
              : undefined;

    const initPayload: BlockInitPayload = {
      blockInstanceId,
      blockId,
      appId,
      token: nextToken(),
      context,
      settings: { publisherSettings: {}, userSettings: {} },
      viewer,
      theme,
      renderMode: 'iframe',
      ...(options.domain !== undefined ? { domain: options.domain } : {}),
      ...(resolvedCeiling !== undefined ? { maxBrowsingLevel: resolvedCeiling } : {}),
    };

    after(0, () => dispatchToBlock({ type: 'BLOCK_INIT', payload: initPayload }));

    let torn = false;
    teardown = () => {
      if (torn) return;
      torn = true;
      installed = false;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      Object.defineProperty(win, 'parent', {
        value: originalParent,
        configurable: true,
        writable: true,
      });
    };
    return teardown;
  }

  function setScenario(patch: MockHostScenarioPatch): void {
    if (patch.failMode !== undefined) failMode = patch.failMode;
    if (patch.pollsUntilDone !== undefined) pollsUntilDone = patch.pollsUntilDone;
    if (patch.cost !== undefined) legacyCost = patch.cost;
    if (patch.cannedPicks !== undefined) cannedPicks = patch.cannedPicks;
    // `null` is a meaningful value (dismissed), so check for the KEY's presence.
    if ('cannedImageUpload' in patch) cannedImageUpload = patch.cannedImageUpload ?? null;
    if ('cannedGenerationSourceUpload' in patch)
      cannedGenerationSourceUpload = patch.cannedGenerationSourceUpload ?? null;
    if (patch.cannedImageScan !== undefined) cannedImageScan = patch.cannedImageScan;
    if (patch.generation !== undefined) gen = { ...gen, ...patch.generation };
    if (patch.buzz !== undefined) buzz = { ...buzz, ...patch.buzz };
    if (patch.buzzBalanceError !== undefined)
      buzzBalanceError = normalizeBalanceError(patch.buzzBalanceError);
    if (patch.viewerResult !== undefined) viewerResult = patch.viewerResult;
    if (patch.viewerError !== undefined) viewerError = normalizeViewerError(patch.viewerError);
    if (patch.buzzTransactions !== undefined) buzzTransactions = patch.buzzTransactions;
    if (patch.buzzAccounts !== undefined) buzzAccounts = patch.buzzAccounts;
    if (patch.dailyCompensation !== undefined) dailyCompensation = patch.dailyCompensation;
    if (patch.buzzReadError !== undefined) buzzReadError = normalizeReadError(patch.buzzReadError);
    if (patch.wildcardPack !== undefined) wildcardPack = patch.wildcardPack;
    if (patch.wildcardPackError !== undefined) wildcardPackError = patch.wildcardPackError;
    if (patch.disallowedAccountTypes !== undefined)
      disallowedAccounts = new Set(patch.disallowedAccountTypes);
    if (patch.storage !== undefined) {
      // Only the live-tunable storage knob (`failNext`) is applied mid-session;
      // seed/quota are install-time (re-install to change the backing store).
      if (patch.storage.failNext !== undefined) storageFailNext = patch.storage.failNext;
    }
    if (patch.shared !== undefined) {
      // Only `failNext` is live-tunable; `seed` is install-time (re-install to
      // change the backing store).
      if (patch.shared.failNext !== undefined) sharedFailNext = patch.shared.failNext;
    }
  }

  const buzzHandle: MockBuzzHandle = {
    getBalance: () => buzz.balance,
    setBalance: (n) => {
      buzz.balance = n;
    },
  };

  return { install, setScenario, buzz: buzzHandle };
}

/** btoa/atob that work in both browser + node (happy-dom + vitest). */
function safeBtoa(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'utf-8').toString('base64');
}
function safeAtob(s: string): string {
  if (typeof atob === 'function') return atob(s);
  return Buffer.from(s, 'base64').toString('utf-8');
}
