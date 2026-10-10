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
  APP_STORAGE_ERROR_REQUEST_FAILED,
  APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED,
  APP_STORAGE_ERROR_USER_ROW_LIMIT,
  APP_STORAGE_ERROR_VALUE_TOO_LARGE,
  APP_STORAGE_MAX_BYTES,
  APP_STORAGE_MAX_ROWS,
  APP_STORAGE_MAX_VALUE_BYTES,
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
  type AppWorkflow,
  type BlockPublishedModel,
  type BlockTrainedEpoch,
  type BlockWorkflowSnapshot,
  type BlockGatedImage,
  type BlockCollectionFollowErrorCode,
  type BlockCreatePostHostError,
  type BlockCreatePostResult,
  type BlockPrepareTrainingDatasetHostError,
  type BlockRunTrainingHostError,
  type BlockTrainingDatasetResult,
  type BlockTrainingRejectionReason,
  type ColorDomain,
  type SharedStorageValue,
  type Theme,
  type ViewerInfo,
  type WorkflowBody,
  type WrappedToken,
} from '@civitai/app-sdk/blocks';

import {
  consentUnavailablePayload,
  isKnownBlockScope,
  resolveUngrantableConsentNotice,
} from './consent.js';
import {
  requiredStorageScope,
  storageResultType,
  storageScopeDeniedMessage,
  storageScopeDeniedPayload,
} from './mockHostScopes.js';
import {
  governsIdempotencyKey,
  idempotencyKeyDeniedMessage,
  idempotencyKeyRefusal,
} from './mockHostIdempotency.js';
import {
  SAVE_IMAGE_INVALID_REQUEST_ERROR,
  prepareSaveBytes,
  saveImageRequestKind,
} from './saveBytes.js';
import {
  UPLOAD_BYTES_INVALID_ERROR,
  admitUploadBytes,
  resolveUploadBytesRequest,
  type UploadBytesWindowEntry,
} from './uploadBytes.js';
import { RUN_TRAINING_ERROR_CODES } from '../hooks/useRunTraining.js';
import { hostContextWithTheme } from '../transport/transport.js';
import { isRoutableRequestId } from '../transport/requestId.js';

/**
 * The block's preferred Buzz pool. On a `textToImage` {@link WorkflowBody} it's
 * the top-level `accountType`; on a `customComfy` RECIPE body it lives under
 * `params.accountType`; a `step` body (EITHER arm) and a `customComfy` INLINE
 * body have NO account preference at all — the host's `blockStepBodySchema`,
 * `blockPassThroughStepBodySchema` and `blockInlineComfyBodySchema` are all
 * `.strict()` with no `accountType` anywhere, so there is no field to read and
 * `undefined` (let the host pick) is the accurate answer rather than a fallback.
 * That is why `case 'step'` needs no second narrow on the arm, unlike
 * `customComfy`: both step arms give the same answer.
 *
 * 🔴 SWITCH ON EVERY MEMBER, NEVER `kind === 'x' ? … : …`. The previous shape
 * was a two-way ternary whose `else` branch assumed "not customComfy therefore
 * textToImage". Adding the `step` member turned that assumption into a
 * `Property 'accountType' does not exist on type 'WorkflowBodyStep'` build
 * failure — which is the union doing its job, and the reason it is worth
 * writing this exhaustively: the next member added to `WorkflowBody` will land
 * on the `default` below and be a compile error naming this function, instead
 * of being silently absorbed by an `else`.
 *
 * 🔴 THE SAME THING HAPPENED AGAIN INSIDE `customComfy`, WHICH IS NOW ITSELF A
 * UNION ON `mode`. `body.params.accountType` stopped compiling the moment the
 * inline arm landed, because an inline body has no `params`. Narrow on
 * `mode === 'inline'` — a presence test (`'mode' in body`) is WRONG here and is
 * a bug the host documents: the recipe arm declares `mode` as an OPTIONAL
 * literal, so `{ …, mode: 'recipe' }` and `{ …, mode: undefined }` both set the
 * key while still being recipe bodies.
 */
const preferredAccountType = (body: WorkflowBody): BuzzAccountType | undefined => {
  switch (body.kind) {
    case 'textToImage':
      return body.accountType;
    case 'customComfy':
      return body.mode === 'inline' ? undefined : body.params.accountType;
    case 'step':
      return undefined;
    // A training body names no pool either: the host's `blockTrainingBodySchema`
    // is `.strict()` with no `accountType`.
    case 'training':
      return undefined;
    default: {
      // Exhaustiveness check: a new `WorkflowBody` member makes this assignment
      // fail to compile, right here, rather than defaulting somewhere.
      const unhandled: never = body;
      return unhandled;
    }
  }
};

/** The full all-levels ceiling a `red` domain projects (mirrors the server). */
const ALL_LEVELS =
  BrowsingLevel.PG |
  BrowsingLevel.PG13 |
  BrowsingLevel.R |
  BrowsingLevel.X |
  BrowsingLevel.XXX;

const DEV_TOKEN = 'dev.mockhost.mock.jwt.NOT.A.REAL.RS256';
const BUDGETED_SCOPE = 'ai:write:budgeted';

/**
 * Host storage ceilings, taken from the SDK's single definition.
 *
 * 🔴 NEVER RE-TYPE THESE AS LITERALS. They were literals once, copied from the
 * host's APP-WIDE umbrella rather than the per-viewer clamp it actually
 * enforces — 25x too large on bytes and **1000x** on rows. A block that seeded
 * 5,000 rows passed
 * `dev:mock` reporting 0.5% of its row budget used, and failed on the 1,001st
 * write in production. The mock's job is to fail where production fails, so
 * the defaults ARE the production values; {@link MockStorageScenario.quotaBytes}
 * / {@link MockStorageScenario.limitRows} remain for tests that want something
 * smaller. See `@civitai/app-sdk/blocks`'s `appStorageLimits.ts` for
 * provenance and the re-derivation command.
 */
const DEFAULT_STORAGE_QUOTA_BYTES = APP_STORAGE_MAX_BYTES;
const DEFAULT_STORAGE_VALUE_CAP_BYTES = APP_STORAGE_MAX_VALUE_BYTES;
const DEFAULT_STORAGE_LIMIT_ROWS = APP_STORAGE_MAX_ROWS;

/**
 * How submits behave. `'none'` = everything succeeds; `'all'` / `'insufficient'`
 * = every submit fails as if the viewer were OUT OF BUZZ, until an
 * `OPEN_BUZZ_PURCHASE` resets the mode to `'none'`; `'some'` = ~1 in 3
 * submits fail with a generic error.
 *
 * 🔴 EVERY FAILING MODE **REJECTS** with `WorkflowSubmitError` code
 * `'exception'` — each emits the host's cost-less `failureSnapshot(err)`. That
 * includes `'all'`/`'insufficient'`, which until this was fixed RESOLVED a
 * priced `failed` snapshot. Production never does that for an empty wallet: the
 * orchestrator refuses the debit, the server throws, and the host replies with
 * `failureSnapshot(err)` (no `cost`). See {@link MockBuzzScenario}. A priced,
 * RESOLVING refusal is a spend CAP — {@link MockGenerationScenario.submitCapRefusal}.
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
   *
   * 🔴 SINCE civitai/civitai-app-starters#251 THIS MAKES `submit()` **REJECT**,
   * not resolve a `failed` snapshot. It emits the host's `failureSnapshot(err)`
   * shape (the `'failed'` sentinel id, no `cost`), so the rejection carries
   * `code: 'exception'` and the reason stays on `err.snapshot.error`. Your test
   * needs a `catch`, not a `snap.status` check.
   */
  failRate?: number;
  /**
   * Force the next N submits to fail (counts down). Deterministic companion to
   * {@link failRate} — handy for "first try fails, retry succeeds" UX tests.
   *
   * 🔴 SINCE #251 a forced failure **REJECTS** (`code: 'exception'`) rather than
   * resolving a `failed` snapshot — see {@link MockGenerationScenario.failRate}.
   */
  failNext?: number;
  /**
   * Force every ESTIMATE to come back unusable, so a block author can exercise
   * their `catch` around `estimate()` locally.
   *
   * 🔴 THE SIBLING KNOBS ABOVE DRIVE SUBMIT ONLY. Until this existed there was no
   * way to reproduce a failed estimate against the mock host at all — which is
   * how civitai/civitai#4159 reached production: the dead "Cost unavailable"
   * control was unreachable in every local harness, so nobody could have hit it
   * before a real user did.
   *
   * The two values are the two REAL producers of an unusable estimate, and they
   * are deliberately separate because a block may want to render them
   * differently (one has a server reason to show, the other does not):
   *
   * - `'failed'`  — replies with the host's real `failureSnapshot` shape:
   *   `{ workflowId:'failed', status:'failed', error }`, no `cost`. This is what
   *   a server-side `blocks.estimateWorkflow` throw looks like on the wire.
   * - `'no-cost'` — replies with an otherwise-SUCCESSFUL snapshot that simply
   *   carries no `cost` (`{ workflowId:'wf_estimate', status:'pending' }`), which
   *   is what the server produces when the whatIf reply has no numeric total.
   *
   * Both make `useBuzzWorkflow().estimate()` reject with a `WorkflowEstimateError`
   * whose `code` matches this value. Default: unset (estimates price normally).
   */
  failEstimate?: 'failed' | 'no-cost';
  /**
   * Error message returned with `failEstimate: 'failed'`. Default
   * `'mock: estimate failed'`. Set it to a realistic server message (e.g. a
   * resource-compatibility rejection) to check how your block renders one.
   */
  failEstimateMessage?: string;
  /**
   * How the mock answers `ESTIMATE_WORKFLOW_BATCH` (`useBatchEstimate()`), so a
   * block can exercise its per-cell fallback locally.
   *
   * - `'supported'` (default) — prices each cell exactly as an
   *   `ESTIMATE_WORKFLOW` of that body would be priced (`costPerGen`,
   *   `failEstimate` and the training rules all apply per cell) and replies with
   *   the snapshots in order plus the host's aggregate.
   * - `'unsupported'` — replies `{ error: 'unsupported on this host' }`, the
   *   host's generic answer for a message it has no handler for.
   *   `estimateBatch()` rejects with `BatchEstimateError` code `'unsupported'`.
   * - `'silent'` — never replies, which is what a host that PREDATES the message
   *   does. `estimateBatch()` rejects with code `'timeout'` once its wait ends;
   *   pass a short `timeoutMs` to it in a test.
   *
   * Live-tunable via `setScenario({ generation: { batchEstimate } })`.
   */
  batchEstimate?: 'supported' | 'unsupported' | 'silent';
  /**
   * Force every SUBMIT to come back as a caught server EXCEPTION — the host's
   * real `failureSnapshot(err)` shape: `{ workflowId:'failed', status:'failed',
   * error }` with **no `cost`**. `useBuzzWorkflow().submit()` rejects with a
   * `WorkflowSubmitError` whose `code` is `'exception'`.
   *
   * This knob was added for civitai/civitai-app-starters#251, when no other submit
   * knob produced a rejection at all. The out-of-Buzz knobs
   * ({@link MockBuzzScenario}) now emit this same shape, because production does;
   * this one stays as the way to inject an arbitrary server message with the
   * wallet untouched. The `failEstimate` knob is the estimate-side twin of this
   * one.
   *
   * Checked FIRST, before the disallowed-account / spend-cap / out-of-Buzz /
   * generic paths: a host-side throw pre-empts every server-side decision.
   *
   * Default: unset (submits behave normally).
   */
  failSubmitException?: boolean;
  /**
   * Error message returned with {@link MockGenerationScenario.failSubmitException}.
   * Default `'mock: submit failed'`. Set it to a realistic server message to
   * check how your block's developer-facing error surface renders one.
   */
  failSubmitExceptionMessage?: string;
  /**
   * Make every SUBMIT come back as a server SPEND-CAP refusal — the priced,
   * RESOLVING shape `{ workflowId:'failed', status:'failed', cost:{ total }, error }`,
   * where `total` is this generation's cost. `useBuzzWorkflow().submit()`
   * RESOLVES it (no rejection); the block reads `status === 'failed'`.
   *
   * This is what the real submit returns when a cap stops the run before
   * anything is spent: the app's per-generation budget, the viewer's daily (or
   * private-run) cap, the per-app consent budget, the app's spend or rate limit,
   * or a dev-session cap. 🔴 **Buying Buzz fixes none of them**, so a block must
   * not offer a top-up for this reply. Running OUT of Buzz is a different shape —
   * a rejection; see {@link MockBuzzScenario}.
   *
   * Pass the server's text (e.g. `'insufficient buzz budget: estimate 600 exceeds
   * budget 200'`), or `true` for a default message. Checked after the
   * disallowed-account path and before the out-of-Buzz path, matching the real
   * ordering: the caps are checked before the orchestrator is asked to debit.
   * Live-tunable via `setScenario({ generation: { submitCapRefusal } })`; set it
   * to `undefined` there to clear it. URL: `?capRefusal=1` (or `=<text>`).
   * Default: unset.
   */
  submitCapRefusal?: string | true;
  /** A single result image url (or `(body) => url`). */
  image?: ImageSpec;
  /**
   * Multiple result image urls (or `(body) => url[]`). Takes precedence over
   * {@link image} when both are set.
   */
  images?: string[] | ((req: WorkflowBody) => string[]);
  /**
   * How many trained epochs a succeeded training run reports on
   * {@link BlockWorkflowSnapshot.trainedEpochs} — epochs `1…n`, each tagged with
   * the run's `$type`. Applies only to a PASS-THROUGH `{ kind: 'step', $type:
   * 'training' }` / `'imageResourceTraining'` body (tagged with that `$type`) and
   * to a `kind: 'training'` run started through `RUN_TRAINING` (tagged
   * `'training'`, the step the host builds for it); every other body is
   * unaffected.
   *
   * Default `0`: the field is omitted, as the host omits it for a run that
   * produced no checkpoint. Opt in with `n > 0` to simulate a finished run —
   * it is off by default because a real run on this arm is bounded by the
   * spend rules below, so a default success would promise what the host may
   * not deliver.
   *
   * The mock never fabricates a checkpoint url: the block contract does not
   * include one, so nothing here does either. A training snapshot's `imageUrls` stand for
   * the run's SAMPLE images only (the same {@link image}/{@link images} knobs
   * apply).
   *
   * 🔴 The real host's spend and timeout rules for this arm (see
   * `WorkflowBodyPassThroughStep.maxBuzz` in `@civitai/app-sdk/blocks`) are
   * NOT simulated: the mock neither quotes nor times out, so a success here
   * says nothing about whether your run is quoted, what it costs, or whether
   * it finishes.
   *
   * Snapshot-only: the app-queue read (`QUERY_APP_WORKFLOWS`) replies with the
   * canned {@link MockHostOptions.appWorkflows} rows verbatim — they carry no
   * body, so the mock cannot tell a training row from any other. To exercise
   * {@link AppWorkflow.trainedEpochs}, put it on the rows you pass there.
   */
  trainedEpochs?: number;
  /**
   * When set, a succeeded pass-through training snapshot also carries this as
   * {@link BlockWorkflowSnapshot.publishedModel} — simulating a run the viewer
   * has started (`published: false`) or finished (`published: true`) publishing
   * through the model wizard. Default: unset (field omitted). For the app-queue
   * read, put `publishedModel` (and `trainedEpochs`) on the rows you pass as
   * `appWorkflows`.
   */
  trainingPublishedModel?: BlockPublishedModel;
}

