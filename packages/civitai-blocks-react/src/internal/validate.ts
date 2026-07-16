/**
 * Trust-boundary shape validation for inbound `postMessage` payloads.
 *
 * Origin allowlisting in `IframeTransport.handleMessage` gates *who* can
 * send — these guards gate *what* the message contains. They're shape
 * checks, not schema validation: each guard asserts the fields downstream
 * code will dereference, nothing more. Anything that fails drops with a
 * `console.warn` instead of crashing, so a malformed message degrades the
 * affected feature without breaking the rest of the block.
 *
 * Keep these in lockstep with `BlockInitPayload` / `ParentToBlockMessage`
 * in `@civitai/app-sdk/blocks` AND with the host implementation in
 * civitai/civitai's `src/components/AppBlocks/IframeHost.tsx`. A new field
 * downstream code reads → a new check here.
 */

import type {
  BlockInitPayload,
  BlockWorkflowSnapshot,
  WrappedToken,
} from '@civitai/app-sdk/blocks';

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object';

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0;

/** Accepts an ISO 8601 string that `new Date()` can parse to a finite timestamp. */
function isParseableDateString(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0) return false;
  const ts = Date.parse(v);
  return Number.isFinite(ts);
}

/**
 * Shape check for the wrapped-token shape carried by `BLOCK_INIT.token`,
 * `TOKEN_REFRESH.payload.token`, and `TOKEN_REFRESH_RESPONSE.payload.token`.
 */
export function isValidWrappedToken(t: unknown): t is WrappedToken {
  if (!isObject(t)) return false;
  if (!isNonEmptyString(t.raw)) return false;
  if (!Array.isArray(t.scopes)) return false;
  if (!t.scopes.every((s): s is string => typeof s === 'string')) return false;
  if (!isParseableDateString(t.expiresAt)) return false;
  if (t.buzzBudget !== undefined && typeof t.buzzBudget !== 'number') return false;
  return true;
}

export function isValidBlockInitPayload(p: unknown): p is BlockInitPayload {
  if (!isObject(p)) return false;
  if (!isNonEmptyString(p.blockId)) return false;
  if (!isNonEmptyString(p.blockInstanceId)) return false;
  if (!isNonEmptyString(p.appId)) return false;
  if (p.renderMode !== 'iframe' && p.renderMode !== 'inline') return false;

  if (!isValidWrappedToken(p.token)) return false;

  if (!isObject(p.context)) return false;
  if (!isNonEmptyString(p.context.slotId)) return false;

  if (!isObject(p.settings)) return false;
  if (!isObject(p.settings.publisherSettings)) return false;
  if (!isObject(p.settings.userSettings)) return false;

  // `null` for anonymous viewers; otherwise { id, username, status? }.
  if (p.viewer !== null) {
    if (!isObject(p.viewer)) return false;
    if (typeof p.viewer.id !== 'number') return false;
    if (p.viewer.username !== null && typeof p.viewer.username !== 'string') return false;
    // `status` is OPTIONAL. The platform deliberately omits the viewer's coarse
    // ban/mute moderation state from BLOCK_INIT to third-party iframes for
    // privacy (civitai #2521). When present it must be one of the three values;
    // when absent (undefined) the init is still valid. Requiring it here
    // rejected every signed-in viewer's init from a #2521-minimized host.
    if (
      p.viewer.status !== undefined &&
      p.viewer.status !== 'active' &&
      p.viewer.status !== 'banned' &&
      p.viewer.status !== 'muted'
    ) {
      return false;
    }
  }

  if (p.theme !== 'light' && p.theme !== 'dark') return false;

  // Color-domain maturity (civitai #2670). Both OPTIONAL + additive: a host
  // that predates #2670 omits them (still valid). When present, shape-check so
  // a malformed value drops rather than poisoning `useDomainMaturity`. `domain`
  // is informational; the SFW decision is derived from `maxBrowsingLevel`.
  if (
    p.domain !== undefined &&
    p.domain !== null &&
    p.domain !== 'green' &&
    p.domain !== 'blue' &&
    p.domain !== 'red'
  ) {
    return false;
  }
  if (
    p.maxBrowsingLevel !== undefined &&
    (typeof p.maxBrowsingLevel !== 'number' || !Number.isFinite(p.maxBrowsingLevel))
  ) {
    return false;
  }

  return true;
}

const WORKFLOW_STATUSES = new Set<string>([
  'pending',
  'processing',
  'succeeded',
  'failed',
  'expired',
  'canceled',
]);

const AUTO_CLAIM_TYPES = new Set<string>(['dailyBoost']);
const AUTO_CLAIM_ACCOUNT_TYPES = new Set<string>(['yellow', 'blue', 'red', 'green']);

