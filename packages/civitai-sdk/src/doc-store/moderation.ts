import { CivitaiError } from '../core/errors.js';
import { ApiError, type Http } from '../http/index.js';
import {
  createStorageCall,
  invalidFrom,
  StorageError,
  withSourcePublishGrant,
  type DocumentCallOptions,
  type DocumentStorageOptions,
} from './index.js';

/**
 * THE REPORT MODERATION API (civitai/civitai#10215): `POST /api/v1/blocks/moderation/reports`
 * with `{ collection, key, from? }` reports one SHARED document of the app's storage to
 * civitai.com's moderators, and answers `{ reported: true }` — the same whether or not the viewer
 * had reported it already, and never a count. Refusals use the document store's envelope, so
 * each one is a {@link StorageError} with the server's `code`.
 */
export const REPORTS_PATH = 'blocks/moderation/reports';

/**
 * The route's own answer while it is off for the app (the per-app host flag): an unknown route,
 * `404 not_found`, told apart from a document that is not there (`404 not_found`, "document not
 * found") only by this sentence. Matched exactly, so a reworded miss stays a miss.
 */
const NO_SUCH_ROUTE = 'no such route';

/** What {@link ModerationClient.report} reports. */
export interface StorageReportRequest {
  /** A SHARED collection the app declares (a private one is refused `invalid_request`). */
  collection: string;
  /** The document's key, as a read returned it. */
  key: string;
  /**
   * Another app's blockId: report a document in THAT app's collection, through an import this
   * app's manifest declares (`storage.imports`), as `collection(name, { from })` reaches it.
   * When the key is present its value must be a string: `{ from: undefined }` would report a
   * document in this app's own collection, so it is refused before sending.
   */
  from?: string;
}

/** Moderation on `app.moderation`. */
export interface ModerationClient {
  /**
   * Report one document to the moderators. Idempotent: reporting it again answers the same and
   * files nothing new. There is no withdrawal and no count, so show the viewer "reported" from
   * your own state, not from a read.
   *
   * Signed-in viewers only (`sign_in_required`, 401). Needs `apps:storage`; spends the daily
   * report budget (about 20 per viewer per app, `rate_limited` with `retryAfter` past it) and
   * passes the shared-write trust gate (`not_eligible`). A document that is not there, or not
   * visible, is `not_found` (404). Through an import, the source app's rules apply, and a
   * source that needs the viewer's publish grant there is asked for it once, as a write is.
   *
   * A civitai.com that does not serve the report API — an older release, or the app's host flag
   * off — rejects with the LOCAL code `report_unavailable` (404). Hide the report action then;
   * a `report` mark (`update(key, { $mark: 'report' })`) is the older route.
   *
   * @example
   * ```ts
   * await app.moderation.report({ collection: 'posts', key: post.key }); // { reported: true }
   * ```
   */
  report(request: StorageReportRequest, opts?: DocumentCallOptions): Promise<{ reported: true }>;
}

/** The report API's client over `http` (the site client, or a local preview's fake). */
export function createModerationClient(
  http: Http,
  options: Pick<DocumentStorageOptions, 'requestGrants'> = {},
): ModerationClient {
  const call = createStorageCall(http);
  return {
    async report(request, { signal } = {}) {
      const { collection, key } = request ?? ({} as StorageReportRequest);
      let from: string | undefined;
      if (request !== null && typeof request === 'object' && Object.prototype.hasOwnProperty.call(request, 'from')) {
        if (typeof request.from !== 'string') {
          throw invalidFrom(
            `from ${String(request.from)} is not a source app's blockId: pass one, or no \`from\` to report in this app's own collection (refused before sending)`,
            request.from,
          );
        }
        from = request.from;
      }
      const reply = await withSourcePublishGrant(options.requestGrants, from, signal, () =>
        reportCall(() =>
          call<unknown>(
            'POST',
            REPORTS_PATH,
            // Named rather than spread: JSON drops an undefined `from`, and nothing else is sent.
            { body: { collection, key, from }, signal },
            { throughImport: from !== undefined },
          ),
        ),
      );
      if (reply === null || typeof reply !== 'object' || (reply as { reported?: unknown }).reported !== true) {
        throw new CivitaiError('moderation report: reply carried no `reported: true`');
      }
      return { reported: true };
    },
  };
}

/**
 * The route not served: its flag off (`not_found`, "no such route"), or no such page at all on an
 * older civitai.com (a 404 without the envelope). Either becomes the LOCAL `report_unavailable`.
 */
async function reportCall<R>(send: () => Promise<R>): Promise<R> {
  try {
    return await send();
  } catch (error) {
    const unserved =
      error instanceof StorageError
        ? error.status === 404 &&
          error.code === 'not_found' &&
          (error.body as { message?: unknown } | null)?.message === NO_SUCH_ROUTE
        : error instanceof ApiError && error.status === 404;
    if (!unserved) throw error;
    const body = (error as ApiError).body;
    throw new StorageError(
      404,
      'report_unavailable',
      'this civitai.com does not serve the storage report API yet (an older release, or not enabled for this app)',
      body,
      error instanceof StorageError ? error.details : undefined,
      { cause: error },
    );
  }
}