/**
 * The pass-through training `$type` a body names, if any. Exact match — the
 * orchestrator's `$type` discriminator is case-sensitive. Only the pass-through
 * arm carries a `$type`, so no separate `kind` narrow is needed.
 */
const passThroughTrainingType = (
  body: WorkflowBody,
): BlockTrainedEpoch['$type'] | undefined => {
  const t = (body as { $type?: unknown }).$type;
  return t === 'training' || t === 'imageResourceTraining' ? t : undefined;
};

/**
 * The orchestrator `$type` a body's run trains with, if it trains at all: the
 * pass-through training `$type`s above, and `'training'` for a
 * `kind: 'training'` body — the host builds an ai-toolkit `training` step for it.
 */
const trainingStepType = (body: WorkflowBody): BlockTrainedEpoch['$type'] | undefined =>
  body.kind === 'training' ? 'training' : passThroughTrainingType(body);

/**
 * The training bounds the mock enforces — COPIES of `@civitai/app-sdk/blocks`'s
 * `BLOCK_TRAINING_DATASET_MAX_ITEMS`, `BLOCK_TRAINING_CAPTION_MAX_CHARS` and
 * `BLOCK_TRAINING_MAX_BUZZ_PER_RUN`, deliberately not value-imported: a value
 * import of a symbol the newest PUBLISHED app-sdk lacks raises this package's
 * peer floor (`tests/guards/blocks-react-peer-floor.test.mjs`). The copy is held
 * to the SDK's value by `test/trainingKindFlow.test.tsx`, which imports both.
 */
export const MOCK_TRAINING_BOUNDS = {
  datasetMaxItems: 50,
  captionMaxChars: 1000,
  maxBuzzPerRun: 5000,
} as const;

/**
 * The host's `PREPARE_TRAINING_DATASET` item check, mirrored: the server's
 * `blockTrainingDatasetItemsSchema` — 1…50 items, each EXACTLY `{ imageId:
 * positive integer, caption: string ≤ 1000 }`. The real host runs this BEFORE any
 * server call and refuses with `invalid training dataset`, so the mock does too.
 */
function isValidTrainingDatasetItems(items: unknown): boolean {
  if (!Array.isArray(items)) return false;
  if (items.length < 1 || items.length > MOCK_TRAINING_BOUNDS.datasetMaxItems) return false;
  return items.every((it) => {
    if (typeof it !== 'object' || it === null || Array.isArray(it)) return false;
    const keys = Object.keys(it);
    if (keys.length !== 2 || !keys.includes('imageId') || !keys.includes('caption')) return false;
    const { imageId, caption } = it as { imageId: unknown; caption: unknown };
    return (
      typeof imageId === 'number' &&
      Number.isInteger(imageId) &&
      imageId > 0 &&
      typeof caption === 'string' &&
      caption.length <= MOCK_TRAINING_BOUNDS.captionMaxChars
    );
  });
}

/** The real server's refusal for a training request from a token without the spend scope. */
export const MOCK_TRAINING_SCOPE_ERROR = 'block lacks ai:write:budgeted scope';
/** The real server's refusal for an unknown, expired or spent quote on `RUN_TRAINING`. */
export const MOCK_TRAINING_QUOTE_GONE_ERROR =
  'training quote not found, expired or already used — estimate again';
/** The real server's refusal for a training estimate naming a dataset it does not hold. */
export const MOCK_TRAINING_DATASET_GONE_ERROR = 'training dataset not found or expired';
/**
 * The real server's two refusals for a dataset with NOTHING admitted
 * (`prepareBlockTrainingDataset`): every image failed eligibility, or every
 * eligible image failed its import. The server THROWS rather than returning
 * `count: 0`, so a successful reply always admits at least one image.
 */
export const MOCK_TRAINING_NONE_ELIGIBLE_ERROR =
  'none of the requested images can be used for training';
export const MOCK_TRAINING_NONE_IMPORTED_ERROR =
  'none of the requested images could be prepared for training';
/**
 * The forced `RUN_TRAINING` errors that settle BEFORE the server claims (and so
 * consumes) the quote: the host's own gate and dialog codes. Derived from the
 * host-code list — every code except `submission-unconfirmed`, which the host
 * emits only after a submit was sent. Any other forced error (a server message
 * such as "Not enough Buzz for this training run.") stands for a refusal the
 * server made AFTER its claim, so it consumes the quote.
 */
const PRE_CLAIM_RUN_TRAINING_ERRORS: ReadonlySet<string> = new Set(
  RUN_TRAINING_ERROR_CODES.filter((c) => c !== 'submission-unconfirmed'),
);

/**
 * The host's cell cap for one `ESTIMATE_WORKFLOW_BATCH` (civitai/civitai
 * `BLOCK_ESTIMATE_BATCH_MAX_CELLS`). The hook's `BATCH_ESTIMATE_MAX_CELLS` is the
 * same number; the mock keeps its own copy so it refuses exactly as the host does
 * when a block bypasses the hook.
 */
const MOCK_ESTIMATE_BATCH_MAX_CELLS = 16;
/** The server's per-cell refusal of a `kind: 'training'` body inside a batch. */
const MOCK_TRAINING_IN_BATCH_ERROR =
  'a training estimate cannot be part of a batch — estimate it on its own';
/** Default quote total for a `kind: 'training'` estimate when {@link MockHostOptions.trainingQuoteTotal} is unset. */
const DEFAULT_TRAINING_QUOTE_TOTAL = 500;
/** The real quote lifetime (`BLOCK_TRAINING_QUOTE_TTL_SECONDS`, 15 min). */
const TRAINING_QUOTE_TTL_MS = 15 * 60_000;

/**
 * BUZZ scenario controls — simulate a viewer who runs out of Buzz. The mock host
 * treats `balance` as a spendable wallet: each succeeding generation DEBITS its
 * cost, a submit whose cost would exceed the remaining balance fails as
 * OUT OF BUZZ, and `OPEN_BUZZ_PURCHASE` REFILLS the balance.
 *
 * 🔴 OUT OF BUZZ **REJECTS** — `useBuzzWorkflow().submit()` throws a
 * `WorkflowSubmitError` with code `'exception'`, the reason on
 * `err.snapshot.error`. That is what production does. The orchestrator refuses
 * the debit (HTTP 403), the server turns that into a thrown `BAD_REQUEST`, and
 * the host replies with its cost-less `failureSnapshot(err)`. These knobs used to
 * RESOLVE a priced `failed` snapshot instead, so a block tested against the mock
 * could build a "resolved refusal → top-up" flow that production never reaches.
 *
 * Nothing structural tells this rejection apart from other `'exception'`s (the
 * server message is upstream text, not a contract). To decide whether to offer
 * a top-up, compare the viewer's spendable balance (`useBuzzBalance()`) with the
 * quoted cost — never the error text. In the mock, that balance is
 * {@link MockHostOptions.buzzBalance}, which is separate from `balance` below.
 *
 * A priced, RESOLVING refusal is a spend CAP, which a top-up cannot fix — see
 * {@link MockGenerationScenario.submitCapRefusal}.
 */