export function isValidWorkflowSnapshot(s: unknown): s is BlockWorkflowSnapshot {
  if (!isObject(s)) return false;
  if (!isNonEmptyString(s.workflowId)) return false;
  if (typeof s.status !== 'string' || !WORKFLOW_STATUSES.has(s.status)) return false;
  if (s.cost !== undefined) {
    if (!isObject(s.cost) || typeof s.cost.total !== 'number') return false;
  }
  if (s.imageUrls !== undefined) {
    if (!Array.isArray(s.imageUrls)) return false;
    if (!s.imageUrls.every((u): u is string => typeof u === 'string')) return false;
  }
  if (s.error !== undefined && typeof s.error !== 'string') return false;
  if (s.autoClaim !== undefined) {
    if (!isObject(s.autoClaim)) return false;
    if (typeof s.autoClaim.type !== 'string' || !AUTO_CLAIM_TYPES.has(s.autoClaim.type)) {
      return false;
    }
    if (typeof s.autoClaim.amount !== 'number' || !Number.isFinite(s.autoClaim.amount)) {
      return false;
    }
    if (
      typeof s.autoClaim.accountType !== 'string' ||
      !AUTO_CLAIM_ACCOUNT_TYPES.has(s.autoClaim.accountType)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Host-pushed token rotation. No `requestId` field; the host is the initiator.
 * Carries the same wrapped-token shape as the reply path.
 */
export function isValidTokenRefresh(
  p: unknown,
): p is { token: WrappedToken } {
  if (!isObject(p)) return false;
  if (!isValidWrappedToken(p.token)) return false;
  return true;
}

/**
 * Reply to a block-initiated `REQUEST_TOKEN`. `requestId` is optional — the
 * platform's IframeHost.tsx echoes it back when supplied, omits it otherwise.
 */
export function isValidTokenRefreshResponse(
  p: unknown,
): p is { token: WrappedToken; requestId?: string } {
  if (!isObject(p)) return false;
  if (!isValidWrappedToken(p.token)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  return true;
}

export function isValidWorkflowReply(
  p: unknown,
): p is { snapshot: BlockWorkflowSnapshot; requestId?: string } {
  if (!isObject(p)) return false;
  if (!isValidWorkflowSnapshot(p.snapshot)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  return true;
}

export function isValidBuzzPurchaseResult(
  p: unknown,
): p is { purchased: boolean; newBalance?: number; requestId?: string } {
  if (!isObject(p)) return false;
  if (typeof p.purchased !== 'boolean') return false;
  if (p.newBalance !== undefined && typeof p.newBalance !== 'number') return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  return true;
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Reply to a block-initiated `GET_BUZZ_BALANCE`. A well-formed reply carries
 * EITHER a `balance` ({ blue, green, yellow } — each a finite number) OR an
 * `error` string; one with neither is malformed and dropped. Mirrors the
 * `APP_STORAGE_GET_RESULT` value-or-error convention.
 */
export function isValidBuzzBalanceResult(
  p: unknown,
): p is {
  balance?: { blue: number; green: number; yellow: number };
  error?: string;
  requestId?: string;
} {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.balance !== undefined) {
    if (!isObject(p.balance)) return false;
    if (!isFiniteNumber(p.balance.blue)) return false;
    if (!isFiniteNumber(p.balance.green)) return false;
    if (!isFiniteNumber(p.balance.yellow)) return false;
  }
  // A reply must resolve to something — either the balance or an error.
  if (p.balance === undefined && p.error === undefined) return false;
  return true;
}

const VIEWER_STATUSES = new Set<string>(['active', 'muted']);

/**
 * Reply to a block-initiated `GET_VIEWER`. A well-formed reply carries EITHER a
 * `viewer` ({ id, username, status, buzzBudget }) OR a free-text `error`; one
 * with neither is malformed and dropped. Mirrors the `BUZZ_BALANCE_RESULT`
 * value-or-error convention.
 *
 * NULLABILITY (host PR #3152): `username` is `string | null` and `buzzBudget` is
 * `number | null` — both present-but-NULLABLE, not omitted. The guard MUST ACCEPT
 * `null` for both (the host returns `username: null` for a viewer with no handle,
 * `buzzBudget: null` when the token lacks the budget claim). Rejecting a valid
 * `null` is the exact too-strict-guard trap that hung `useBuzzTransactions` on the
 * null cursor — a dropped valid reply hangs the hook to its 30s timeout.
 */
export function isValidViewerResult(
  p: unknown,
): p is {
  viewer?: { id: number; username: string | null; status: string; buzzBudget: number | null };
  error?: string;
  requestId?: string;
} {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.viewer !== undefined) {
    const v = p.viewer;
    if (!isObject(v)) return false;
    if (!isFiniteNumber(v.id)) return false;
    // `username` is `string | null` — accept a string (any) OR null; reject only
    // other types (number/undefined/object).
    if (typeof v.username !== 'string' && v.username !== null) return false;
    if (typeof v.status !== 'string' || !VIEWER_STATUSES.has(v.status)) return false;
    // `buzzBudget` is `number | null` — accept a finite number OR null. Do NOT
    // reject null (see NULLABILITY above).
    if (!isFiniteNumber(v.buzzBudget) && v.buzzBudget !== null) return false;
  }
  // A reply must resolve to something — either the viewer or an error.
  if (p.viewer === undefined && p.error === undefined) return false;
  return true;
}

const CONTENT_RATINGS = new Set<string>(['g', 'pg', 'pg13', 'r', 'x']);

/** The moderated (`purpose:'display'`) `IMAGE_UPLOAD_RESULT.selected` shape. */
function isModeratedUpload(s: Record<string, unknown>): boolean {
  if (typeof s.imageId !== 'number' || !Number.isInteger(s.imageId) || s.imageId <= 0) return false;
  if (!isFiniteNumber(s.nsfwLevel)) return false;
  if (typeof s.contentRating !== 'string' || !CONTENT_RATINGS.has(s.contentRating)) return false;
  if (!isNonEmptyString(s.url)) return false;
  return true;
}

/**
 * The `purpose:'generationSource'` `IMAGE_UPLOAD_RESULT.selected` shape — an
 * UNSCANNED private img2img source `{ url, width, height }` (no imageId /
 * nsfwLevel). Mirrors civitai's `BlockSourceImageInfo`.
 */
function isGenerationSourceUpload(s: Record<string, unknown>): boolean {
  if (!isNonEmptyString(s.url)) return false;
  if (!isFiniteNumber(s.width) || s.width <= 0) return false;
  if (!isFiniteNumber(s.height) || s.height <= 0) return false;
  return true;
}

/**
 * The `asyncScan:true` (`purpose:'display'`) EARLY-RESOLVE `IMAGE_UPLOAD_RESULT.selected`
 * shape — a {@link BlockPendingImageInfo}: `status:'pending'`, a positive-integer
 * `imageId`, and a non-empty `url`. NOT yet scanned (author-preview-only) — the
 * verdict arrives later on `IMAGE_SCAN_RESOLVED`.
 */
function isPendingUpload(s: Record<string, unknown>): boolean {
  if (s.status !== 'pending') return false;
  if (typeof s.imageId !== 'number' || !Number.isInteger(s.imageId) || s.imageId <= 0) return false;
  if (!isNonEmptyString(s.url)) return false;
  return true;
}

/**
 * Reply to a block-initiated `OPEN_IMAGE_UPLOAD`. `selected` is ABSENT when the
 * user dismissed the upload modal (the block's hook resolves to `null`). When
 * present it is a UNION keyed by the request's `purpose`:
 *   • `'display'`  → the moderated `BlockUploadedImageInfo` (`imageId` a positive
 *     integer, `nsfwLevel` finite, `contentRating` a `g|pg|pg13|r|x` ladder
 *     value, `url` non-empty).
 *   • `'generationSource'` → the source `{ url, width, height }` (positive finite
 *     dimensions, non-empty url; no imageId/nsfwLevel).
 * The guard accepts EITHER shape (the result carries no purpose discriminator).
 * Kept in lockstep with the host's `IMAGE_UPLOAD_RESULT` (civitai/civitai
 * `PageBlockHost.tsx` / `BlockImageUploadModal.tsx` /
 * `BlockGenerationSourceUploadModal.tsx`).
 */
export function isValidImageUploadResult(
  p: unknown,
): p is {
  requestId?: string;
  selected?:
    | { imageId: number; nsfwLevel: number; contentRating: string; url: string }
    | { url: string; width: number; height: number }
    | { status: 'pending'; imageId: number; url: string };
} {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  // `selected` absent → cancelled upload (valid). When present, it must match
  // one of the purpose-keyed shapes (moderated / generationSource / pending).
  if (p.selected !== undefined) {
    const s = p.selected;
    if (!isObject(s)) return false;
    if (!isModeratedUpload(s) && !isGenerationSourceUpload(s) && !isPendingUpload(s)) return false;
  }
  return true;
}

/**
 * Host→block `IMAGE_SCAN_RESOLVED` — the async scan verdict for a pending
 * `'display'` upload (the `asyncScan:true` early-resolve path). Shape-checks the
 * correlation fields (`requestId` a non-empty string, `imageId` a positive
 * integer) + the discriminated `result` union the hook dereferences:
 *   • `'scanned'` → carries a moderated {@link BlockUploadedImageInfo} `image`
 *     (the ONLY verdict with a usable image).
 *   • `'blocked'` → optional `reason` string, no image.
 *   • `'error'`  → optional `message` string, no image.
 * A malformed / unknown-status verdict drops (the hook keeps awaiting / times out)
 * rather than crashing. Mirrors the host's `BlockImageScanPoller` verdict.
 */
export function isValidImageScanResolved(
  p: unknown,
): p is {
  requestId: string;
  imageId: number;
  result:
    | { status: 'scanned'; image: { imageId: number; nsfwLevel: number; contentRating: string; url: string } }
    | { status: 'blocked'; reason?: string }
    | { status: 'error'; message?: string };
} {
  if (!isObject(p)) return false;
  if (!isNonEmptyString(p.requestId)) return false;
  if (typeof p.imageId !== 'number' || !Number.isInteger(p.imageId) || p.imageId <= 0) return false;
  if (!isObject(p.result)) return false;
  const r = p.result;
  switch (r.status) {
    case 'scanned':
      return isObject(r.image) && isModeratedUpload(r.image);
    case 'blocked':
      return r.reason === undefined || typeof r.reason === 'string';
    case 'error':
      return r.message === undefined || typeof r.message === 'string';
    default:
      return false;
  }
}

/**
 * Reply to a block-initiated `SHARED_UPDATE`. A well-formed reply carries a
 * boolean `ok` and an optional `error` string (set on `NOT_FOUND` / `FORBIDDEN`
 * / a belt/size rejection). Mirrors the `SHARED_WITHDRAW_RESULT` ok/error
 * convention — the block's hook treats `!ok || error` as the reject signal.
 */
export function isValidSharedUpdateResult(
  p: unknown,
): p is { ok: boolean; error?: string; requestId?: string } {
  if (!isObject(p)) return false;
  if (typeof p.ok !== 'boolean') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  return true;
}

/**
 * A value the block-side hooks will rehydrate to a `Date`: EITHER a `Date`
 * instance OR an ISO-8601 string `new Date()` parses to a finite timestamp.
 *
 * The buzz self-read bridges need this both-ways tolerance because the host
 * forwards the RAW tRPC `result` over a structured-clone `postMessage` (it does
 * NOT `.toISOString()`-map it the way the `SHARED_LIST` bridge does), so
 * `cursor` + each transaction's `date` arrive as a `Date` INSTANCE today. A
 * string-only guard would DROP every real reply → the hook would hang.
 */
function isDateLike(v: unknown): boolean {
  if (v instanceof Date) return Number.isFinite(v.getTime());
  return isParseableDateString(v);
}

/**
 * Reply to a block-initiated `GET_BUZZ_TRANSACTIONS`. A well-formed reply carries
 * EITHER a `result` ({ transactions[], cursor? }) OR a free-text `error`; one with
 * neither is malformed and dropped. Each transaction row is shape-checked to the
 * fields the hook dereferences (`date` date-like, `type` string, `amount` finite),
 * so a malformed row drops the whole reply rather than yielding a `NaN` date.
 */
export function isValidBuzzTransactionsResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.result !== undefined) {
    const r = p.result;
    if (!isObject(r)) return false;
    // `cursor` is `z.coerce.date().nullish()` server-side: `null` is a REAL
    // value the host returns verbatim on the last/only page (any viewer with
    // ≤ limit transactions gets it on the FIRST fetch). Accept `null`/`undefined`
    // (the hook's `toIso` maps both to `cursor: null`); only a present-but-
    // non-date-like cursor is malformed.
    if (r.cursor != null && !isDateLike(r.cursor)) return false;
    if (!Array.isArray(r.transactions)) return false;
    for (const t of r.transactions) {
      if (!isObject(t)) return false;
      if (!isDateLike(t.date)) return false;
      if (typeof t.type !== 'string') return false;
      if (!isFiniteNumber(t.amount)) return false;
    }
  }
  if (p.result === undefined && p.error === undefined) return false;
  return true;
}

/**
 * Reply to a block-initiated `GET_BUZZ_ACCOUNTS`. A well-formed reply carries
 * EITHER a `result` ({ accounts[] }, each `{ accountType: string, balance: finite }`)
 * OR a free-text `error`.
 */
export function isValidBuzzAccountsResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.result !== undefined) {
    const r = p.result;
    if (!isObject(r)) return false;
    if (!Array.isArray(r.accounts)) return false;
    for (const a of r.accounts) {
      if (!isObject(a)) return false;
      if (typeof a.accountType !== 'string') return false;
      if (!isFiniteNumber(a.balance)) return false;
    }
  }
  if (p.result === undefined && p.error === undefined) return false;
  return true;
}

