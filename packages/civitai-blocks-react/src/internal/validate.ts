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
    | { url: string; width: number; height: number };
} {
  if (!isObject(p)) return false;
  if (p.requestId !== undefined && typeof p.requestId !== 'string') return false;
  // `selected` absent → cancelled upload (valid). When present, it must match
  // one of the two purpose-keyed shapes.
  if (p.selected !== undefined) {
    const s = p.selected;
    if (!isObject(s)) return false;
    if (!isModeratedUpload(s) && !isGenerationSourceUpload(s)) return false;
  }
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
    case 'IMAGE_UPLOAD_RESULT':
      return isValidImageUploadResult;
    case 'SUSPEND':
    case 'RESUME':
      return null;
    default:
      // Unknown type names get a structural pass; handleMessage's earlier
      // `isMessage` branches won't match them anyway.
      return null;
  }
}