export interface MockBuzzScenario {
  /**
   * Simulated spendable balance. When set, generations debit against it and a
   * gen that would exceed it is refused as out of Buzz (a REJECTION, see above).
   * When `undefined`, balance is NOT simulated (back-compat: only the legacy
   * `failMode` and {@link insufficient} drive the out-of-Buzz path).
   */
  balance?: number;
  /**
   * Force every submit down the out-of-Buzz path regardless of balance — it
   * REJECTS with code `'exception'` (see above). Equivalent to the legacy
   * `failMode: 'insufficient'`; provided here so the path is reachable from the
   * `buzz` group alone. `OPEN_BUZZ_PURCHASE` clears it — and clears
   * `failMode: 'insufficient' | 'all'` too (back to `'none'`), so a top-up
   * followed by a retry succeeds whichever knob forced the out-of-Buzz state.
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
   * Simulated per-(app, viewer) byte quota. A `set` that would cross it
   * resolves `{ ok: false, error: APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED }` —
   * the host's own `'per-user storage quota exceeded'`. Defaults to
   * `APP_STORAGE_MAX_BYTES`.
   *
   * Each ceiling answers its OWN host-authored message (#343), so
   * `classifyAppStorageError()` distinguishes them here exactly as it does in
   * production. It did not always: for three releases every ceiling answered
   * the literal `'PAYLOAD_TOO_LARGE'`, a string the bridge can never send,
   * which made a block's actionable error branch pass locally and take the
   * generic arm live.
   *
   * 🔴 AND THIS BUDGET IS COUNTED IN A DIFFERENT UNIT FROM THE HOST'S. The
   * mock sums WIRE bytes (`JSON.stringify` as UTF-8); the host sums STORED
   * bytes (`octet_length(value::jsonb::text)`), which is larger for every
   * container — up to ~1.5x for a long array. So this ceiling is up to half
   * again more generous than production's, and unlike the mock's other known
   * divergences that error is PERMISSIVE: a fixture that fits here can be
   * rejected live. civitai/civitai-app-starters#347. Size against
   * `getQuota()`, and treat a local pass as evidence, not proof.
   */
  quotaBytes?: number;
  /**
   * Per-value byte cap. A `set` whose serialized value exceeds it resolves
   * `{ ok: false, error: APP_STORAGE_ERROR_VALUE_TOO_LARGE }`. Defaults to
   * `APP_STORAGE_MAX_VALUE_BYTES`.
   *
   * 🔴 LOWERING THIS DOES NOT CHANGE THE MESSAGE. The emitted string always
   * names the host's REAL cap (`value exceeds 64KB cap` today), because that
   * is the string a block has to match in production and the mock exists to
   * exercise that match. This knob makes the gate cheap to TRIP in a test; it
   * is not a claim that the host's cap moved.
   */
  valueCapBytes?: number;
  /**
   * Simulated per-(app, viewer) row ceiling. A `set` that would ADD a row past
   * it resolves `{ ok: false, error: APP_STORAGE_ERROR_USER_ROW_LIMIT }` — the
   * host's `'per-user row limit exceeded'`, distinct from the byte gates'
   * message, so a block can tell "no slots left" from "no space left" locally.
   * Overwriting an existing key adds no row and is never refused by this gate.
   * Defaults to `APP_STORAGE_MAX_ROWS`.
   *
   * 🔴 THIS WAS REPORTED BUT NOT ENFORCED. `getQuota` returned it from the
   * start while the write path checked only `quotaBytes`, so a row-limit
   * overrun — the ceiling a block is most likely to hit, since rows fill long
   * before bytes do — passed `dev:mock` silently and failed only in
   * production. Reporting a limit nobody enforces is worse than not reporting
   * one: it reads as coverage.
   */
  limitRows?: number;
  /**
   * Force the next N storage MUTATIONS (`set`/`delete`) to fail with the
   * bridge's generic `'storage request failed'`
   * ({@link APP_STORAGE_ERROR_REQUEST_FAILED}) — the string the host sends
   * when the failure carries no message of its own. Counts down; exercises the
   * retryable arm of a block's error UX, as opposed to the five ceilings,
   * which retrying cannot fix.
   *
   * It used to answer `'STORAGE_UNAVAILABLE'`, which no host has ever sent.
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
  /**
   * Whether this host can grant consent AT ALL. Default `true` — today's
   * behaviour, where `REQUEST_CONSENT` grants the budgeted scope and pushes a
   * `TOKEN_REFRESH`.
   *
   * Set `false` to model the real host's UN-GRANTABLE case: the scope was
   * clamped/withheld at mint (a dev-tunnel preview token, a surface that carries
   * no money scope), so no consent round-trip in this environment can ever add
   * it. The mock then mirrors production and posts a fire-and-forget
   * `CONSENT_UNAVAILABLE` push instead of granting — which is the ONLY way an
   * author can exercise a refusal handler in `pnpm dev`. Until this knob existed
   * the mock always granted, so that branch was unreachable locally and the
   * developer-visible bug it guards against was untestable before production.
   *
   * Live-tunable via {@link MockHost.setScenario}; also settable from the dev
   * harness URL as `?consent=ungrantable`.
   */
  consentGrantable?: boolean;
  /**
   * How submits behave. Default `'none'` (all succeed). See
   * {@link MockHostFailMode} — every failing mode REJECTS with code
   * `'exception'`; `'all'`/`'insufficient'` model an out-of-Buzz viewer.
   */
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
   * BUZZ scenario: simulated balance + force-out-of-Buzz. Both REJECT the
   * submit, as production does. See {@link MockBuzzScenario}.
   */
  buzz?: MockBuzzScenario;
  /**
   * The viewer's per-pool Buzz WALLET ({ blue, green, yellow }) reported to a
   * block via the host-mediated `GET_BUZZ_BALANCE` → `BUZZ_BALANCE_RESULT`
   * bridge (what the `useBuzzBalance` hook reads). Distinct from the
   * {@link MockBuzzScenario.balance} spendable-wallet knob, which only drives
   * the out-of-Buzz SUBMIT rejection — this is the displayable per-pool balance,
   * and the number a block should compare with the quoted cost to decide on a
   * top-up. Set both when exercising that flow. Absent → {@link DEFAULT_BUZZ_BALANCE} (a plausible
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
   * The app generator SUBQUEUE page returned from `QUERY_APP_WORKFLOWS` (what
   * `useAppWorkflows` reads). `workflows` are the app's own tag-scoped gens
   * (newest-first); `cursor` (when set) drives the block's "next page" affordance.
   * The mock's `CANCEL_APP_WORKFLOW` marks the matching row `canceled` in place +
   * returns it. Absent → {@link DEFAULT_APP_WORKFLOWS}. Live-tunable via
   * {@link MockHost.setScenario}.
   */
  appWorkflows?: { workflows: AppWorkflow[]; cursor?: string | null };
  /**
   * Force BOTH app-subqueue bridges (`QUERY_APP_WORKFLOWS` /
   * `CANCEL_APP_WORKFLOW`) to reply with the FREE-TEXT `error` variant instead of
   * data — exercises `useAppWorkflows`'s error UI + a rejected `cancel()`. `true` →
   * a default message; a string → that message; an `Error` → its `.message`.
   * Absent → the reads/cancel succeed. Live-tunable via {@link MockHost.setScenario}.
   */
  appWorkflowsError?: boolean | string | Error;
  /**
   * The bare (post-less) scanned `Image` row ids returned from
   * `PUBLISH_GENERATION_OUTPUTS` (what `usePublishGenerationOutputs().publish()`
   * resolves with). Absent → {@link DEFAULT_PUBLISH_IMAGE_IDS}. Each reply makes
   * these ids postable once in a `CREATE_POST_FROM_APP` `published` source (see
   * {@link createPostResult}). Live-tunable via {@link MockHost.setScenario}.
   */
  publishImageIds?: number[];
  /**
   * Force `PUBLISH_GENERATION_OUTPUTS` to reply with the FREE-TEXT `error` variant
   * instead of ids — exercises the block's publish error UI (a rejected
   * `publish()`). `true` → a default message; a string → that message; an `Error`
   * → its `.message`. Absent → the publish succeeds. Live-tunable via
   * {@link MockHost.setScenario}.
   */
  publishError?: boolean | string | Error;
  /**
   * The per-viewer gated projection returned from `GET_IMAGES_BY_IDS` (what
   * `useGatedImages().getImages()` resolves with). Each entry is a
   * {@link BlockGatedImage} — `visible` (moderated projection incl. url) or
   * `hidden` (NO url). Absent → {@link DEFAULT_GATED_IMAGES} (includes at least one
   * `visible` AND one `hidden` entry so the blurred/hidden cell is exercised).
   * Live-tunable via {@link MockHost.setScenario}.
   */
  gatedImages?: BlockGatedImage[];
  /**
   * Force `GET_IMAGES_BY_IDS` to reply with the FREE-TEXT `error` variant instead
   * of images — exercises the block's gated-read error UI (a rejected
   * `getImages()`). `true` → a default message; a string → that message; an
   * `Error` → its `.message`. Absent → the read succeeds. Live-tunable via
   * {@link MockHost.setScenario}.
   */
  gatedImagesError?: boolean | string | Error;
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
   * Force `SET_COLLECTION_FOLLOW` to reply with an `error` instead of writing —
   * exercises `useCollectionFollow`'s refusal handling. Pass a
   * {@link BlockCollectionFollowErrorCode} for a HOST refusal (`'declined'` is
   * the one every block must handle: the viewer dismissed the confirm and
   * NOTHING was written) or any other string for the FREE-TEXT server-error
   * variant the real host forwards from the collection service. Absent → the
   * follow succeeds. Live-tunable via {@link MockHost.setScenario}.
   *
   * 🔴 There is no "the mock shows a confirm" option, and that is a real gap in
   * what this mock can prove: the consent dialog is HOST chrome, so the mock
   * settles immediately where the real host waits on a click. A block's confirm
   * handling is only exercised by `declined`, never by the timing.
   */
  collectionFollowError?: BlockCollectionFollowErrorCode | string;
  /**
   * The post reported on `CREATE_POST_FROM_APP` (what
   * `useCreatePostFromApp().createPost()` resolves with). Absent →
   * {@link DEFAULT_CREATE_POST_RESULT}. Ignored when {@link createPostError} is
   * set. Live-tunable via {@link MockHost.setScenario}.
   *
   * A `{ kind: 'published', imageIds }` source is checked as the server's
   * `resolveAppPublishedImages` checks it (civitai/civitai#5639). Production
   * accepts the viewer's own images that this app stamped and that are not in a
   * post yet, from this session or an earlier one. The mock has no earlier
   * sessions, so it accepts ONLY ids issued as postable on this mock instance
   * (an accepted `OPEN_IMAGE_UPLOAD { bytes }` reply,
   * {@link uploadImageBytesResult}, or a `PUBLISH_GENERATION_OUTPUTS` reply,
   * {@link publishImageIds}) plus the ids seeded with {@link postableImageIds}.
   * Any other id, a picked `useImageUpload()` id (production leaves it
   * unstamped) or an id a previous post already adopted is refused with
   * `an image is not available to post`, and a source with no positive integer
   * id with `no valid image ids in a published source`. A refused post adopts
   * nothing. `workflow` sources are not checked. The mock does not model the
   * scan wait, the viewer's ceiling or the server's input schema.
   */
  createPostResult?: BlockCreatePostResult;
  /**
   * Force `CREATE_POST_FROM_APP` to reply with an `error` instead of posting —
   * exercises `useCreatePostFromApp`'s refusal handling. Pass a
   * {@link BlockCreatePostHostError} for a HOST refusal (`'declined'` is the one
   * every block must handle: the viewer dismissed the confirm and NO POST
   * EXISTS) or any other string for the FREE-TEXT server-error variant the real
   * host forwards. Absent → the post succeeds. Live-tunable via
   * {@link MockHost.setScenario}.
   *
   * 🔴 Same real gap as {@link collectionFollowError}, and it binds harder here:
   * the consent dialog is HOST chrome, so the mock settles immediately where the
   * real host waits on a click, and what that dialog SHOWS (the server's
   * resolution of the request — resolved tags, host-fetched model names, real
   * thumbnails) has no mock analogue at all. A block's confirm handling is only
   * exercised by `declined`, never by the timing or the content.
   */
  createPostError?: BlockCreatePostHostError | string;
  /**
   * Images `PREPARE_TRAINING_DATASET` leaves out, with their reasons — what
   * `usePrepareTrainingDataset()` reports on `rejected`. Only entries whose
   * `imageId` the request actually named are reported, and `count` is the rest,
   * exactly as the server derives it. Absent → every image is admitted.
   * Live-tunable via {@link MockHost.setScenario}.
   *
   * When this rejects EVERY named image the reply is an `error`, as on the real
   * server — {@link MOCK_TRAINING_NONE_ELIGIBLE_ERROR}, or
   * {@link MOCK_TRAINING_NONE_IMPORTED_ERROR} when every image that passed
   * eligibility was rejected with an `import-*` reason. A success never has
   * `count: 0`.
   *
   * KIND-FAITHFUL, like the rest of the training path: the mock holds the
   * datasets it prepared, an estimate naming any other `datasetId` fails as the
   * server's does, a quote is run at most once, and every training call needs
   * `ai:write:budgeted` on the token ({@link MockHostOptions.consentGranted}) and
   * a signed-in viewer. What it cannot model: image ownership and moderation (it
   * has no images), the flag, and the page-only / dev-token refusals.
   *
   * ⚠️ The quote↔body check is NARROWER than the server's: the mock compares only
   * `datasetId`, while the server hashes the whole body (minus `quoteId`) and
   * refuses any change. A body edited between estimate and run passes here and
   * fails in production.
   */
  trainingDatasetRejected?: Array<{ imageId: number; reason: BlockTrainingRejectionReason }>;
  /**
   * Force `PREPARE_TRAINING_DATASET` to reply with an `error` — a
   * {@link BlockPrepareTrainingDatasetHostError} for a host refusal, or any other
   * string for the free-text server-message variant. Absent → it prepares.
   * Live-tunable via {@link MockHost.setScenario}.
   */
  trainingDatasetError?: BlockPrepareTrainingDatasetHostError | string;
  /**
   * The Buzz total a `kind: 'training'` estimate quotes. Default `500`. Above
   * `BLOCK_TRAINING_MAX_BUZZ_PER_RUN` (5,000) the estimate fails exactly as the
   * server's does. The run's terminal snapshot reports this as its `cost`.
   * Live-tunable via {@link MockHost.setScenario}.
   */
  trainingQuoteTotal?: number;
  /**
   * Force `RUN_TRAINING` to reply with an `error` instead of starting a run — a
   * {@link BlockRunTrainingHostError} (`'declined'`: the viewer dismissed the
   * dialog, no run; `'submission-unconfirmed'`: the run MAY exist) or any other
   * string for a server message. Absent → the run starts.
   *
   * Whether the QUOTE survives follows the real flow: the host's own gate and
   * dialog codes (`declined`, `review-mode`, `block is not ready`, `sign in to
   * train`, `invalid training request`, `no block token`) settle before the
   * server claims the quote, so it stays runnable; `submission-unconfirmed` and
   * any server message settle after the claim, so it is used up — re-running it
   * gets the quote-gone error. Live-tunable via {@link MockHost.setScenario};
   * `undefined` clears it.
   *
   * 🔴 Same real gap as {@link createPostError}: the consent dialog is HOST
   * chrome, so the mock settles immediately where the real host waits on a click.
   */
  runTrainingError?: BlockRunTrainingHostError | string;
  /**
   * Make `RUN_TRAINING` resolve the server's spend-cap or temporary-availability
   * refusal instead of a run:
   * a snapshot `{ workflowId: 'failed', status: 'failed', cost: { total: <quote> },
   * error: <this string> }` — the shape the real training submit returns when
   * the viewer's daily / private-run Buzz cap, the per-app consent budget, the
   * app's spend or rate limit (or its "temporarily unavailable" deny), or a
   * dev-session cap stops the run (refunded, no run). `useRunTraining()` rejects
   * it with `.refused`. Pass the server's text, e.g. `'daily Buzz cap reached: …'`.
   * 🔴 The quote is CONSUMED, as on the server (it is claimed before the cap
   * checks): running the same `quoteId` again gets the quote-gone error — estimate
   * again. Absent → the run starts. Live-tunable via {@link MockHost.setScenario};
   * `setScenario({ runTrainingCapRefusal: undefined })` clears it.
   */
  runTrainingCapRefusal?: string;
  /**
   * Force `SAVE_IMAGE` to reply with this `error` instead of saving — any of
   * the host's free-text refusals (`'image url is not allowed'`,
   * `'image is not available'`, `'busy'`, …), or
   * `'invalid save-image request'` to model a host that PREDATES the `bytes`
   * variant (what production replies to `saveImage({ bytes })` until the host
   * ships it). Applies to every variant; checked after the request-shape gate,
   * so an invalid request still gets `invalid save-image request`. Absent →
   * the save succeeds (subject to the `bytes` classification below).
   * Live-tunable via {@link MockHost.setScenario}; `undefined` clears it.
   *
   * The `bytes` variant is classified exactly as the host's contract says
   * (civitai/civitai-app-starters#583): PNG / WebP / JPEG by magic bytes, else
   * UTF-8 text with no NUL (JSON when it parses and the CLEANED `filename` —
   * `?`/`#` replaced with `_`, path dropped — ends `.json`, case-insensitive),
   * else `file type is not allowed`; an empty buffer,
   * `invalid save-image request`; over the host's byte cap,
   * `file exceeds the maximum save size`. 🔴 What the mock cannot model: that
   * the variant is PAGE-ONLY (it does not know which surface the block renders
   * on; a slot host has no `SAVE_IMAGE` handler and rejects it with
   * `unsupported on this host`),
   * the host's concurrency and per-window rate limits (`busy` — force it
   * here), and the real browser
   * download. {@link onSaveBytes} reports what would have been saved.
   */
  saveImageError?: string;
  /**
   * Called with each `bytes` save the mock ACCEPTS — the classified `mimeType`
   * (one of `image/png`, `image/webp`, `image/jpeg`, `application/json`,
   * `text/plain`), the download `filename` exactly as the host cleans it (the
   * same character rules, then the extension forced from that type), and the
   * `bytes` themselves.
   * The mock cannot trigger a browser download, so this is the observable a
   * test or harness asserts on.
   */
  onSaveBytes?: (file: { bytes: ArrayBuffer; mimeType: string; filename: string }) => void;
  /**
   * The moderated image an ACCEPTED `OPEN_IMAGE_UPLOAD { bytes }` replies with
   * (what `useUploadImageBytes().upload()` resolves with). Absent →
   * {@link DEFAULT_IMAGE_BYTES_UPLOAD}, whose `imageId` differs from
   * {@link DEFAULT_IMAGE_UPLOAD}'s so a block that confuses a picked upload
   * with an uploaded one is visible. Each accepted upload makes its `imageId`
   * postable ONCE in a `CREATE_POST_FROM_APP` `{ kind: 'published', imageIds }`
   * source on this same mock instance, as the real host allows for the app that
   * uploaded it; see {@link createPostResult} for what the mock refuses.
   * Live-tunable via {@link MockHost.setScenario}.
   *
   * The `bytes` variant runs the host's admission rules
   * (civitai/civitai#5639, `imageUploadBytes.ts`) in the host's order: not a
   * non-empty `ArrayBuffer`, or `purpose: 'generationSource'` →
   * `invalid image-upload request`; over 40 MiB →
   * `file exceeds the maximum upload size` (checked FIRST); a full rolling
   * window (3 uploads or 80 MiB per 60 s, per install) → `busy`; not PNG /
   * WebP / JPEG by magic bytes → `file type is not allowed`; then
   * {@link uploadImageBytesError}, standing in for the server persist and the
   * scan. 🔴 What the mock cannot model: that the variant is PAGE-ONLY, the
   * `posts:write:self` scope check (force `block lacks posts:write:self scope`
   * with {@link uploadImageBytesError}), the real scan, the no-reply for a
   * `requestId` reused while in flight (the mock replies at once), and that a
   * host OLDER than the variant opens its picker instead.
   */
  uploadImageBytesResult?: BlockUploadedImageInfo;
  /**
   * Force an `OPEN_IMAGE_UPLOAD { bytes }` that passed the admission rules
   * above to reply with this `error`: a server refusal the real host forwards
   * (`block lacks posts:write:self scope`,
   * `Rate limit exceeded, please retry shortly.`, a scan refusal, …), or
   * `busy` / `no block token`. The upload still counts against the window, as
   * on the host. Absent → it succeeds. Live-tunable via
   * {@link MockHost.setScenario}; `undefined` clears it.
   */
  uploadImageBytesError?: string;
  /**
   * Called with each `bytes` upload the mock ACCEPTS: the sniffed `mimeType`
   * (`image/png`, `image/webp` or `image/jpeg`), the `filename` as the host
   * stores it (the `useSaveImage()` bytes cleaning, the sniffed extension, at
   * most 255 characters), and a copy of the `bytes`.
   */
  onUploadImageBytes?: (file: { bytes: ArrayBuffer; mimeType: string; filename: string }) => void;
  /**
   * Image ids the mock treats as already issued and postable when the host is
   * created, as production treats an image this app stamped for the viewer in
   * an EARLIER session that is not in a post yet. Each seeded id may be posted
   * ONCE in a `CREATE_POST_FROM_APP` `{ kind: 'published', imageIds }` source;
   * see {@link createPostResult} for what the mock refuses. Use it for a test
   * that posts an image the block uploaded before the test started, instead of
   * driving an upload or `PUBLISH_GENERATION_OUTPUTS` first. Absent → none.
   * Read once at creation; not live-tunable.
   */
  postableImageIds?: number[];
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
   * The scopes the app's `block.manifest.json` DECLARES — the set the real
   * host's token mint draws from.
   *
   * 🔴 **STORAGE IS GATED ON THIS, AND THE DEFAULT IS EMPTY.** A storage op whose
   * scope is not in here is refused exactly as the server refuses it, because the
   * server's test is presence in the block's approved scope set (see
   * `BLOCK_SCOPES` in `@civitai/app-sdk`) and an undeclared scope is never
   * approved. Omit this and every `APP_STORAGE_*` / `SHARED_*` call fails.
   *
   * That is a DELIBERATE BREAKING DEFAULT. Until this existed the mock host
   * served storage unconditionally, so an app that forgot the scopes passed its
   * whole suite and the dev harness and then failed every save in production —
   * the one storage failure mode that actually ships was the only one the mock
   * could not produce. A default of "permissive" would have left that true for
   * every app that did not opt in, i.e. precisely the apps that did not know the
   * scopes existed.
   *
   * Pass what your manifest declares — ideally by importing your own
   * `block.manifest.json` as `manifest`, so the two cannot drift:
   *
   * ```ts
   * createMockHost({ declaredScopes: manifest.scopes });
   * ```
   *
   * ⚠️ The `import` line is described rather than shown ON PURPOSE, and please
   * do not helpfully add it back. `tests/guards/blocks-react-entry-directory-names.test.mjs`
   * extracts import specifiers with a raw regex over the whole file —
   * `/\bfrom\s*['"]([^'"]+)['"]/g`, comments included — so a `from '…'` inside a
   * doc comment is read as a real edge and resolved against THIS file's
   * directory. A relative path to a consumer's manifest does not exist from
   * here, and the guard fails with `unresolvable specifier`. Measured: it went
   * red on all five `Starter (…)` matrix legs.
   *
   * A test that only exercises storage mechanics (quota, caps, row limits) and
   * does not care about authorization should declare the storage scopes
   * explicitly rather than reach for a permissive flag — there is none, on
   * purpose.
   *
   * ⚠️ Scopes OTHER than storage are not read from here yet. `ai:write:budgeted`
   * keeps its own `consentGranted` flag, because `buzzBudget` is conditional on
   * it and `setScenario` can toggle it mid-session; giving one scope two sources
   * of truth is how they drift.
   */
  declaredScopes?: string[];
  /**
   * STORAGE scenario: in-memory KV backend (seed / quota / failNext). See
   * {@link MockStorageScenario}. When omitted, the store starts EMPTY with the
   * v0 defaults.
   *
   * ⚠️ This governs the BACKEND, not authorization. Storage is additionally
   * gated on {@link MockHostOptions.declaredScopes}, which defaults to empty —
   * so a scenario alone no longer makes storage answer. (It used to: this doc
   * said `APP_STORAGE_*` was "answered either way", and that was the defect.)
   */
  storage?: MockStorageScenario;
  /**
   * SHARED scenario: in-memory, app-scoped, votable backend (seed / failNext).
   * See {@link MockSharedScenario}. When omitted, the shared store starts EMPTY.
   *
   * ⚠️ As with {@link MockHostOptions.storage}, this governs the BACKEND and not
   * authorization: `SHARED_*` is additionally gated on
   * {@link MockHostOptions.declaredScopes} (`apps:storage:shared:read` /
   * `:write`), which defaults to empty.
   */
  shared?: MockSharedScenario;
  /** Host theme delivered in `BLOCK_INIT` + context. Default `'dark'`. */
  theme?: Theme;
  /**
   * The `BLOCK_INIT` context. Defaults to a COMPLETE `PageSlotContext` —
   * `{ slotId, entityType, slug, subPath, viewerUserId, viewerUsername, theme }`
   * — mirroring what `PageBlockHost.buildContext()` really sends, not a
   * `{ slotId }` stub. Pass a `ModelSlotContext` for a model-slot block.
   *
   * `theme` is layered in from {@link MockHostOptions.theme} for every slot whose
   * shape carries the field, so a context you pass WITHOUT a `theme` key still
   * gets the harness theme (and still follows a later `setTheme`). Only a slot
   * this SDK has no shape for is left alone — there is no `theme` field to set.
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
  /**
   * The VIEWER's own browsing level, emitted on `BLOCK_INIT` as
   * `effectiveBrowsingLevel` — what THIS person may be shown, as opposed to
   * what the domain permits anybody. Drives `useDomainMaturity().isSfw` /
   * `isLevelAllowed` and `<SfwGate>`, so this is the knob for testing a block
   * against a viewer who is narrower than the domain (e.g. a PG-only viewer on
   * a `red` host).
   *
   * 🔴 MIRRORS THE REAL HOST'S GATE RATHER THAN BEING MORE PERMISSIVE: the
   * emitted value is INTERSECTED with the resolved ceiling, exactly as
   * civitai's `projectBlockInitMaturity` does, so a value WIDER than the
   * ceiling cannot be driven here either. That is deliberate — a mock that let
   * you test a block against a viewer wider than the domain would be testing a
   * state production can never produce, which is the drift a mock exists to
   * prevent. Set {@link MockHostOptions.maxBrowsingLevel} if you want a wider
   * ceiling.
   *
   * Only emitted when set, and only alongside a resolved ceiling — omit it to
   * model a host that predates the field (the hook then falls back to the
   * domain ceiling).
   */
  viewerBrowsingLevel?: number;
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
 * `context`, and `appId` are fixed at install time — change them by
 * re-installing. `theme` is NOT among them: it has its own live control,
 * {@link MockHost.setTheme}, which pushes a real `THEME_CHANGE` — the mock of
 * the viewer toggling dark mode with the block already mounted.)
 */