/**
 * Reply to a block-initiated `GET_DAILY_COMPENSATION`. A well-formed reply carries
 * EITHER a `result` ({ resources[], hasPublishedResources: boolean }) OR a
 * free-text `error`.
 */
export function isValidDailyCompensationResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.result !== undefined) {
    const r = p.result;
    if (!isObject(r)) return false;
    if (typeof r.hasPublishedResources !== 'boolean') return false;
    if (!Array.isArray(r.resources)) return false;
  }
  if (p.result === undefined && p.error === undefined) return false;
  return true;
}

const WILDCARD_PACK_ERROR_CODES = new Set<string>([
  'not-found',
  'forbidden',
  'too-large',
  'parse-failed',
  'busy',
]);

/**
 * Reply to a block-initiated `GET_WILDCARD_PACK`. A well-formed reply carries
 * EITHER a `pack` (shape-checked to the fields the hook reads — `modelVersionId`
 * a positive int, `lists` an object, `maturity.browsingLevel` finite) OR a
 * DISCRIMINATED `error` code (one of {@link WILDCARD_PACK_ERROR_CODES}); one with
 * neither, or an unknown `error` string, is malformed and dropped. Unlike the
 * buzz guards the error is NOT free-text — a rogue free-text error would drop the
 * reply, mirroring the host's enum contract.
 */
