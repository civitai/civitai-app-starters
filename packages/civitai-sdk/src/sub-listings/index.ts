import { CivitaiError } from '../core/errors.js';
import { ApiError, type Http } from '../http/index.js';

/** Where the three routes this client wraps live under the site base URL. */
const BASE = 'blocks/sub-listings';

export interface SubListingCallOptions {
  signal?: AbortSignal;
}

/** A sub-listing's review state. Only `approved` items are in the store. */
export type SubListingStatus = 'pending' | 'approved' | 'hidden' | 'withdrawn';

/** The listing rating ladder, least to most mature. */
export type SubListingContentRating = 'g' | 'pg' | 'pg13' | 'r' | 'x';

/**
 * What `upsert` publishes: one item the VIEWER made in this app, as its own
 * App Store card under the viewer's name.
 *
 * The server owns every rule (lengths, the `subPath` shape, the rating floor)
 * and answers a breach with a {@link SubListingError}; nothing is pre-checked
 * here, so the rules have one home.
 */
export interface SubListingUpsertInput {
  /**
   * The key of a row in this app's SHARED storage (`app.sharedStorage`) that the
   * viewer authored and that is not hidden. One sub-listing per key: publishing
   * the same key again edits it, and every call REPLACES the whole item — an
   * optional you leave out is cleared, so re-send the ones you want to keep.
   */
  itemKey: string;
  title: string;
  /** Optional. Left out (`null`/`undefined`), the item has no tagline. */
  tagline?: string | null;
  /**
   * An image the viewer uploaded and that is publicly visible. Left out
   * (`null`/`undefined`), the card shows the app's cover.
   */
  imageId?: number | null;
  /**
   * Where the card opens your app: `/apps/run/<your-app-slug>/<subPath>`. One to
   * four `/`-separated segments of letters, digits, `_` and `-`.
   */
  subPath: string;
  /**
   * No less mature than the app's own rating. Left out (`null`/`undefined`), the
   * item inherits the app's rating.
   */
  contentRating?: SubListingContentRating | null;
}

export interface SubListingUpsertResult {
  id: string;
  /**
   * 🔴 `hidden` is an ANSWER, not a failure: a moderator took the item down, the
   * app cannot lift it, and the upsert changed nothing.
   */
  status: SubListingStatus;
  /** True while an edit to an approved item waits for a moderator; the card keeps serving the approved version. */
  pendingEdit: boolean;
}

export interface SubListingWithdrawResult {
  ok: true;
  /**
   * 🔴 `false` is a SUCCESS: nothing of this viewer's was active under that key —
   * or a moderator has hidden it, which the app cannot change.
   */
  withdrawn: boolean;
}

/** One of the viewer's own items for this app, as `mine` lists it. */
export interface MySubListing {
  id: string;
  itemKey: string;
  status: SubListingStatus;
  title: string;
  pendingEdit: boolean;
  /** Why a moderator hid it, when one said. */
  statusReason: string | null;
  /** Why a moderator rejected the last staged edit, when one said. */
  editRejectionReason: string | null;
  /** The wire's ISO string, revived once. */
  updatedAt: Date;
}

/**
 * The `code` of a sub-listing refusal.
 *
 * The named codes are the ones the three sub-listing routes raise themselves,
 * plus the two token refusals an app should expect here: `insufficient_scope`
 * (the token lacks `apps:store:items:write` — every dev-token, dev-tunnel and
 * review session) and `context_binding` (an anonymous viewer). Any other wire
 * code still arrives, as a plain string.
 */
export type SubListingErrorCode =
  | 'invalid_body'
  | 'anonymous'
  | 'not_enabled'
  | 'untrusted'
  | 'item_not_found'
  | 'not_your_item'
  | 'text_rejected'
  | 'image_not_yours'
  | 'image_not_public'
  | 'rating_too_loose'
  | 'rate_limited'
  | 'author_cap'
  | 'conflict'
  | 'unavailable'
  | 'insufficient_scope'
  | 'context_binding'
  | (string & {});

/**
 * A refusal from a sub-listing route, whose body is `{ error, code }`. Branch on
 * `code`: `error` (this error's `message`) is a server sentence, not UI copy.
 * `status` and `body` are {@link ApiError}'s, as sent.
 *
 * ⚠ A `429` carries a `Retry-After` header this client does not expose
 * (`ApiError` keeps no headers).
 */
export class SubListingError extends ApiError {
  readonly code: SubListingErrorCode;

  constructor(
    status: number,
    code: SubListingErrorCode,
    message: string,
    body: unknown,
    options?: ErrorOptions,
  ) {
    super(status, message, body);
    if (options?.cause !== undefined) Object.defineProperty(this, 'cause', { value: options.cause });
    this.name = 'SubListingError';
    this.code = code;
  }
}

/**
 * The viewer's own App Store items for THIS app — sub-listings of the app's
 * listing, each published by the viewer under their name and reviewed by a
 * moderator before it shows in the store.
 *
 * 🔴 Requires the block token and the scope `apps:store:items:write`, which is
 * consent-exempt, signed-in viewers only, and never minted for dev-token,
 * dev-tunnel or review sessions — so a refusal here is a normal outcome, and the
 * publish path must degrade quietly. The app must also be enabled for
 * sub-listings by Civitai (`not_enabled` until it is).
 *
 * 🔴 EVERY FAILURE REJECTS: a refusal the server explained is a
 * {@link SubListingError}; any other failure is the {@link ApiError} or
 * `CivitaiError` it was.
 */