export type MockHostScenarioPatch = Pick<
  MockHostOptions,
  | 'consentGrantable'
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
  | 'collectionFollowError'
  | 'createPostResult'
  | 'createPostError'
  | 'trainingDatasetRejected'
  | 'trainingDatasetError'
  | 'trainingQuoteTotal'
  | 'runTrainingError'
  | 'runTrainingCapRefusal'
  | 'appWorkflows'
  | 'appWorkflowsError'
  | 'publishImageIds'
  | 'publishError'
  | 'gatedImages'
  | 'gatedImagesError'
  | 'disallowedAccountTypes'
  | 'saveImageError'
  | 'uploadImageBytesResult'
  | 'uploadImageBytesError'
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
 *  - `setTheme('light' | 'dark')` — flip the site theme and push `THEME_CHANGE`.
 *  - `buzz.setBalance(n)` / `buzz.getBalance()` — flip the simulated wallet.
 *
 * `install()` is idempotent — calling it twice returns the same teardown;
 * `uninstall()` is safe to call more than once. */
export interface MockHost {
  install: () => () => void;
  /** Merge a partial scenario into the live mock host (no re-install). */
  setScenario: (patch: MockHostScenarioPatch) => void;
  /**
   * Flip the site theme and push a host-initiated `THEME_CHANGE` to the block
   * (what a real viewer's dark-mode toggle does). Also seeds the theme the next
   * `BLOCK_INIT` carries, so it works before install too.
   */
  setTheme: (theme: Theme) => void;
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
/**
 * The moderated image the mock host returns from an accepted
 * `OPEN_IMAGE_UPLOAD { bytes }` when {@link MockHostOptions.uploadImageBytesResult}
 * is omitted. Its `imageId` deliberately differs from {@link DEFAULT_IMAGE_UPLOAD}'s.
 */
const DEFAULT_IMAGE_BYTES_UPLOAD: BlockUploadedImageInfo = {
  imageId: 12345701,
  nsfwLevel: 1,
  contentRating: 'pg',
  url: 'https://image.civitai.com/mock/original=true/dev-bytes-upload.png',
};

const DEFAULT_GENERATION_SOURCE_UPLOAD: BlockGenerationSourceImageInfo = {
  url: 'https://image.civitai.com/mock/original=true/dev-generation-source.jpeg',
  width: 1024,
  height: 1024,
};

/**
 * The `BLOCK_INIT.viewer` the mock host sends when {@link MockHostOptions.viewer}
 * is omitted — EXACTLY `{ id, username, signedIn }`.
 *
 * Both halves mirror production byte-for-byte, and each is checkable:
 *
 *  - NO `status`. The platform deliberately withholds the viewer's coarse
 *    ban/mute moderation state from third-party iframes (civitai #2521) —
 *    `ViewerInfo.status` is `@deprecated` for precisely that reason. A fake
 *    that sends it lets a block read a field production never provides and
 *    still pass every local test: the same both-wrong-blind shape as the
 *    over-shared `ModelSlotContext` fields removed from the seven starter
 *    harnesses. The authoritative self-read (`GET_VIEWER` →
 *    {@link DEFAULT_VIEWER_RESULT}) is where `status` belongs, and it still
 *    carries it.
 *  - WITH `signedIn: true`. civitai/civitai `main`'s `withSignedInFlag`
 *    (`src/components/AppBlocks/projectBlockInit.ts`) stamps the literal `true`
 *    on every present viewer, from BOTH host surfaces, and that repo's
 *    `src/components/AppBlocks/__tests__/projectBlockInit.test.ts` pins
 *    `Object.keys(viewer).sort()` as exactly `['id', 'signedIn', 'username']`.
 *
 * 🔴 THE PROPERTY THIS FENCE HOLDS: the dev hosts must not be more generous
 * than the host they imitate. Any change here moves with
 * `createLiveHost`'s `anonFallbackViewer` and the two key-set fences in
 * `test/blockInitV2.test.ts` — they are one key set in four places.
 */
const DEFAULT_VIEWER: ViewerInfo = { id: 2, username: 'dev-viewer', signedIn: true };

/**
 * The out-of-Buzz rejection's `error`. Production's text is whatever the
 * orchestrator's 403 said (or the server's generic insufficient-funds default),
 * so neither this string nor the real one is a contract — never branch on it.
 */
const INSUFFICIENT_BUZZ_ERROR = 'Insufficient Buzz to run this generation.';
const GENERIC_GEN_ERROR = 'Generation failed (simulated).';
/** Default `error` for `generation.submitCapRefusal: true`. */
const DEFAULT_SUBMIT_CAP_REFUSAL = 'Buzz spend cap reached (simulated).';

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

/** Default message for a simulated app-subqueue failure ({@link MockHostOptions.appWorkflowsError}). */
const DEFAULT_APP_WORKFLOWS_ERROR = 'app workflows unavailable';

/** Normalize a {@link MockHostOptions.appWorkflowsError} value to an error string (or `undefined`). */
function normalizeAppWorkflowsError(e: boolean | string | Error | undefined): string | undefined {
  if (e === undefined || e === false) return undefined;
  if (e === true) return DEFAULT_APP_WORKFLOWS_ERROR;
  if (typeof e === 'string') return e || DEFAULT_APP_WORKFLOWS_ERROR;
  return e.message || DEFAULT_APP_WORKFLOWS_ERROR;
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
 * CAVEAT on `BlockBuzzTransaction`). Newest-first; `externalTransactionId` is
 * `null` on every row, exactly as the host's projection does (default-deny; #3192).
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
    // Host nulls externalTransactionId on EVERY block-facing row (default-deny; #3192).
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
 * Default app generator SUBQUEUE page reported on `QUERY_APP_WORKFLOWS`. A small
 * mixed-status list (a done gen with two images, one still processing) so a block
 * renders a realistic subqueue out of the box. `cursor: null` = the only page.
 * Image dims + nsfwLevel are populated on the done gen and null on the pending one
 * (mirrors the host projecting them only once the orchestrator has them).
 */
const DEFAULT_APP_WORKFLOWS: { workflows: AppWorkflow[]; cursor: string | null } = {
  workflows: [
    {
      workflowId: 'wf_app_2',
      status: 'succeeded',
      images: [
        { url: 'https://image.civitai.com/mock/app-gen-2a.jpeg', width: 1024, height: 1024, nsfwLevel: 1 },
        { url: 'https://image.civitai.com/mock/app-gen-2b.jpeg', width: 832, height: 1216, nsfwLevel: 1 },
      ],
      cost: 12,
      createdAt: '2026-07-14T12:00:00.000Z',
    },
    {
      workflowId: 'wf_app_1',
      status: 'processing',
      images: [],
      cost: null,
      createdAt: '2026-07-14T11:58:00.000Z',
    },
  ],
  cursor: null,
};

/**
 * Default bare (post-less) scanned `Image` row ids reported on
 * `PUBLISH_GENERATION_OUTPUTS` when {@link MockHostOptions.publishImageIds} is
 * omitted — a plausible pair of newly-created image ids.
 */
const DEFAULT_PUBLISH_IMAGE_IDS: number[] = [9001, 9002];

/** Default message for a simulated publish failure ({@link MockHostOptions.publishError}). */
const DEFAULT_PUBLISH_ERROR = 'publish unavailable';

/**
 * Default post reported on `CREATE_POST_FROM_APP` when
 * {@link MockHostOptions.createPostResult} is omitted.
 *
 * `imageIds` deliberately differs from {@link DEFAULT_PUBLISH_IMAGE_IDS}: a
 * block that conflates "the ids I published" with "the ids in the post" is
 * making an assumption the real host does not honour (a post can mix fresh
 * workflow outputs, whose rows are created by the post call itself, with
 * previously-published ids), and identical defaults would hide that.
 */
const DEFAULT_CREATE_POST_RESULT: BlockCreatePostResult = {
  postId: 4242,
  url: 'https://civitai.com/posts/4242',
  imageIds: [9101, 9102],
};

/** Normalize a {@link MockHostOptions.publishError} value to an error string (or `undefined`). */
function normalizePublishError(e: boolean | string | Error | undefined): string | undefined {
  if (e === undefined || e === false) return undefined;
  if (e === true) return DEFAULT_PUBLISH_ERROR;
  if (typeof e === 'string') return e || DEFAULT_PUBLISH_ERROR;
  return e.message || DEFAULT_PUBLISH_ERROR;
}

/**
 * Default per-viewer gated projection reported on `GET_IMAGES_BY_IDS` when
 * {@link MockHostOptions.gatedImages} is omitted. Deliberately mixes ALL THREE
 * shapes a block must render — a rated `visible` entry (full moderated
 * projection incl. url), a `hidden` one (NO url), and the author's own
 * not-yet-rated `visible` entry (`ratingPending`, url, NO rating) — so both the
 * blurred/placeholder path and the "still processing" path are exercised out of
 * the box.
 *
 * 🔴 THE THIRD ENTRY IS HERE BECAUSE ITS ABSENCE IS WHAT CAUSED THE BUG. A block
 * developed against a mock that only ever produced rated `visible` cells reads
 * `nsfwLevel` unconditionally, ships, and then renders its own author's
 * freshly-published image as a maturity claim. The mock defaults are the
 * fidelity gap where that happens.
 */
const DEFAULT_GATED_IMAGES: BlockGatedImage[] = [
  {
    imageId: 9001,
    status: 'visible',
    nsfwLevel: 1,
    contentRating: 'pg',
    url: 'https://image.civitai.com/mock/original=true/gated-9001.jpeg',
    width: 1024,
    height: 1024,
  },
  {
    imageId: 9002,
    status: 'hidden',
  },
  {
    imageId: 9003,
    status: 'visible',
    ratingPending: true,
    url: 'https://image.civitai.com/mock/original=true/gated-9003.jpeg',
    width: 1024,
    height: 1024,
  },
];

/** Default message for a simulated gated-image read failure ({@link MockHostOptions.gatedImagesError}). */
const DEFAULT_GATED_IMAGES_ERROR = 'gated images unavailable';

/** Normalize a {@link MockHostOptions.gatedImagesError} value to an error string (or `undefined`). */
function normalizeGatedImagesError(e: boolean | string | Error | undefined): string | undefined {
  if (e === undefined || e === false) return undefined;
  if (e === true) return DEFAULT_GATED_IMAGES_ERROR;
  if (typeof e === 'string') return e || DEFAULT_GATED_IMAGES_ERROR;
  return e.message || DEFAULT_GATED_IMAGES_ERROR;
}

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
 * map onto the new scenario groups so a dev can flip out-of-Buzz /
 * failures / latency without editing code. `?capRefusal=1` (or `=<text>`) sets
 * {@link MockGenerationScenario.submitCapRefusal}.
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
  // `?consent=ungrantable` models the host that can NEVER grant (scope clamped
  // at mint) — REQUEST_CONSENT then pushes CONSENT_UNAVAILABLE instead of a
  // token. Deliberately a THIRD value rather than a second parameter: `granted`
  // and `ungrantable` are mutually exclusive states of the same knob.
  else if (params.get('consent') === 'ungrantable') out.consentGrantable = false;

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
  // ?capRefusal=1|true → the default cap message; any other non-empty value is
  // used as the server text verbatim.
  const capRefusal = params.get('capRefusal');
  if (capRefusal !== null && capRefusal.trim() !== '') {
    generation.submitCapRefusal =
      capRefusal === '1' || capRefusal === 'true' ? true : capRefusal;
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
 * GENERATION KINDS: the estimate → submit → poll money path is kind-agnostic —
 * it drives EVERY `WorkflowBody` member with the identical lifecycle and
 * `generation`/`buzz` scenario config: `{ kind:'textToImage', … }`,
 * `{ kind:'step', … }`, and BOTH arms of `{ kind:'customComfy', … }` — the
 * RECIPE arm (`mode` omitted or `'recipe'`; names a server-registered recipe)
 * and the INLINE arm (`mode:'inline'`; the block ships the ComfyUI graph
 * itself, with its declared AIR `resources` and a `maxBuzz` bound). The inline
 * arm is live in production; this docblock used to name customComfy as a
 * recipe-only `{ recipe, params }` shape, which `preferredAccountType` 1000
 * lines above already contradicts.
 *
 * `spentAccountType` stamping follows the same split: the preferred pool lives
 * under `params.accountType` on a customComfy RECIPE body, and an INLINE body
 * has no `accountType` at all (the host's `blockInlineComfyBodySchema` is
 * `.strict()` without one — it resolves to Auto host-side), so the mock stamps
 * its largest-wallet fallback there. The server-only recipe registry is NOT
 * consulted — any `recipe` id is accepted (fail-open) since the mock stands in
 * for the server. So a scaffold can test a customComfy sample generation with
 * no backend, exactly like textToImage.
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
 * host.buzz.setBalance(0);       // out of Buzz mid-session: submit() now rejects ('exception')
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
  // Whether a REQUEST_CONSENT can be granted at all. Lives out here (not inside
  // `install()` next to `consentGranted`) precisely so `setScenario` can flip it
  // live — a harness UI needs to toggle "this preview can never grant" without
  // re-installing and losing the block's mounted state.
  let consentGrantable: boolean = options.consentGrantable ?? true;
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
  // Collection-follow bridge.
  //
  // 🔴 THERE IS DELIBERATELY NO FOLLOW-STATE MAP HERE, and an earlier version's
  // was removed rather than fixed. It held a per-collection `followed` map that
  // `SET_COLLECTION_FOLLOW` wrote to and NOTHING EVER READ — the reply echoes the
  // REQUEST (`{collectionId, followed: follow}`), exactly as both real hosts do,
  // so the map could not reach any observable. Seeding it, mutating it and
  // merging it on `setScenario` were all no-ops; deleting the whole thing left
  // the entire unit suite green, which is how three false claims about it
  // survived review. There is no READ op on this bridge for such a map to feed,
  // so the honest shape is not to offer one.
  let collectionFollowError: string | undefined = options.collectionFollowError;
  // App Blocks → Post bridge: the canned post + a forced-refusal knob.
  let createPostResult: BlockCreatePostResult =
    options.createPostResult ?? DEFAULT_CREATE_POST_RESULT;
  let createPostError: string | undefined = options.createPostError;
  // App Blocks training bridges: canned dataset rejections, quote total, and
  // forced-refusal knobs. The datasets/quotes themselves live per install.
  let trainingDatasetRejected: Array<{ imageId: number; reason: BlockTrainingRejectionReason }> =
    options.trainingDatasetRejected ?? [];
  let trainingDatasetError: string | undefined = options.trainingDatasetError;
  let trainingQuoteTotal: number = options.trainingQuoteTotal ?? DEFAULT_TRAINING_QUOTE_TOTAL;
  let runTrainingError: string | undefined = options.runTrainingError;
  // SAVE_IMAGE: a forced-refusal knob (see `saveImageError`).
  let saveImageError: string | undefined = options.saveImageError;
  // OPEN_IMAGE_UPLOAD { bytes }: the canned result, a forced-refusal knob, and
  // the host's rolling window (per install, like the host's per mount).
  let uploadImageBytesResult: BlockUploadedImageInfo =
    options.uploadImageBytesResult ?? DEFAULT_IMAGE_BYTES_UPLOAD;
  let uploadImageBytesError: string | undefined = options.uploadImageBytesError;
  let uploadBytesWindow: UploadBytesWindowEntry[] = [];
  // The ids a `CREATE_POST_FROM_APP` `{ kind: 'published' }` source may name:
  // ONLY ids this mock itself issued as postable (an accepted bytes upload, or a
  // PUBLISH_GENERATION_OUTPUTS reply) plus the seeded `postableImageIds` (an
  // earlier session's stamped, unposted images), and only until a post adopts
  // them. Mirrors the host's `resolveAppPublishedImages` (civitai/civitai#5639):
  // this app's provenance stamp and `postId IS NULL`. A picked `useImageUpload()`
  // image is never added: production leaves it unstamped, so it is not postable.
  const postableImageIds = new Set<number>(options.postableImageIds ?? []);
  let runTrainingCapRefusal: string | undefined = options.runTrainingCapRefusal;
  // App-subqueue bridge data + forced free-text-error knob. `appWorkflows` is
  // MUTABLE — CANCEL_APP_WORKFLOW marks the matching row canceled in place so a
  // follow-up QUERY reflects it.
  let appWorkflows: { workflows: AppWorkflow[]; cursor: string | null } = {
    workflows: options.appWorkflows?.workflows ?? DEFAULT_APP_WORKFLOWS.workflows,
    cursor: options.appWorkflows?.cursor ?? null,
  };
  let appWorkflowsError: string | undefined = normalizeAppWorkflowsError(options.appWorkflowsError);
  // Publish-outputs bridge data + forced free-text-error knob.
  let publishImageIds: number[] = options.publishImageIds ?? DEFAULT_PUBLISH_IMAGE_IDS;
  let publishError: string | undefined = normalizePublishError(options.publishError);
  // Gated-image read bridge data + forced free-text-error knob.
  let gatedImages: BlockGatedImage[] = options.gatedImages ?? DEFAULT_GATED_IMAGES;
  let gatedImagesError: string | undefined = normalizeGatedImagesError(options.gatedImagesError);
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
    // Per-viewer vote state (the mock's `mockUserId` is the "requesting viewer").
    viewerVoted: row.voters.has(mockUserId),
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

  // The CURRENT mock theme + a handle on the installed dispatcher, so
  // `setTheme` can push a host-initiated `THEME_CHANGE` after install. Both live
  // out here because `dispatchToBlock` is created inside `install()`; before
  // install (or after teardown) `pushToBlock` is null and `setTheme` only
  // updates the value the next `BLOCK_INIT` will carry.
  let currentTheme: Theme = theme;
  let pushToBlock: ((data: unknown) => void) | null = null;

  function install(): () => void {
    if (installed) return teardown;
    installed = true;

    const parentOrigin = win.location.origin;
    const originalParent = win.parent;
    let consentGranted = !!options.consentGranted;
    /**
     * Scopes granted by a `REQUEST_CONSENT` round-trip OTHER than
     * `ai:write:budgeted` (which keeps its own flag, because `buzzBudget` is
     * conditional on it and `setScenario` can toggle it).
     *
     * 🔴 WHY THIS EXISTS. The grant branch used to hand back exactly
     * `[BUDGETED_SCOPE]` and nothing else, so on this host NO consent-gated
     * scope but the money one could EVER appear on a token. That was invisible
     * while nothing waited on a grant; it stops being invisible the moment the
     * SDK does (`internal/withConsentRetry.ts`), because a block asking for
     * `posts:write:self` would be "granted" a token that still lacks it and
     * would sit out the full wait on a host that had already said yes. The real
     * host grants the missing set it computed from the manifest, so modelling it
     * as "grant what was asked for, filtered to the known vocabulary" is closer
     * than the constant was — and a dev host that quietly diverges here is
     * precisely what `./consent.js`'s header warns about.
     */
    const extraGrantedScopes = new Set<string>();
    /**
     * What the app's manifest DECLARES — the set the real host's token mint draws
     * from, and the set the storage gate tests presence in.
     *
     * 🔴 Deliberately NOT defaulted to anything permissive. See
     * {@link MockHostOptions.declaredScopes}: a permissive default would leave the
     * pre-gate behaviour in place for every app that did not opt in, which is the
     * population the gate exists for.
     *
     * This is a SNAPSHOT at install time, unlike `consentGranted`, which
     * `setScenario` can toggle. A manifest does not change mid-session.
     */
    const declaredScopeSet = new Set<string>(options.declaredScopes ?? []);
    /** Everything the CURRENT token carries. One reader, so the two cannot drift. */
    const currentScopes = (): string[] => [
      ...(consentGranted ? [BUDGETED_SCOPE] : []),
      ...extraGrantedScopes,
    ];
    let tokenSerial = 0;
    let submitCount = 0;
    // body + cost remembered per workflow so the succeeded snapshot can echo them.
    const workflows = new Map<string, { polls: number; cost: number; body: WorkflowBody }>();
    // Training: datasets this install prepared (id → admitted count) and the
    // quotes its estimates stored (id → what a run is checked against).
    const trainingDatasets = new Map<string, number>();
    const trainingQuotes = new Map<
      string,
      { datasetId: string; total: number; expiresAtMs: number; spent: boolean }
    >();
    let trainingSerial = 0;
    /** `<prefix>` + 32 hex characters — the real handles' shape. */
    const trainingHandle = (prefix: 'tds_' | 'tq_'): string => {
      trainingSerial += 1;
      return `${prefix}${trainingSerial.toString(16).padStart(32, '0')}`;
    };
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const dispatchToBlock = (data: unknown) => {
      win.dispatchEvent(new MessageEvent('message', { data, origin: parentOrigin }));
    };
    pushToBlock = dispatchToBlock;
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
        scopes: currentScopes(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        ...(consentGranted ? { buzzBudget } : {}),
      };
    };

    /**
     * The training-only fields of a succeeded snapshot — see
     * {@link MockGenerationScenario.trainedEpochs}. KIND-FAITHFUL, unlike the
     * rest of the money path: only a pass-through `training` /
     * `imageResourceTraining` body gets them, because only such a step produces
     * a checkpoint. Empty for every other body, so their snapshots are unchanged.
     */
    const trainingFields = (
      body: WorkflowBody,
    ): Pick<BlockWorkflowSnapshot, 'trainedEpochs' | 'publishedModel'> => {
      const $type = trainingStepType(body);
      if (!$type) return {};
      const count = Math.max(0, Math.floor(gen.trainedEpochs ?? 0));
      return {
        ...(count > 0
          ? {
              trainedEpochs: Array.from({ length: count }, (_, i) => ({
                $type,
                epochNumber: i + 1,
              })),
            }
          : {}),
        ...(gen.trainingPublishedModel ? { publishedModel: { ...gen.trainingPublishedModel } } : {}),
      };
    };

    const succeededSnapshot = (workflowId: string) => {
      const wf = workflows.get(workflowId);
      const cost = wf?.cost ?? legacyCost;
      const body = wf?.body ?? ({} as WorkflowBody);
      return {
        ...trainingFields(body),
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
        spentAccountType: preferredAccountType(body) ?? primaryFunder(buzzBalance),
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
            imageIndexes?: number[];
            imageIds?: number[];
            title?: string;
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
            versionId?: number | null;
            reason?: string;
            url?: string;
            imageId?: number;
            // SAVE_IMAGE `bytes` variant. `unknown`, not `ArrayBuffer`: the
            // gate's job is to refuse a non-buffer a block actually sent.
            bytes?: unknown;
            filename?: unknown;
            collectionId?: number;
            follow?: boolean;
            // CREATE_POST_FROM_APP. Typed `unknown` deliberately: this is an
            // UNTRUSTED inbound payload, and the handler's job is to refuse a
            // non-array exactly as the real host's gate does. Declaring it as
            // `BlockPostSource[]` here would assert the thing under test.
            sources?: unknown;
            // SUBMIT_WORKFLOW. `unknown`, NOT `string`, for the same reason as
            // `sources` above: the wire type says `string` but the gate's job is
            // to refuse what a block ACTUALLY sent, and a `string` annotation
            // here would assert the property under test — a block compiled
            // against an older SDK, or plain JS, can put anything in this field.
            idempotencyKey?: unknown;
            // PREPARE_TRAINING_DATASET. `unknown` for the same reason as
            // `sources`: the gate's job is to refuse what a block actually sent.
            items?: unknown;
            // ESTIMATE_WORKFLOW_BATCH. `unknown`: the list shape is what is checked.
            bodies?: unknown;
          };
        };

        options.onOutbound?.({ type: typed.type, payload: typed.payload });

        const requestId = typed.payload?.requestId;

        // ---- THE STORAGE SCOPE GATE — see ./mockHostScopes.ts ----
        //
        // The server's test is PRESENCE in the block's approved scope set, so an
        // UNDECLARED scope is refused before the backend is ever consulted. That
        // ordering is the point: it refuses even when the scenario, the quota and
        // the row budget would all have allowed the op, because production does.
        //
        // 🔴 IT SITS AHEAD OF THE SWITCH SO ONE RULE COVERS EVERY SURFACE. The
        // alternative — a check inside each of the 15 storage handlers — is the
        // shape that regenerates the same omission at every new site: a storage
        // message added later is governed the moment it joins the table in
        // `mockHostScopes.ts`, rather than whenever someone remembers to copy a
        // guard into its handler.
        {
          const needed = requiredStorageScope(typed.type);
          if (needed !== null && !declaredScopeSet.has(needed)) {
            const error = storageScopeDeniedMessage(typed.type, needed);
            dispatchToBlock({
              type: storageResultType(typed.type),
              payload: storageScopeDeniedPayload(typed.type, requestId, error),
            });
            return;
          }
        }

        // ---- THE IDEMPOTENCY-KEY FORMAT GATE — see ./mockHostIdempotency.ts ----
        //
        // The host's rule is a zod `.regex()` on the procedure INPUT, so it fires
        // BEFORE the procedure body — ahead of every scenario, budget and balance
        // decision below. That ordering is the point: a malformed key is refused
        // even when the scenario, the balance and the spend cap would all have
        // allowed the submit, because production refuses it then too.
        //
        // 🔴 IT SITS AHEAD OF THE SWITCH for the same reason the storage gate
        // does: one rule covering every surface, so a future money message that
        // gains an `idempotencyKey` is governed by joining the table rather than
        // by someone remembering to copy a check into its handler.
        {
          const refusal = governsIdempotencyKey(typed.type)
            ? idempotencyKeyRefusal(typed.payload)
            : null;
          if (refusal !== null) {
            dispatchToBlock({
              type: 'WORKFLOW_SUBMITTED',
              payload: {
                requestId,
                // The host's `errorSnapshot()` shape exactly (liveHost.ts:298):
                // the 'failed' sentinel id and NO `cost`, which is what makes
                // `submit()` reject as `'exception'` rather than resolving a
                // priced refusal. A tRPC input rejection reaches the block this
                // way, not as a throw — the reply crosses postMessage.
                snapshot: {
                  workflowId: 'failed',
                  status: 'failed',
                  error: idempotencyKeyDeniedMessage(refusal),
                },
              },
            });
            return;
          }
        }

        /**
         * The snapshot ONE estimate of `body` replies with. Shared by
         * ESTIMATE_WORKFLOW and ESTIMATE_WORKFLOW_BATCH so a batch cell is priced
         * exactly as a single estimate of the same body.
         */
        const estimateSnapshotFor = (body: WorkflowBody): BlockWorkflowSnapshot => {
          // UNUSABLE-ESTIMATE simulation (`generation.failEstimate`). Reproduces
          // the two real producers byte-for-byte so a block's `catch` around
          // `estimate()` is exercisable locally — see the knob's docs for why
          // that was previously impossible (civitai/civitai#4159).
          if (gen.failEstimate === 'failed') {
            // Mirrors the host's `failureSnapshot(err)` exactly: the 'failed'
            // sentinel id (a real one would be empty and get dropped by the
            // inbound validator), no `cost`.
            return {
              workflowId: 'failed',
              status: 'failed',
              error: gen.failEstimateMessage ?? 'mock: estimate failed',
            };
          }
          if (gen.failEstimate === 'no-cost') {
            // A SUCCESSFUL snapshot that simply has no price — no `error` to
            // explain it, which is what makes this producer the harder of the
            // two to diagnose from the block side.
            return { workflowId: 'wf_estimate', status: 'pending' };
          }
          // TRAINING ESTIMATE — KIND-FAITHFUL, the one exception to the
          // kind-agnostic rule above, because the real arm is not a priced
          // pass-through: it needs the spend scope, names a dataset the server
          // must hold, refuses a price above the per-run ceiling, and STORES a
          // quote the run is later checked against. Each refusal is the
          // server's message in the host's `failureSnapshot` shape.
          if (body.kind === 'training') {
            const refuse = (error: string): BlockWorkflowSnapshot => ({
              workflowId: 'failed',
              status: 'failed',
              error,
            });
            if (!consentGranted) return refuse(MOCK_TRAINING_SCOPE_ERROR);
            const imageCount = trainingDatasets.get(body.datasetId);
            if (imageCount === undefined) return refuse(MOCK_TRAINING_DATASET_GONE_ERROR);
            const total = trainingQuoteTotal;
            if (total > MOCK_TRAINING_BOUNDS.maxBuzzPerRun) {
              return refuse(
                `this training run costs ${total} Buzz, above the per-run limit of ${MOCK_TRAINING_BOUNDS.maxBuzzPerRun} for apps`,
              );
            }
            const quoteId = trainingHandle('tq_');
            const expiresAtMs = Date.now() + TRAINING_QUOTE_TTL_MS;
            trainingQuotes.set(quoteId, {
              datasetId: body.datasetId,
              total,
              expiresAtMs,
              spent: false,
            });
            return {
              workflowId: 'wf_estimate',
              status: 'pending',
              cost: { total },
              trainingQuote: {
                quoteId,
                total,
                imageCount,
                expiresAt: new Date(expiresAtMs).toISOString(),
              },
            };
          }
          return {
            workflowId: 'wf_estimate',
            status: 'pending',
            cost: { total: costFor(body) },
          };
        };

        switch (typed.type) {
          case 'REQUEST_TOKEN':
            dispatchToBlock({
              type: 'TOKEN_REFRESH_RESPONSE',
              payload: { ...(isRoutableRequestId(requestId) ? { requestId } : {}), token: nextToken() },
            });
            return;

          case 'REQUEST_CONSENT': {
            // TWO OUTCOMES, mirroring the real host's handler exactly (civitai
            // `PageBlockHost.tsx`): if anything is grantable-via-consent it
            // grants; otherwise it takes the un-grantable branch.
            //
            // 🔴 THE REFUSAL BRANCH IS THE POINT. Before `consentGrantable`
            // existed this handler ALWAYS granted, so a block author could not
            // reach a refusal in `pnpm dev` at all — and "the developer cannot
            // exercise this locally" is precisely how the contradictory-messages
            // bug reached production and survived there.
            if (!consentGrantable) {
              // Grantable set is empty. Distinguish the BENIGN case (the block
              // re-requested a scope it ALREADY holds → stay silent, in BOTH
              // channels: a refusal rendered over a permission that works is
              // worse than no message) from the UN-GRANTABLE case. Shared with
              // `createLiveHost` via ./consent.js so dev and prod cannot drift
              // on when this fires or what it names.
              const notice = resolveUngrantableConsentNotice(
                (typed.payload as unknown as { scopes?: unknown } | undefined)?.scopes,
                // The scopes the CURRENT token carries. Read through
                // `currentScopes()` rather than `nextToken()` — that helper MINTS
                // (it bumps `tokenSerial`), so calling it here would burn a
                // serial on a path that issues no token.
                currentScopes(),
                // Nothing is grantable — that is what `consentGrantable:false`
                // MEANS. Passing the empty set here (rather than short-circuiting)
                // keeps this call identical in shape to the host's.
                [],
              );
              if (!notice.notify) return;
              // Fire-and-forget PUSH, not a reply — REQUEST_CONSENT carries no
              // `requestId`. `scopes` may legitimately be `[]`.
              after(0, () => {
                dispatchToBlock({
                  type: 'CONSENT_UNAVAILABLE',
                  payload: consentUnavailablePayload(notice),
                });
              });
              return;
            }
            // Lazy-consent round-trip: grant what the hint named, then push a
            // host-initiated TOKEN_REFRESH carrying it (the App's auto-resume
            // depends on seeing the new scope on its token).
            //
            // `scopes` is untrusted block input (it is where markup and 5 KB
            // strings arrive), so it is filtered to the known vocabulary exactly
            // as the refusal payload is — `isKnownBlockScope` is the same
            // predicate both branches use.
            //
            // 🔴 `consentGranted` IS THE MONEY FLAG, SO IT IS GRANTED ONLY WHEN
            // ASKED FOR. It puts `ai:write:budgeted` AND `buzzBudget` on every
            // token this host mints from here on. Setting it unconditionally
            // meant a `posts:write:self` request also handed out the money
            // scope, which made the PARTIAL-GRANT case — the viewer granting the
            // one permission the block asked for and nothing else — unreachable
            // in `pnpm dev`, so every local run exercised the one shape that
            // hides a missing-scope bug.
            //
            // ⚠️ THE `!granted.length` FALLBACK IS LOAD-BEARING, not tidiness:
            // `requestConsent()` with NO payload is documented as legitimate (the
            // real host already knows the missing set it computed at mint), and
            // so is a hint that survives no filtering. Both must keep granting
            // the default money scope, which is the pre-existing behaviour — a
            // grant branch that granted nothing at all would be a silent dead
            // end of exactly the kind `consentGrantable` was added to remove.
            {
              const hint = (typed.payload as unknown as { scopes?: unknown } | undefined)
                ?.scopes;
              const granted = Array.isArray(hint)
                ? hint.filter((s): s is string => typeof s === 'string' && isKnownBlockScope(s))
                : [];
              if (granted.length === 0 || granted.includes(BUDGETED_SCOPE)) {
                consentGranted = true;
              }
              for (const s of granted) {
                if (s !== BUDGETED_SCOPE) extraGrantedScopes.add(s);
              }
            }
            after(0, () => {
              dispatchToBlock({ type: 'TOKEN_REFRESH', payload: { token: nextToken() } });
            });
            return;
          }

          case 'REQUEST_SIGN_IN':
            // The real host opens its login UI; nothing to reply.
            return;

          case 'ESTIMATE_WORKFLOW': {
            // KIND-AGNOSTIC money path: EVERY WorkflowBody member — `textToImage`,
            // `step`, and both arms of `customComfy` (the RECIPE arm naming a
            // server-registered recipe AND the INLINE arm carrying the block's own
            // ComfyUI graph, `mode:'inline'`) — is handled by the SAME
            // estimate/submit/poll code, exactly as the real host forwards
            // any body to the orchestrator uniformly. `costFor` /
            // `preferredAccountType` normalize across the union, so NOTHING here
            // may narrow on `body.kind` or touch textToImage-only fields
            // (`modelId`/`params.prompt`) — a customComfy body must flow through
            // unchanged, graph included. The recipe id is NEVER validated against
            // a registry (that's server-only); the mock accepts any id, fail-open. The
            // sentinel `workflowId` is non-empty so the snapshot survives the
            // SDK inbound validator (which drops empty-workflowId snapshots).
            // The pricing itself is `estimateSnapshotFor`, shared with the batch.
            const body = typed.payload?.body ?? ({} as WorkflowBody);
            dispatchToBlock({
              type: 'ESTIMATE_RESULT',
              payload: { requestId, snapshot: estimateSnapshotFor(body) },
            });
            return;
          }

          case 'ESTIMATE_WORKFLOW_BATCH': {
            // The batch twin of ESTIMATE_WORKFLOW, in the host's order: the
            // request shape, then the list, then each cell through
            // `estimateSnapshotFor` — the function ESTIMATE_WORKFLOW prices with,
            // so a cell is priced exactly as one estimate of that body would be.
            // Nothing is submitted and no Buzz moves.
            if (!isRoutableRequestId(requestId)) return;
            const mode = gen.batchEstimate ?? 'supported';
            // A host that predates the message sends nothing at all.
            if (mode === 'silent') return;
            if (mode === 'unsupported') {
              dispatchToBlock({
                type: 'ESTIMATE_BATCH_RESULT',
                payload: { requestId, error: 'unsupported on this host' },
              });
              return;
            }
            const bodies: unknown = typed.payload?.bodies;
            if (!Array.isArray(bodies) || bodies.length === 0) {
              dispatchToBlock({
                type: 'ESTIMATE_BATCH_RESULT',
                payload: { requestId, error: 'invalid estimate batch' },
              });
              return;
            }
            if (bodies.length > MOCK_ESTIMATE_BATCH_MAX_CELLS) {
              dispatchToBlock({
                type: 'ESTIMATE_BATCH_RESULT',
                payload: { requestId, error: 'estimate batch too large' },
              });
              return;
            }
            const snapshots = (bodies as WorkflowBody[]).map((cell): BlockWorkflowSnapshot => {
              // The server refuses a training cell in a batch: a training
              // estimate stores the quote the viewer later confirms, so it is
              // estimated on its own. Refused BEFORE `estimateSnapshotFor`, which
              // would store one.
              if (cell?.kind === 'training') {
                return {
                  workflowId: 'failed',
                  status: 'failed',
                  error: MOCK_TRAINING_IN_BATCH_ERROR,
                };
              }
              return estimateSnapshotFor(cell ?? ({} as WorkflowBody));
            });
            // The server's aggregate rule: the cells that priced, i.e. not
            // `'failed'` and carrying a numeric `cost.total`.
            let total = 0;
            let pricedCells = 0;
            for (const snapshot of snapshots) {
              if (snapshot.status === 'failed' || typeof snapshot.cost?.total !== 'number') continue;
              total += snapshot.cost.total;
              pricedCells += 1;
            }
            dispatchToBlock({
              type: 'ESTIMATE_BATCH_RESULT',
              payload: {
                requestId,
                snapshots,
                aggregate: { total, pricedCells, cellCount: snapshots.length },
              },
            });
            return;
          }

          case 'SUBMIT_WORKFLOW': {
            // Kind-agnostic (see ESTIMATE_WORKFLOW): a `customComfy` body drives
            // the identical submit → poll → terminal lifecycle on EITHER arm, and
            // honors the same generation/buzz scenario config (failRate/failNext/
            // insufficient/latencyMs). spentAccountType comes from
            // `params.accountType` on a RECIPE body; an INLINE body carries no
            // account preference (see `preferredAccountType`), so it falls back to
            // the largest-wallet stamp. No recipe-registry validation.
            submitCount += 1;
            const body = typed.payload?.body ?? ({} as WorkflowBody);

            // A `kind: 'training'` body is never started by SUBMIT_WORKFLOW: the
            // server charges a training run only against a quote a signed-in
            // session confirmed, which only RUN_TRAINING's dialog records. The
            // server's own refusal, in the host's `failureSnapshot` shape.
            // (`useBuzzWorkflow().submit()` refuses before sending; this covers a
            // raw transport send.)
            if (body.kind === 'training') {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: 'failed',
                    status: 'failed',
                    error:
                      'this training run has not been confirmed by the viewer in this session',
                  },
                },
              });
              return;
            }
            const cost = costFor(body);

            // CAUGHT-SERVER-EXCEPTION simulation (`generation.failSubmitException`).
            // Reproduces the host's `failureSnapshot(err)` byte-for-byte: the
            // 'failed' sentinel id and NO `cost`, which is what separates an
            // errored submit from a priced budget rejection
            // (civitai/civitai-app-starters#251). Checked FIRST — a host-side
            // throw pre-empts every server-side decision below.
            if (gen.failSubmitException === true) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: 'failed',
                    status: 'failed',
                    error: gen.failSubmitExceptionMessage ?? 'mock: submit failed',
                  },
                },
              });
              return;
            }

            // Disallowed-account path (content-rating clamp): the real backend
            // rejects a picked pool outside the app's maturity policy at the
            // currency-resolution boundary — BEFORE any Buzz spend — so this is
            // checked first. Surfaces as a `failed` snapshot (mirrors how a
            // submit tRPC BAD_REQUEST becomes an errorSnapshot in createLiveHost).
            const pickedAccount = preferredAccountType(body);
            if (pickedAccount && disallowedAccounts.has(pickedAccount)) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    workflowId: 'failed',
                    status: 'failed',
                    // 🔴 DELIBERATELY NO `cost`, and the `'failed'` sentinel id —
                    // the host's `failureSnapshot(err)` shape exactly, so
                    // `submit()` rejects with code `'exception'`
                    // (civitai/civitai-app-starters#251). The real backend raises
                    // a tRPC BAD_REQUEST at the currency-resolution boundary,
                    // which the host catches into `failureSnapshot(err)` — an
                    // errored submit with no quote, not a priced refusal. A block
                    // reads the reason from `err.snapshot.error`.
                    error: disallowedAccountError(pickedAccount),
                  },
                },
              });
              return;
            }

            // Spend-CAP refusal (`generation.submitCapRefusal`). The server
            // checks its caps (per-call budget, daily, consent, per-app, dev
            // session) BEFORE it asks the orchestrator to debit, so this comes
            // ahead of the out-of-Buzz path below.
            if (gen.submitCapRefusal !== undefined) {
              dispatchToBlock({
                type: 'WORKFLOW_SUBMITTED',
                payload: {
                  requestId,
                  snapshot: {
                    // The server stamps this `'failed'` sentinel on every cap
                    // refusal (a refused submit has no orchestrator id).
                    workflowId: 'failed',
                    status: 'failed',
                    // 🔴 THE PRICE IS LOAD-BEARING. The real server quotes the
                    // cost it refused to charge at every cap exit, and `cost`
                    // presence is what makes `submit()` RESOLVE this rather than
                    // reject it as an errored submit
                    // (civitai/civitai-app-starters#251). Do not drop it.
                    cost: { total: cost },
                    error:
                      gen.submitCapRefusal === true
                        ? DEFAULT_SUBMIT_CAP_REFUSAL
                        : gen.submitCapRefusal,
                  },
                },
              });
              return;
            }

            // OUT-OF-BUZZ path: legacy failMode, the buzz scenario's force
            // flag, OR a simulated balance that can't cover this gen.
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
                    workflowId: 'failed',
                    status: 'failed',
                    // 🔴 DELIBERATELY NO `cost` — the host's `failureSnapshot(err)`
                    // shape exactly, so `submit()` REJECTS with code
                    // `'exception'`. That is what production sends when a viewer
                    // is out of Buzz. The orchestrator answers the real submit
                    // with a 403. civitai's `throwOrchestratorFailure` maps that
                    // to `throwInsufficientFundsError`, a thrown `BAD_REQUEST`.
                    // `blocks.submitWorkflow`'s catch refunds the reservation and
                    // rethrows it, and the iframe host's SUBMIT_WORKFLOW handler
                    // catches the mutation's rejection into `failureSnapshot(err)`,
                    // which has no `cost`.
                    //
                    // This arm used to carry `cost` and RESOLVE, on the theory
                    // that out-of-Buzz was one of the server's priced cap
                    // refusals. It is not: those caps compare against a budget,
                    // not the wallet, and only they quote a price. A block
                    // tested against the old shape built a "resolved refusal →
                    // top-up" flow that production never reaches. Do not add a
                    // `cost` back; the priced arm is `submitCapRefusal` above.
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
                    workflowId: 'failed',
                    status: 'failed',
                    // 🔴 DELIBERATELY NO `cost`, and the `'failed'` sentinel id —
                    // together they are the host's `failureSnapshot(err)` shape
                    // exactly, so `submit()` rejects with code `'exception'`
                    // (civitai/civitai-app-starters#251). The id matters as much
                    // as the missing cost: a made-up id like `wf_fail_3` would
                    // classify as `'workflow-failed'`, i.e. as a workflow that
                    // probably exists with possibly-committed spend — a
                    // materially different thing to teach a block author.
                    //
                    // 🔴 THIS KNOB MODELS A THROWN SERVER ERROR, NOT "generation
                    // failed". The backend DOES have generic transient submit
                    // failures — a fail-closed `unavailable` deny and a
                    // missing-price-quote exit — but it returns those as PRICED,
                    // RESOLVING snapshots. Simulate those with `submitCapRefusal`
                    // and the server's text; do not read this branch as covering
                    // them.
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
            // A purchase ends EVERY forced out-of-Buzz state, not just the `buzz`
            // group's flag: `failMode: 'insufficient' | 'all'` is documented as
            // the same knob, and leaving it set made `?fail=insufficient` loop
            // reject → top-up → reject. `'some'` is a generic failure, not a
            // wallet, so a purchase leaves it alone.
            buzz.insufficient = false;
            if (failMode === 'insufficient' || failMode === 'all') failMode = 'none';
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
            if (!isRoutableRequestId(requestId)) return;
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
            if (!isRoutableRequestId(requestId)) return;
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
            if (!isRoutableRequestId(requestId)) return;
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
            if (!isRoutableRequestId(requestId)) return;
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
            if (!isRoutableRequestId(requestId)) return;
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
            if (!isRoutableRequestId(requestId)) return;
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

          case 'QUERY_APP_WORKFLOWS': {
            // App generator SUBQUEUE read. Drop a request with no requestId
            // (unroutable). A forced error replies with the FREE-TEXT error
            // variant (mirrors the real host forwarding err.message).
            if (!isRoutableRequestId(requestId)) return;
            if (appWorkflowsError !== undefined) {
              dispatchToBlock({
                type: 'APP_WORKFLOWS_RESULT',
                payload: { requestId, error: appWorkflowsError },
              });
              return;
            }
            dispatchToBlock({
              type: 'APP_WORKFLOWS_RESULT',
              payload: {
                requestId,
                result: { workflows: appWorkflows.workflows, cursor: appWorkflows.cursor },
              },
            });
            return;
          }

          case 'CANCEL_APP_WORKFLOW': {
            // Cancel ONE workflow in the app subqueue. Drop a request with no
            // requestId or a missing/empty workflowId (mirrors the real host
            // dropping those without a reply). A forced error replies with the
            // FREE-TEXT error variant (mirrors a FORBIDDEN / transport failure).
            if (!isRoutableRequestId(requestId)) return;
            const cancelId = typed.payload?.workflowId;
            if (typeof cancelId !== 'string' || cancelId.length === 0) return;
            if (appWorkflowsError !== undefined) {
              dispatchToBlock({
                type: 'CANCEL_APP_WORKFLOW_RESULT',
                payload: { requestId, error: appWorkflowsError },
              });
              return;
            }
            // Mark the matching row canceled IN PLACE (so a follow-up QUERY
            // reflects it) and reply with the terminal projection. When the id
            // isn't in the current page, synthesize a canceled projection — the
            // real host returns the re-read terminal workflow regardless.
            const existing = appWorkflows.workflows.find((w) => w.workflowId === cancelId);
            const canceled: AppWorkflow = existing
              ? { ...existing, status: 'canceled' }
              : { workflowId: cancelId, status: 'canceled', images: [], cost: null, createdAt: new Date().toISOString() };
            appWorkflows = {
              ...appWorkflows,
              workflows: appWorkflows.workflows.map((w) =>
                w.workflowId === cancelId ? canceled : w,
              ),
            };
            dispatchToBlock({
              type: 'CANCEL_APP_WORKFLOW_RESULT',
              payload: { requestId, result: { workflow: canceled } },
            });
            return;
          }

          case 'SET_COLLECTION_FOLLOW': {
            // Follow / unfollow a collection for the viewer. Drop a request with
            // no requestId (unroutable) — same as every REQUEST-style handler.
            if (!isRoutableRequestId(requestId)) return;
            if (collectionFollowError !== undefined) {
              dispatchToBlock({
                type: 'COLLECTION_FOLLOW_RESULT',
                payload: { requestId, error: collectionFollowError },
              });
              return;
            }
            // Mirror the real host's payload gate (`resolveCollectionFollowRequest`):
            // a positive-integer `collectionId` and a boolean `follow`, refused
            // as `invalid-request` rather than coerced. Without this a block bug
            // (a numeric string id, say) would WORK in dev:mock and be refused
            // in production — the exact drift a mock exists to prevent.
            const collectionId = typed.payload?.collectionId;
            const follow = typed.payload?.follow;
            if (
              typeof collectionId !== 'number' ||
              !Number.isInteger(collectionId) ||
              collectionId <= 0 ||
              typeof follow !== 'boolean'
            ) {
              dispatchToBlock({
                type: 'COLLECTION_FOLLOW_RESULT',
                payload: { requestId, error: 'invalid-request' },
              });
              return;
            }
            dispatchToBlock({
              type: 'COLLECTION_FOLLOW_RESULT',
              payload: { requestId, result: { collectionId, followed: follow } },
            });
            return;
          }

          case 'CREATE_POST_FROM_APP': {
            // Publish a REAL Post on the viewer's profile from the app's own
            // outputs. Drop a request with no requestId (unroutable) — same as
            // every REQUEST-style handler, and the ONLY safe drop: after the id
            // is known, every path must reply or the block hangs TEN MINUTES.
            if (!isRoutableRequestId(requestId)) return;
            if (createPostError !== undefined) {
              dispatchToBlock({
                type: 'CREATE_POST_RESULT',
                payload: { requestId, error: createPostError },
              });
              return;
            }
            // Mirror the real host's payload gate (`resolveCreatePostRequest`):
            // `sources` must be a NON-EMPTY array, refused as `no images to
            // post` rather than coerced. Without this a block bug (an empty
            // selection, say) would WORK in the mock and be refused in
            // production — the exact drift a mock exists to prevent.
            const sources = typed.payload?.sources;
            if (!Array.isArray(sources) || sources.length === 0) {
              dispatchToBlock({
                type: 'CREATE_POST_RESULT',
                payload: { requestId, error: 'no images to post' },
              });
              return;
            }
            // `published` sources: the server's `resolveAppPublishedImages`
            // refusals, verbatim. Ids are de-duplicated and non-positive /
            // non-integer ones dropped first; none left → `no valid image ids
            // in a published source`. Then ONE message for "unknown", "not this
            // app's" (a picked upload is unstamped) and "already in a post", so
            // the reply is no existence oracle. Refused, never skipped.
            const adopted: number[] = [];
            for (const source of sources as Array<{ kind?: unknown; imageIds?: unknown }>) {
              if (source?.kind !== 'published') continue;
              const raw = Array.isArray(source.imageIds) ? source.imageIds : [];
              const ids = [...new Set(raw)].filter(
                (n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0,
              );
              const refusal =
                ids.length === 0
                  ? 'no valid image ids in a published source'
                  : ids.some((id) => !postableImageIds.has(id))
                    ? 'an image is not available to post'
                    : undefined;
              if (refusal !== undefined) {
                dispatchToBlock({ type: 'CREATE_POST_RESULT', payload: { requestId, error: refusal } });
                return;
              }
              adopted.push(...ids);
            }
            // Posted: the adopted images now have a `postId`, so never again.
            for (const id of adopted) postableImageIds.delete(id);
            dispatchToBlock({
              type: 'CREATE_POST_RESULT',
              payload: { requestId, result: { ...createPostResult } },
            });
            return;
          }

          case 'PREPARE_TRAINING_DATASET': {
            // The host's gate order (`prepareTrainingDatasetGate.ts`): no
            // requestId → drop; signed-out → `sign in to train`; items outside
            // the server's schema → `invalid training dataset`, before any call.
            // Then the server: the spend scope, then the dataset.
            if (!isRoutableRequestId(requestId)) return;
            const reply = (payload: Record<string, unknown>) =>
              dispatchToBlock({ type: 'TRAINING_DATASET_RESULT', payload: { requestId, ...payload } });
            if (viewer === null) return reply({ error: 'sign in to train' });
            const items = typed.payload?.items;
            if (!isValidTrainingDatasetItems(items)) {
              return reply({ error: 'invalid training dataset' });
            }
            if (!consentGranted) return reply({ error: MOCK_TRAINING_SCOPE_ERROR });
            if (trainingDatasetError !== undefined) return reply({ error: trainingDatasetError });
            const named = new Set((items as Array<{ imageId: number }>).map((it) => it.imageId));
            const rejected = trainingDatasetRejected
              .filter((r) => named.has(r.imageId))
              .map(({ imageId, reason }) => ({ imageId, reason }));
            const rejectedIds = new Set(rejected.map((r) => r.imageId));
            const count = [...named].filter((id) => !rejectedIds.has(id)).length;
            if (count === 0) {
              // The server THROWS here, eligibility before import: an `import-*`
              // rejection means that image PASSED eligibility, so the server
              // reached the import and refuses there.
              const anyImported = rejected.some((r) => r.reason.startsWith('import-'));
              return reply({
                error: anyImported
                  ? MOCK_TRAINING_NONE_IMPORTED_ERROR
                  : MOCK_TRAINING_NONE_ELIGIBLE_ERROR,
              });
            }
            const datasetId = trainingHandle('tds_');
            trainingDatasets.set(datasetId, count);
            const result: BlockTrainingDatasetResult = { datasetId, count, rejected };
            return reply({ result });
          }

          case 'RUN_TRAINING': {
            // The host's gate (`runTrainingGate.ts`): no requestId → drop;
            // signed-out → `sign in to train`; not a `kind:'training'` body with
            // a `quoteId` → `invalid training request`. Then the server: the
            // spend scope, then the quote (unknown, expired or already spent).
            if (!isRoutableRequestId(requestId)) return;
            const reply = (payload: Record<string, unknown>) =>
              dispatchToBlock({ type: 'TRAINING_RESULT', payload: { requestId, ...payload } });
            if (viewer === null) return reply({ error: 'sign in to train' });
            const raw = typed.payload?.body as unknown;
            const b =
              raw && typeof raw === 'object' && !Array.isArray(raw)
                ? (raw as Record<string, unknown>)
                : null;
            if (!b || b.kind !== 'training' || typeof b.quoteId !== 'string' || !b.quoteId) {
              return reply({ error: 'invalid training request' });
            }
            if (!consentGranted) return reply({ error: MOCK_TRAINING_SCOPE_ERROR });
            const quote = trainingQuotes.get(b.quoteId);
            if (!quote || quote.spent || Date.now() >= quote.expiresAtMs) {
              return reply({ error: MOCK_TRAINING_QUOTE_GONE_ERROR });
            }
            // Which outcomes consume the quote, modelled on the real flow: the
            // host's gate and consent dialog come first (quote kept); the
            // server's submit then claims the quote with a GETDEL
            // (`claimTrainingQuote`) BEFORE any of its own checks, so every
            // server outcome — a refusal, a body mismatch, a cap refusal,
            // `submission-unconfirmed`, a run — consumes it. The mock's check
            // ORDER below is its own; only the spent/kept split is the server's.
            if (runTrainingError !== undefined) {
              if (!PRE_CLAIM_RUN_TRAINING_ERRORS.has(runTrainingError)) quote.spent = true;
              return reply({ error: runTrainingError });
            }
            quote.spent = true;
            if (b.datasetId !== quote.datasetId) {
              return reply({
                error: 'the training body differs from the one that was quoted — estimate again',
              });
            }
            // The server's cap / availability refusals RESOLVE (refunded, no run
            // started) — after the quote was consumed above.
            if (runTrainingCapRefusal !== undefined) {
              return reply({
                snapshot: {
                  workflowId: 'failed',
                  status: 'failed',
                  cost: { total: quote.total },
                  error: runTrainingCapRefusal,
                },
              });
            }
            submitCount += 1;
            const workflowId = `wf_${submitCount}_${Date.now()}`;
            workflows.set(workflowId, {
              polls: 0,
              cost: quote.total,
              body: raw as WorkflowBody,
            });
            return reply({ snapshot: { workflowId, status: 'pending' } });
          }

          case 'PUBLISH_GENERATION_OUTPUTS': {
            // Publish selected outputs of one of the app's OWN workflows as bare,
            // real-scanned public Image rows. Drop a request with no requestId
            // (unroutable). A forced error replies with the FREE-TEXT error variant
            // (mirrors the real host forwarding err.message).
            if (!isRoutableRequestId(requestId)) return;
            if (publishError !== undefined) {
              dispatchToBlock({
                type: 'PUBLISH_RESULT',
                payload: { requestId, error: publishError },
              });
              return;
            }
            for (const id of publishImageIds) postableImageIds.add(id);
            dispatchToBlock({
              type: 'PUBLISH_RESULT',
              payload: { requestId, result: { imageIds: [...publishImageIds] } },
            });
            return;
          }

          case 'GET_IMAGES_BY_IDS': {
            // Per-viewer gated image read. Drop a request with no requestId
            // (unroutable). A forced error replies with the FREE-TEXT error variant
            // (mirrors the real host forwarding err.message). The canned images
            // include at least one `hidden` (no-url) entry so the block's
            // blurred/placeholder path is exercised.
            if (!isRoutableRequestId(requestId)) return;
            if (gatedImagesError !== undefined) {
              dispatchToBlock({
                type: 'IMAGES_RESULT',
                payload: { requestId, error: gatedImagesError },
              });
              return;
            }
            dispatchToBlock({
              type: 'IMAGES_RESULT',
              payload: { requestId, result: { images: gatedImages } },
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
            // The `bytes` variant (civitai/civitai#5639): no picker, the host's
            // admission rules in the host's order (./uploadBytes.ts), then the
            // forced refusal standing in for the server persist + scan.
            const bytesReq = resolveUploadBytesRequest(typed.payload ?? {});
            if (bytesReq.kind !== 'none') {
              if (!isRoutableRequestId(requestId)) return;
              const reply = (p: { selected: BlockUploadedImageInfo } | { error: string }) =>
                dispatchToBlock({ type: 'IMAGE_UPLOAD_RESULT', payload: { requestId, ...p } });
              if (bytesReq.kind === 'invalid') return reply({ error: UPLOAD_BYTES_INVALID_ERROR });
              const admitted = admitUploadBytes(bytesReq, uploadBytesWindow, Date.now());
              uploadBytesWindow = admitted.recent;
              if (!admitted.result.ok) return reply({ error: admitted.result.error });
              if (uploadImageBytesError !== undefined) return reply({ error: uploadImageBytesError });
              // A COPY, as production's structured-clone `postMessage` delivers it.
              options.onUploadImageBytes?.({
                bytes: bytesReq.bytes.slice(0),
                mimeType: admitted.result.type,
                filename: admitted.result.filename,
              });
              postableImageIds.add(uploadImageBytesResult.imageId);
              return reply({ selected: { ...uploadImageBytesResult } });
            }

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
                payload: { requestId, ok: false, error: APP_STORAGE_ERROR_REQUEST_FAILED },
              });
              return;
            }
            const sizeBytes = jsonByteSize(value);
            if (sizeBytes > valueCapBytes) {
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                payload: { requestId, ok: false, error: APP_STORAGE_ERROR_VALUE_TOO_LARGE },
              });
              return;
            }
            // Quota check: projected usage after this upsert.
            //
            // ⚠️ TWO KNOWN DIVERGENCES FROM THE HOST LIVE ON THIS ONE GATE,
            // and they run in OPPOSITE directions.
            //
            // 1. SHAPE — civitai/civitai-app-starters#345. The host's byte
            //    gates are `!isNonIncreasing`-guarded: a write whose stored
            //    bytes do not increase skips them even when the store is
            //    already over quota, which is how a block with no delete
            //    affordance gets back under the byte cap. This gate is
            //    unconditional, so `dev:mock` REFUSES a shrinking overwrite
            //    production would land. Restrictive: a local failure that is
            //    not real.
            //
            // 2. 🔴 UNIT — civitai/civitai-app-starters#347, and this is the
            //    dangerous one. `jsonByteSize` counts WIRE bytes; the host
            //    counts STORED bytes, `octet_length(value::jsonb::text)`.
            //    `jsonb`'s canonical text inserts a space after every `:` and
            //    every `,`, so stored > wire for every container — approaching
            //    1.5x for a long array. This gate therefore ADMITS writes
            //    production rejects. Permissive: a local pass that is not
            //    real, which is the direction that ships a bug.
            //
            // Neither is fixed here, and #347 is why #345 cannot be: mirroring
            // the host's gate requires the STORED unit, which this mock does
            // not have. A stored-size model guessed rather than measured would
            // be wrong in the permissive direction, i.e. no better than today
            // — so #347 asks for a fixture table of (value, host
            // `octet_length`) pairs first, and #345 lands on top of it.
            const existing = store.get(key);
            const existingBytes = existing ? jsonByteSize(existing.value) + key.length : 0;
            const projected = usedBytes() - existingBytes + sizeBytes + key.length;
            if (projected > quotaBytes) {
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                // The PER-USER message, not the app-wide one: `quotaBytes`
                // defaults to `APP_STORAGE_MAX_BYTES`, which is the per-(app,
                // viewer) clamp. The mock models no app-wide umbrella at all,
                // so it can never emit `APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED`
                // — a block still has to handle that string, and the only
                // place it is reachable is production.
                payload: { requestId, ok: false, error: APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED },
              });
              return;
            }
            // Row check, mirroring the host's `isInsert && rowCount + 1 >
            // USER_ROW_LIMIT` gate.
            //
            // 🔴 `isInsert` IS LOAD-BEARING, not a micro-optimisation. Without
            // it, a store sitting exactly AT the ceiling would refuse to
            // overwrite a key it already holds — and since only the owning
            // viewer can delete their own rows, an app whose UI has no delete
            // affordance would be permanently stuck with no way back under the
            // cap. The host is `isInsert`-guarded for the same reason.
            if (!existing && store.size + 1 > limitRows) {
              dispatchToBlock({
                type: 'APP_STORAGE_SET_RESULT',
                // Per-user again, and for the same reason as the byte gate
                // above: `limitRows` defaults to `APP_STORAGE_MAX_ROWS`.
                payload: { requestId, ok: false, error: APP_STORAGE_ERROR_USER_ROW_LIMIT },
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
                payload: {
                  requestId,
                  ok: false,
                  deleted: false,
                  error: APP_STORAGE_ERROR_REQUEST_FAILED,
                },
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

          case 'SHARED_GET': {
            const key = typed.payload?.key ?? '';
            if (sharedFailNext > 0) {
              sharedFailNext -= 1;
              dispatchToBlock({
                type: 'SHARED_GET_RESULT',
                payload: { requestId, item: null, error: 'SHARED_UNAVAILABLE' },
              });
              return;
            }
            const row = sharedStore.get(key);
            dispatchToBlock({
              type: 'SHARED_GET_RESULT',
              payload: { requestId, item: row ? sharedItemWire(row) : null },
            });
            return;
          }

          case 'SHARED_REPORT': {
            const key = typed.payload?.key ?? '';
            if (sharedFailNext > 0) {
              sharedFailNext -= 1;
              dispatchToBlock({
                type: 'SHARED_REPORT_RESULT',
                payload: { requestId, ok: false, error: 'SHARED_UNAVAILABLE' },
              });
              return;
            }
            // NOT_FOUND for a missing key (mirrors the server's row pre-check).
            if (!sharedStore.has(key)) {
              dispatchToBlock({
                type: 'SHARED_REPORT_RESULT',
                payload: { requestId, ok: false, error: 'NOT_FOUND' },
              });
              return;
            }
            // Filing a report does NOT hide the row (a moderator decides).
            dispatchToBlock({
              type: 'SHARED_REPORT_RESULT',
              payload: { requestId, ok: true },
            });
            return;
          }

          case 'SAVE_IMAGE': {
            // The mock host can't trigger a real browser download; it applies
            // the host's request-shape gate and, for `bytes`, the host's
            // CONTENT classifier (./saveBytes.ts), then acks so `useSaveImage()`
            // resolves. Exactly one of url / imageId / bytes must be present —
            // the same rule and string as the real host.
            if (!isRoutableRequestId(requestId)) return;
            const p = typed.payload ?? {};
            const saveReply = (r: { ok: true } | { ok: false; error: string }) =>
              dispatchToBlock({ type: 'SAVE_IMAGE_RESULT', payload: { requestId, ...r } });
            // The host's exact shape predicate (./saveBytes.ts) — including that
            // a non-empty-ArrayBuffer `bytes` is required, and that ANY non-null
            // url/imageId beside a `bytes` is ambiguous.
            const kind = saveImageRequestKind(p);
            if (kind === 'invalid') {
              return saveReply({ ok: false, error: SAVE_IMAGE_INVALID_REQUEST_ERROR });
            }
            if (saveImageError !== undefined) return saveReply({ ok: false, error: saveImageError });
            if (kind === 'bytes' && p.bytes instanceof ArrayBuffer) {
              // The host's `prepareSaveBytes` (./saveBytes.ts): size cap, clean
              // the name, classify on the CLEANED name, force the extension.
              const prepared = prepareSaveBytes({
                bytes: p.bytes,
                filename: typeof p.filename === 'string' ? p.filename : undefined,
              });
              if (!prepared.ok) return saveReply(prepared);
              // A COPY, as production's structured-clone `postMessage` delivers
              // it — the block keeps (and may keep mutating) its own buffer.
              options.onSaveBytes?.({
                bytes: p.bytes.slice(0),
                mimeType: prepared.type,
                filename: prepared.filename,
              });
            }
            return saveReply({ ok: true });
          }

          case 'SET_USER_CHECKPOINT': {
            // Persist the checkpoint override (mirrors the real host's
            // block_user_settings write). Accept a numeric versionId OR an
            // explicit null (clear); anything else is a bad-input NACK, same as
            // the real IframeHost. Without this reply `useCheckpointPicker().
            // persist()` hung to its 30s timeout under the mock host.
            if (!isRoutableRequestId(requestId)) return;
            const rawVersionId = typed.payload?.versionId;
            const versionId =
              rawVersionId === null
                ? null
                : typeof rawVersionId === 'number'
                  ? rawVersionId
                  : undefined;
            if (versionId === undefined) {
              dispatchToBlock({
                type: 'USER_CHECKPOINT_SET',
                payload: { requestId, ok: false, error: 'versionId must be a number or null' },
              });
              return;
            }
            dispatchToBlock({
              type: 'USER_CHECKPOINT_SET',
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

    // Merge theme into the init context. `currentTheme` (not the install-time
    // `theme`) so a `setTheme` before install, or a re-install after one, seeds
    // BLOCK_INIT with the value the harness last chose.
    // The default is a FAITHFUL `PageSlotContext`, not a `{ slotId }` stub: the
    // real `PageBlockHost.buildContext()` always sends slug/subPath/viewerUserId/
    // theme, so a fake that omits them lets a block compile against fields the
    // host really does provide while the harness silently proves nothing about
    // them — and, because the strengthened `isPageSlotContext` checks the fields
    // it asserts, a `{ slotId }` stub would not even narrow to a page context.
    const baseContext: BlockContext = options.context ?? {
      slotId: 'app.page',
      entityType: 'none',
      slug: 'mock-app',
      subPath: '',
      viewerUserId: viewer?.id ?? null,
      viewerUsername: viewer?.username ?? null,
      theme: currentTheme,
    };
    const context: BlockContext = hostContextWithTheme(baseContext, currentTheme);

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

    // The per-VIEWER narrowing. Clamped to the resolved ceiling (never wider),
    // and dropped entirely when there is no ceiling to clamp against — the same
    // two rules the real host's `projectBlockInitMaturity` applies.
    const resolvedViewerLevel: number | undefined =
      resolvedCeiling !== undefined &&
      typeof options.viewerBrowsingLevel === 'number' &&
      Number.isFinite(options.viewerBrowsingLevel) &&
      options.viewerBrowsingLevel >= 0
        ? resolvedCeiling & options.viewerBrowsingLevel
        : undefined;

    const initPayload: BlockInitPayload = {
      blockInstanceId,
      blockId,
      appId,
      token: nextToken(),
      context,
      settings: { publisherSettings: {}, userSettings: {} },
      viewer,
      theme: currentTheme,
      renderMode: 'iframe',
      ...(options.domain !== undefined ? { domain: options.domain } : {}),
      ...(resolvedCeiling !== undefined ? { maxBrowsingLevel: resolvedCeiling } : {}),
      ...(resolvedViewerLevel !== undefined
        ? { effectiveBrowsingLevel: resolvedViewerLevel }
        : {}),
    };

    after(0, () => dispatchToBlock({ type: 'BLOCK_INIT', payload: initPayload }));

    let torn = false;
    teardown = () => {
      if (torn) return;
      torn = true;
      installed = false;
      pushToBlock = null;
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
    if (patch.consentGrantable !== undefined) consentGrantable = patch.consentGrantable;
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
    if (patch.collectionFollowError !== undefined)
      collectionFollowError = patch.collectionFollowError;
    if (patch.createPostResult !== undefined) createPostResult = patch.createPostResult;
    if (patch.createPostError !== undefined) createPostError = patch.createPostError;
    if (patch.trainingDatasetRejected !== undefined) {
      trainingDatasetRejected = patch.trainingDatasetRejected;
    }
    // The training error knobs clear on an explicit `undefined` (key PRESENT in
    // the patch), so a harness can turn a refusal off without re-installing.
    if ('trainingDatasetError' in patch) trainingDatasetError = patch.trainingDatasetError;
    if (patch.trainingQuoteTotal !== undefined) trainingQuoteTotal = patch.trainingQuoteTotal;
    if ('runTrainingError' in patch) runTrainingError = patch.runTrainingError;
    if ('saveImageError' in patch) saveImageError = patch.saveImageError;
    if (patch.uploadImageBytesResult !== undefined) {
      uploadImageBytesResult = patch.uploadImageBytesResult;
    }
    if ('uploadImageBytesError' in patch) uploadImageBytesError = patch.uploadImageBytesError;
    if ('runTrainingCapRefusal' in patch) runTrainingCapRefusal = patch.runTrainingCapRefusal;
    if (patch.appWorkflows !== undefined) {
      appWorkflows = {
        workflows: patch.appWorkflows.workflows,
        cursor: patch.appWorkflows.cursor ?? null,
      };
    }
    if (patch.appWorkflowsError !== undefined)
      appWorkflowsError = normalizeAppWorkflowsError(patch.appWorkflowsError);
    if (patch.publishImageIds !== undefined) publishImageIds = patch.publishImageIds;
    if (patch.publishError !== undefined) publishError = normalizePublishError(patch.publishError);
    if (patch.gatedImages !== undefined) gatedImages = patch.gatedImages;
    if (patch.gatedImagesError !== undefined)
      gatedImagesError = normalizeGatedImagesError(patch.gatedImagesError);
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

  /**
   * Flip the mock host's SITE THEME and push a host-initiated `THEME_CHANGE`,
   * the way the real host does when a viewer toggles light/dark mid-session.
   *
   * This is the ONLY way a block author can exercise their live-theme handling
   * locally — without it `dev:mock` can only ever deliver a theme once, at
   * `BLOCK_INIT`, and a block that never re-reads it looks correct locally and
   * stays stuck in prod (the dev-host fidelity gap `hostHandlerParity` exists
   * to catch on the other direction).
   *
   * No-ops the push when not installed (the value still seeds the next
   * `BLOCK_INIT`), and skips a redundant push when the theme did not change —
   * mirroring the real host, whose effect only fires on a changed value.
   */
  function setTheme(next: Theme): void {
    if (currentTheme === next) return;
    currentTheme = next;
    pushToBlock?.({ type: 'THEME_CHANGE', payload: { theme: next } });
  }

  return { install, setScenario, setTheme, buzz: buzzHandle };
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