export function isValidWildcardPackResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined) {
    if (typeof p.error !== 'string' || !WILDCARD_PACK_ERROR_CODES.has(p.error)) return false;
  }
  if (p.pack !== undefined) {
    const pack = p.pack;
    if (!isObject(pack)) return false;
    if (typeof pack.modelVersionId !== 'number' || !Number.isInteger(pack.modelVersionId)) {
      return false;
    }
    if (!isObject(pack.lists)) return false;
    if (typeof pack.truncated !== 'boolean') return false;
    if (!Array.isArray(pack.truncatedLists)) return false;
    if (!isObject(pack.maturity)) return false;
    if (!isFiniteNumber(pack.maturity.browsingLevel)) return false;
    if (typeof pack.maturity.sfwOnly !== 'boolean') return false;
  }
  if (p.pack === undefined && p.error === undefined) return false;
  return true;
}

// ============================================================
// App generator SUBQUEUE reply validators
// ============================================================
//
// Kept in lockstep with civitai/civitai's `AppWorkflow` / `projectAppWorkflow`
// (`src/server/services/blocks/workflow.service.ts`, PR #3164) and the host's
// `APP_WORKFLOWS_RESULT` / `CANCEL_APP_WORKFLOW_RESULT` builders in
// `PageBlockHost.tsx`. Same value-or-error convention as the buzz bridges.