export interface SubListingsClient {
  /**
   * Publishes, or edits, the item at `itemKey`. `POST blocks/sub-listings/upsert`.
   *
   * 🔴 The server's body is STRICT — an unknown key is `400 invalid_body` — so
   * only the six fields of {@link SubListingUpsertInput} are sent. An optional
   * that is `null` or `undefined` is left out rather than sent; the server stores
   * either as empty.
   *
   * 🔴 It REPLACES, it does not patch: an edit that leaves out `tagline`,
   * `imageId` or `contentRating` clears it (on an approved item, the cleared
   * version is what goes to the moderator). Re-send every field you want to keep.
   */
  upsert(
    input: SubListingUpsertInput,
    opts?: SubListingCallOptions,
  ): Promise<SubListingUpsertResult>;

  /** Takes the viewer's item at `itemKey` out of the store. `POST blocks/sub-listings/withdraw`. */
  withdraw(itemKey: string, opts?: SubListingCallOptions): Promise<SubListingWithdrawResult>;

  /**
   * The viewer's items for this app, oldest first, at most 200, with their
   * review state. `GET blocks/sub-listings/mine`.
   */
  mine(opts?: SubListingCallOptions): Promise<{ items: MySubListing[] }>;
}

export function createSubListingsClient(http: Http): SubListingsClient {
  const call = async <T>(method: 'GET' | 'POST', op: string, body: unknown, signal?: AbortSignal) => {
    try {
      return await http<T>(method, `${BASE}/${op}`, { body, signal });
    } catch (error) {
      throw toSubListingError(error);
    }
  };

  return {
    async upsert(input, { signal } = {}) {
      const res = await call<Record<string, unknown> | null>('POST', 'upsert', upsertBody(input), signal);
      if (
        typeof res?.id !== 'string' ||
        typeof res.status !== 'string' ||
        typeof res.pendingEdit !== 'boolean'
      ) {
        throw new CivitaiError('sub-listings upsert: malformed reply');
      }
      return {
        id: res.id,
        status: res.status as SubListingStatus,
        pendingEdit: res.pendingEdit,
      };
    },

    async withdraw(itemKey, { signal } = {}) {
      const res = await call<{ withdrawn?: unknown } | null>('POST', 'withdraw', { itemKey }, signal);
      if (typeof res?.withdrawn !== 'boolean') {
        throw new CivitaiError('sub-listings withdraw: reply carried no `withdrawn` flag');
      }
      return { ok: true as const, withdrawn: res.withdrawn };
    },

    async mine({ signal } = {}) {
      const res = await call<{ items?: unknown } | null>('GET', 'mine', undefined, signal);
      // 🔴 NO `?? []`. An empty list is a real answer ("nothing in the store"),
      // and a reply without `items` must not be dressed up as it.
      if (!Array.isArray(res?.items)) {
        throw new CivitaiError('sub-listings mine: reply carried no `items` array');
      }
      return { items: res.items.map(toMySubListing) };
    },
  };
}

/**
 * The request body: the six fields, named rather than spread, so an extra
 * property on the caller's object never reaches the strict server body; and each
 * optional one only when it holds a value.
 */
function upsertBody(input: SubListingUpsertInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    itemKey: input.itemKey,
    title: input.title,
    subPath: input.subPath,
  };
  if (input.tagline != null) body.tagline = input.tagline;
  if (input.imageId != null) body.imageId = input.imageId;
  if (input.contentRating != null) body.contentRating = input.contentRating;
  return body;
}

/** An {@link ApiError} whose body carries a string `code` becomes a {@link SubListingError}; anything else passes through. */
function toSubListingError(error: unknown): unknown {
  if (!(error instanceof ApiError) || error instanceof SubListingError) return error;
  const body = error.body;
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return error;
  const { code } = body as Record<string, unknown>;
  if (typeof code !== 'string') return error;
  return new SubListingError(error.status, code, error.message, body, { cause: error });
}

function toMySubListing(row: unknown): MySubListing {
  const r = (row ?? {}) as Record<string, unknown>;
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  if (
    typeof r.id !== 'string' ||
    typeof r.itemKey !== 'string' ||
    typeof r.status !== 'string' ||
    typeof r.title !== 'string' ||
    typeof r.pendingEdit !== 'boolean' ||
    !nullableString(r.statusReason) ||
    !nullableString(r.editRejectionReason) ||
    typeof r.updatedAt !== 'string'
  ) {
    throw new CivitaiError('sub-listings mine: malformed item');
  }
  const updatedAt = new Date(r.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new CivitaiError('sub-listings mine: malformed item timestamp');
  }
  return {
    id: r.id,
    itemKey: r.itemKey,
    status: r.status as SubListingStatus,
    title: r.title,
    pendingEdit: r.pendingEdit,
    statusReason: r.statusReason as string | null,
    editRejectionReason: r.editRejectionReason as string | null,
    updatedAt,
  };
}
