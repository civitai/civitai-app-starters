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
    case 'BUZZ_TRANSACTIONS_RESULT':
      return isValidBuzzTransactionsResult;
    case 'BUZZ_ACCOUNTS_RESULT':
      return isValidBuzzAccountsResult;
    case 'DAILY_COMPENSATION_RESULT':
      return isValidDailyCompensationResult;
    case 'WILDCARD_PACK_RESULT':
      return isValidWildcardPackResult;
    case 'IMAGE_UPLOAD_RESULT':
      return isValidImageUploadResult;
    case 'IMAGE_SCAN_RESOLVED':
      return isValidImageScanResolved;
    case 'SHARED_UPDATE_RESULT':
      return isValidSharedUpdateResult;
    case 'SUSPEND':
    case 'RESUME':
      return null;
    default:
      // Unknown type names get a structural pass; handleMessage's earlier
      // `isMessage` branches won't match them anyway.
      return null;
  }
}