const APP_WORKFLOW_STATUSES = new Set<string>([
  'pending',
  'processing',
  'succeeded',
  'failed',
  'expired',
  'canceled',
]);

/**
 * Shape-check ONE {@link import('@civitai/app-sdk/blocks').AppWorkflow} row to the
 * fields the hook dereferences. Deliberately accepts the LEGITIMATE nullish the
 * host emits — an image's `width`/`height`/`nsfwLevel` and the workflow `cost` are
 * `number | null` — while rejecting the malformed (a `NaN`/string cost, a missing
 * url). Being too strict here (rejecting a valid `null`) is the trap that hangs the
 * hook to its transport timeout, so `null` is explicitly allowed everywhere it's
 * contractually valid.
 */
function isValidAppWorkflow(w: unknown): boolean {
  if (!isObject(w)) return false;
  if (!isNonEmptyString(w.workflowId)) return false;
  if (typeof w.status !== 'string' || !APP_WORKFLOW_STATUSES.has(w.status)) return false;
  // `cost` is `number | null` — accept a finite number OR null; reject other types.
  if (w.cost !== null && !isFiniteNumber(w.cost)) return false;
  if (!isParseableDateString(w.createdAt)) return false;
  if (!Array.isArray(w.images)) return false;
  for (const img of w.images) {
    if (!isObject(img)) return false;
    if (!isNonEmptyString(img.url)) return false;
    // width/height/nsfwLevel are each `number | null` — accept a finite number OR null.
    if (img.width !== null && !isFiniteNumber(img.width)) return false;
    if (img.height !== null && !isFiniteNumber(img.height)) return false;
    if (img.nsfwLevel !== null && !isFiniteNumber(img.nsfwLevel)) return false;
  }
  return true;
}

/**
 * Reply to a block-initiated `QUERY_APP_WORKFLOWS`. A well-formed reply carries
 * EITHER a `result` ({ workflows: AppWorkflow[], cursor: string | null }) OR a
 * free-text `error`; one with neither is malformed and dropped. `cursor` is
 * `string | null` — `null` is the REAL last/only-page value the host returns
 * verbatim (accept it; only a present-but-non-string-non-null cursor is malformed).
 * An EMPTY `workflows` array is valid (a fresh app with no generations).
 */
export function isValidAppWorkflowsResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.result !== undefined) {
    const r = p.result;
    if (!isObject(r)) return false;
    if (r.cursor !== null && typeof r.cursor !== 'string') return false;
    if (!Array.isArray(r.workflows)) return false;
    for (const w of r.workflows) {
      if (!isValidAppWorkflow(w)) return false;
    }
  }
  if (p.result === undefined && p.error === undefined) return false;
  return true;
}

/**
 * Reply to a block-initiated `CANCEL_APP_WORKFLOW`. A well-formed reply carries
 * EITHER a `result` ({ workflow: AppWorkflow }) OR a free-text `error` (FORBIDDEN /
 * transport); one with neither is malformed and dropped.
 */
export function isValidCancelAppWorkflowResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.result !== undefined) {
    const r = p.result;
    if (!isObject(r)) return false;
    if (!isValidAppWorkflow(r.workflow)) return false;
  }
  if (p.result === undefined && p.error === undefined) return false;
  return true;
}

// ============================================================
// Publish-outputs + gated-image reply validators
// ============================================================
//
// Kept in lockstep with civitai/civitai's `blocks.publishGenerationOutputs` /
// `blocks.getImagesByIds` return types + the host's `PUBLISH_RESULT` /
// `IMAGES_RESULT` builders. Same value-or-error convention as the buzz +
// app-subqueue bridges.

/**
 * Reply to a block-initiated `PUBLISH_GENERATION_OUTPUTS`. A well-formed reply
 * carries EITHER a `result` ({ imageIds: number[] } — each a finite number) OR a
 * free-text `error`; one with neither is malformed and dropped. Mirrors
 * `isValidAppWorkflowsResult`'s value-or-error structure.
 */
export function isValidPublishResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.result !== undefined) {
    const r = p.result;
    if (!isObject(r)) return false;
    if (!Array.isArray(r.imageIds)) return false;
    for (const id of r.imageIds) {
      if (!isFiniteNumber(id)) return false;
    }
  }
  if (p.result === undefined && p.error === undefined) return false;
  return true;
}

const GATED_IMAGE_STATUSES = new Set<string>(['visible', 'hidden']);

/**
 * Shape-check ONE {@link import('@civitai/app-sdk/blocks').BlockGatedImage} entry.
 * `imageId` is always a finite number and `status` one of `visible`/`hidden`.
 *  - `visible` → the full moderated projection (`nsfwLevel` finite,
 *    `contentRating` a `g|pg|pg13|r|x` ladder value, `url` a non-empty string,
 *    `width`/`height` each `number | null`).
 *  - `hidden`  → ONLY `imageId` + `status`. A `hidden` entry carrying a `url` is
 *    REJECTED — defense in depth against a buggy/hostile host leaking an
 *    unclamped url on an image the viewer isn't allowed to see.
 */
function isValidGatedImage(img: unknown): boolean {
  if (!isObject(img)) return false;
  if (!isFiniteNumber(img.imageId)) return false;
  if (typeof img.status !== 'string' || !GATED_IMAGE_STATUSES.has(img.status)) return false;
  if (img.status === 'visible') {
    if (!isFiniteNumber(img.nsfwLevel)) return false;
    if (typeof img.contentRating !== 'string' || !CONTENT_RATINGS.has(img.contentRating)) {
      return false;
    }
    if (!isNonEmptyString(img.url)) return false;
    // width/height are each `number | null` — accept a finite number OR null.
    if (img.width !== null && !isFiniteNumber(img.width)) return false;
    if (img.height !== null && !isFiniteNumber(img.height)) return false;
    return true;
  }
  // status === 'hidden': ONLY imageId + status. A leaked `url` on a hidden entry
  // is the exact cross-user moderation-boundary breach this guard exists to catch.
  if ('url' in img) return false;
  return true;
}

/**
 * Reply to a block-initiated `GET_IMAGES_BY_IDS`. A well-formed reply carries
 * EITHER a `result` ({ images: BlockGatedImage[] }) OR a free-text `error`; one
 * with neither is malformed and dropped. Each image is shape-checked via
 * {@link isValidGatedImage} — a `hidden` entry that carries a `url` DROPS the whole
 * reply (defense in depth against a leaked unclamped url).
 */
export function isValidImagesResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.result !== undefined) {
    const r = p.result;
    if (!isObject(r)) return false;
    if (!Array.isArray(r.images)) return false;
    for (const img of r.images) {
      if (!isValidGatedImage(img)) return false;
    }
  }
  if (p.result === undefined && p.error === undefined) return false;
  return true;
}

// ============================================================
// App-storage (per-viewer KV) reply validators
// ============================================================
//
// Kept in lockstep with the host's `APP_STORAGE_*_RESULT` builders in
// civitai/civitai (`PageBlockHost.tsx` / `IframeHost.tsx`) and the SDK's
// `ParentToBlockMessage` union. Each guard asserts exactly the fields
// `useAppStorage` dereferences. NOTE (verified against the live host): every
// storage error path ALSO carries a zeroed/null success field (e.g.
// `APP_STORAGE_GET` sends `value:null` with its `error`, `QUOTA` sends the four
// numbers as `0`), so the guards SHORT-CIRCUIT on a present `error` — the hook
// throws on it before reading the success fields, so a zeroed error reply must
// not be dropped as "malformed".

/**
 * Reply to `APP_STORAGE_GET`. `value` is arbitrary JSON (incl. `null` for an
 * unset key / anon viewer), so there is nothing to type-check on it — the guard
 * only asserts the envelope: an object, a string `error` when present, and that
 * the reply resolves to SOMETHING (a `value` field OR an `error`).
 */
export function isValidAppStorageGetResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  // `value` may be any JSON value including `null`; a reply carrying neither a
  // `value` key nor an `error` is malformed (would silently resolve to `null`).
  if (!('value' in p) && p.error === undefined) return false;
  return true;
}

/** Reply to `APP_STORAGE_SET`. `ok` required; `sizeBytes` present only on success. */
export function isValidAppStorageSetResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (typeof p.ok !== 'boolean') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.sizeBytes !== undefined && !isFiniteNumber(p.sizeBytes)) return false;
  return true;
}

/** Reply to `APP_STORAGE_DELETE`. `ok` + `deleted` are always present (both success and error paths). */
export function isValidAppStorageDeleteResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (typeof p.ok !== 'boolean') return false;
  if (typeof p.deleted !== 'boolean') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  return true;
}

/**
 * Reply to `APP_STORAGE_LIST`. On success `keys` is an array of
 * `{ key, updatedAt }` (the hook rehydrates `updatedAt` via `new Date`, so it
 * must be date-like); the error path sends `keys: []` with an `error`.
 */
export function isValidAppStorageListResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.error !== undefined) return true; // hook throws before reading `keys`
  if (!Array.isArray(p.keys)) return false;
  for (const k of p.keys) {
    if (!isObject(k)) return false;
    if (!isNonEmptyString(k.key)) return false;
    if (!isDateLike(k.updatedAt)) return false;
  }
  if (p.nextCursor !== undefined && typeof p.nextCursor !== 'string') return false;
  return true;
}

/** Reply to `APP_STORAGE_QUOTA`. The four counters are finite numbers (error path zeroes them + adds `error`). */
export function isValidAppStorageQuotaResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.error !== undefined) return true; // hook throws before reading the counters
  if (!isFiniteNumber(p.usedBytes)) return false;
  if (!isFiniteNumber(p.rowCount)) return false;
  if (!isFiniteNumber(p.limitBytes)) return false;
  if (!isFiniteNumber(p.limitRows)) return false;
  return true;
}

// ============================================================
// Shared (cross-user, votable) storage reply validators
// ============================================================
//
// Kept in lockstep with the host's `SHARED_*_RESULT` builders + `apps.shared.*`
// server return types. Same SHORT-CIRCUIT-on-`error` convention as the
// app-storage guards (the SHARED error path is `{ requestId, error }` — no
// success field — but short-circuiting is still correct and keeps the guards
// uniform). Closes the silent-corrupt-return hole: without these,
// `getCount/getCounts/append/vote/unvote`/`list` returned a missing field as
// `undefined` typed `number`/`string` with no throw, no timeout.

/** The moderated `{ title, body?, data? }` value carried by each SHARED entry. */
function isValidSharedValue(v: unknown): boolean {
  if (!isObject(v)) return false;
  if (typeof v.title !== 'string') return false;
  if (v.body !== undefined && typeof v.body !== 'string') return false;
  // `data` is opaque + unmoderated — any JSON value (incl. absent) is legal.
  return true;
}

/**
 * Reply to `SHARED_LIST`. On success `items` is an array the hook maps over,
 * dereferencing `key`/`authorUserId`/`value`/`count`/`createdAt`/`updatedAt`
 * (the last two ISO strings the hook rehydrates via `new Date`). Error path is
 * `{ error }` (the hook throws before touching `items`).
 */
export function isValidSharedListResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.error !== undefined) return true; // hook throws before reading `items`
  if (!Array.isArray(p.items)) return false;
  for (const it of p.items) {
    if (!isObject(it)) return false;
    if (!isNonEmptyString(it.key)) return false;
    if (!isFiniteNumber(it.authorUserId)) return false;
    if (!isValidSharedValue(it.value)) return false;
    if (!isFiniteNumber(it.count)) return false;
    if (!isDateLike(it.createdAt)) return false;
    if (!isDateLike(it.updatedAt)) return false;
  }
  if (p.nextCursor !== undefined && typeof p.nextCursor !== 'string') return false;
  return true;
}

/**
 * Reply to `SHARED_GET_COUNT` / `SHARED_VOTE` / `SHARED_UNVOTE` — all three
 * carry an identical `{ count, error? }` shape. On success `count` is the
 * finite vote total the hook returns directly.
 */
export function isValidSharedCountResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.error !== undefined) return true; // hook throws before reading `count`
  if (!isFiniteNumber(p.count)) return false;
  return true;
}

/** Reply to `SHARED_GET_COUNTS`. `counts` maps each key to a finite vote total. */
export function isValidSharedCountsResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.error !== undefined) return true; // hook throws before reading `counts`
  if (!isObject(p.counts)) return false;
  for (const v of Object.values(p.counts)) {
    if (!isFiniteNumber(v)) return false;
  }
  return true;
}

/** Reply to `SHARED_APPEND`. On success `key` is the host-minted (non-empty) entry id. */
export function isValidSharedAppendResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.error !== undefined) return true; // hook throws before reading `key`
  if (!isNonEmptyString(p.key)) return false;
  return true;
}

/** Reply to `SHARED_WITHDRAW`. On success `ok` + `deleted` are booleans (error path is `{ error }`). */
export function isValidSharedWithdrawResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  if (p.error !== undefined) return true; // hook throws before reading `deleted`
  if (typeof p.ok !== 'boolean') return false;
  if (typeof p.deleted !== 'boolean') return false;
  return true;
}

// ============================================================
// Picker + user-checkpoint reply validators
// ============================================================

/**
 * The 5 base fields shared by `BlockCheckpointInfo` and `BlockResourceInfo`.
 * `versionId` is the MONEY-ADJACENT id a block feeds into a workflow body — the
 * one field that MUST be a real positive integer (defense-in-depth; the host
 * also re-validates it server-side at estimate/submit). The rest of the
 * projection is display-only, so each is checked ONLY WHEN PRESENT — a minimal
 * reply carrying just a valid `versionId` is still safely consumable, and
 * over-requiring would drop a legitimate id-only projection.
 */
function isValidPickerResourceBase(s: Record<string, unknown>): boolean {
  if (typeof s.versionId !== 'number' || !Number.isInteger(s.versionId) || s.versionId <= 0) {
    return false;
  }
  if (
    s.modelId !== undefined &&
    (typeof s.modelId !== 'number' || !Number.isInteger(s.modelId) || s.modelId <= 0)
  ) {
    return false;
  }
  if (s.modelName !== undefined && typeof s.modelName !== 'string') return false;
  if (s.versionName !== undefined && typeof s.versionName !== 'string') return false;
  if (s.baseModel !== undefined && typeof s.baseModel !== 'string') return false;
  return true;
}

/**
 * Reply to `OPEN_CHECKPOINT_PICKER`. `selected` is ABSENT when the user
 * dismissed the picker (the hook resolves `{ selected: undefined }`); when
 * present it is a `BlockCheckpointInfo` projection.
 */
export function isValidCheckpointPickerResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.selected !== undefined) {
    if (!isObject(p.selected)) return false;
    if (!isValidPickerResourceBase(p.selected)) return false;
  }
  return true;
}

/**
 * Reply to `OPEN_RESOURCE_PICKER`. `selected` is ABSENT on dismiss (the hook
 * resolves `null`); when present it is a `BlockResourceInfo` projection — the 5
 * base fields plus `modelType` and the OPTIONAL public recommended-settings
 * (`strength`/`minStrength`/`maxStrength` finite, `trainedWords` a string[],
 * `clipSkip` a finite number OR `null`).
 */
export function isValidResourcePickerResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (p.selected !== undefined) {
    const s = p.selected;
    if (!isObject(s)) return false;
    if (!isValidPickerResourceBase(s)) return false;
    if (s.modelType !== undefined && typeof s.modelType !== 'string') return false;
    if (s.strength !== undefined && !isFiniteNumber(s.strength)) return false;
    if (s.minStrength !== undefined && !isFiniteNumber(s.minStrength)) return false;
    if (s.maxStrength !== undefined && !isFiniteNumber(s.maxStrength)) return false;
    if (s.trainedWords !== undefined) {
      if (!Array.isArray(s.trainedWords)) return false;
      if (!s.trainedWords.every((w): w is string => typeof w === 'string')) return false;
    }
    // `clipSkip` is `number | null` — accept a finite number OR null; reject
    // other present types.
    if (s.clipSkip !== undefined && s.clipSkip !== null && !isFiniteNumber(s.clipSkip)) {
      return false;
    }
  }
  return true;
}

/**
 * Reply to `SET_USER_CHECKPOINT`. `ok` is required; the hook throws the `error`
 * string on `ok: false`. Mirrors `isValidSharedUpdateResult`.
 */
export function isValidUserCheckpointSetResult(p: unknown): boolean {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  if (typeof p.ok !== 'boolean') return false;
  if (p.error !== undefined && typeof p.error !== 'string') return false;
  return true;
}

/**
 * Returns the validator for an inbound message type, or `null` for types
 * that don't carry a payload requiring shape checks (SUSPEND/RESUME).
 *
 * Falsy result from the validator means "drop the message"; `iframeTransport`
 * pairs that with a `console.warn` carrying the type name.
 */
export function payloadValidatorFor(
  type: string,
): ((payload: unknown) => boolean) | null {
  switch (type) {
    case 'BLOCK_INIT':
      return isValidBlockInitPayload;
    case 'TOKEN_REFRESH':
      return isValidTokenRefresh;
    case 'TOKEN_REFRESH_RESPONSE':
      return isValidTokenRefreshResponse;
    case 'ESTIMATE_RESULT':
    case 'WORKFLOW_SUBMITTED':
    case 'WORKFLOW_STATUS':
    case 'WORKFLOW_CANCELED':
      return isValidWorkflowReply;
    case 'BUZZ_PURCHASE_RESULT':
      return isValidBuzzPurchaseResult;
    case 'BUZZ_BALANCE_RESULT':
      return isValidBuzzBalanceResult;
    case 'VIEWER_RESULT':
      return isValidViewerResult;
    case 'BUZZ_TRANSACTIONS_RESULT':
      return isValidBuzzTransactionsResult;
    case 'BUZZ_ACCOUNTS_RESULT':
      return isValidBuzzAccountsResult;
    case 'DAILY_COMPENSATION_RESULT':
      return isValidDailyCompensationResult;
    case 'WILDCARD_PACK_RESULT':
      return isValidWildcardPackResult;
    case 'APP_WORKFLOWS_RESULT':
      return isValidAppWorkflowsResult;
    case 'CANCEL_APP_WORKFLOW_RESULT':
      return isValidCancelAppWorkflowResult;
    case 'PUBLISH_RESULT':
      return isValidPublishResult;
    case 'IMAGES_RESULT':
      return isValidImagesResult;
    case 'IMAGE_UPLOAD_RESULT':
      return isValidImageUploadResult;
    case 'IMAGE_SCAN_RESOLVED':
      return isValidImageScanResolved;
    case 'SHARED_UPDATE_RESULT':
      return isValidSharedUpdateResult;
    case 'APP_STORAGE_GET_RESULT':
      return isValidAppStorageGetResult;
    case 'APP_STORAGE_SET_RESULT':
      return isValidAppStorageSetResult;
    case 'APP_STORAGE_DELETE_RESULT':
      return isValidAppStorageDeleteResult;
    case 'APP_STORAGE_LIST_RESULT':
      return isValidAppStorageListResult;
    case 'APP_STORAGE_QUOTA_RESULT':
      return isValidAppStorageQuotaResult;
    case 'SHARED_LIST_RESULT':
      return isValidSharedListResult;
    case 'SHARED_GET_COUNT_RESULT':
    case 'SHARED_VOTE_RESULT':
    case 'SHARED_UNVOTE_RESULT':
      return isValidSharedCountResult;
    case 'SHARED_GET_COUNTS_RESULT':
      return isValidSharedCountsResult;
    case 'SHARED_APPEND_RESULT':
      return isValidSharedAppendResult;
    case 'SHARED_WITHDRAW_RESULT':
      return isValidSharedWithdrawResult;
    case 'CHECKPOINT_PICKER_RESULT':
      return isValidCheckpointPickerResult;
    case 'RESOURCE_PICKER_RESULT':
      return isValidResourcePickerResult;
    case 'USER_CHECKPOINT_SET':
      return isValidUserCheckpointSetResult;
    case 'SUSPEND':
    case 'RESUME':
      return null;
    default:
      // Unknown type names get a structural pass; handleMessage's earlier
      // `isMessage` branches won't match them anyway.
      return null;
  }
}
