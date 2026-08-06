/**
 * postMessage protocol between an embedding host page and an iframe-mode block.
 *
 * Discriminated by `type`. Both directions share this module so producers and
 * consumers stay in lockstep — adding a parent→block message means the block
 * side gets a compile error until it handles the new variant (and vice versa).
 *
 * Wire format: `window.postMessage({ type, payload }, targetOrigin)`.
 */

import type { ColorDomain } from './browsingLevel.js';
import type {
  BlockCheckpointInfo,
  BlockResourceInfo,
  BlockResourcePickerType,
  BlockUploadedImageInfo,
  BlockGenerationSourceImageInfo,
  BlockPendingImageInfo,
  BlockImageScanResult,
  BlockUploadPurpose,
  BlockContext,
  BlockSettings,
  Theme,
  ViewerInfo,
  WorkflowBody,
  BlockWorkflowSnapshot,
  BlockBuzzTransaction,
  BlockBuzzAccount,
  BlockDailyCompensationResource,
  BlockViewer,
  BlockWildcardPack,
  BlockWildcardPackErrorCode,
  AppWorkflow,
  BlockGatedImage,
} from './types.js';

// ============================================================
// Buzz self-read request params (block → parent)
// ============================================================

/**
 * Filter params for `GET_BUZZ_TRANSACTIONS`. All optional; the host validates
 * them server-side (they are NEVER trusted for auth — the account is self-bound
 * off the block token). Mirrors civitai/civitai's `getMyBuzzTransactionsInput`
 * (`src/server/schema/buzz.schema.ts`) minus the host-injected `blockToken`.
 */
export interface BlockBuzzTransactionsParams {
  /** Buzz pool to read (e.g. `'yellow'`, `'blue'`, `'cashSettled'`). Default `'yellow'` server-side. */
  accountType?: string;
  /** A `TransactionType` NAME (e.g. `'Tip'`); the host maps it to the numeric enum. */
  type?: string;
  /** Opaque page cursor — the ISO-8601 `cursor` a prior `BUZZ_TRANSACTIONS_RESULT` returned (`z.coerce.date` server-side). */
  cursor?: string;
  /** Window start (ISO-8601; `z.coerce.date` server-side). */
  start?: string;
  /** Window end (ISO-8601; `z.coerce.date` server-side). */
  end?: string;
  /** Page size, 1..200 (default 50 server-side). */
  limit?: number;
}

/**
 * Filter params for `QUERY_APP_WORKFLOWS` — the app generator SUBQUEUE read. Both
 * optional; the host validates them server-side (the account + the per-app tag
 * filter are host-forced off the block token — NEVER trusted from these). Mirrors
 * civitai/civitai's `blocks.queryAppWorkflows` input (`blocks.router.ts`, PR
 * #3164) minus the host-injected `blockToken`/`tags`.
 */
export interface AppWorkflowsParams {
  /** Opaque keyset cursor — the `cursor` a prior `APP_WORKFLOWS_RESULT` returned (1..256 chars server-side). */
  cursor?: string;
  /** Page size, 1..50 (default 20 server-side). */
  limit?: number;
}

/**
 * Params for `GET_DAILY_COMPENSATION`. `date` is REQUIRED — the host reads the
 * whole MONTH containing it. Mirrors civitai/civitai's
 * `getMyDailyCompensationInput` minus the host-injected `blockToken`.
 */
export interface BlockDailyCompensationParams {
  /** ISO-8601 date; the host reads the month containing it. Required (`z.coerce.date` server-side). */
  date: string;
  /** Compensation source (default `'compensation'` server-side). */
  source?: string;
  /** Restrict to one Buzz pool (optional). */
  accountType?: string;
}

// ============================================================
// Token wrapper (shared by BLOCK_INIT, TOKEN_REFRESH, TOKEN_REFRESH_RESPONSE)
// ============================================================

/**
 * The wrapped token shape the host sends to the block. `raw` is the JWT;
 * `scopes`, `expiresAt`, and `buzzBudget` are extracted from the JWT claims
 * so blocks don't have to decode it themselves. `buzzBudget` is only present
 * when the manifest declares `ai:write:budgeted`.
 *
 * Mirrors the `token` field shape in civitai/civitai's `IframeHost.tsx`.
 */
export interface WrappedToken {
  raw: string;
  scopes: string[];
  /** ISO-8601; consumers rehydrate to Date. */
  expiresAt: string;
  buzzBudget?: number;
}

// ============================================================
// Init payload
// ============================================================

/**
 * Payload of the first `BLOCK_INIT` message a block receives. The host waits
 * for both the iframe `load` event AND a minted token before sending this.
 *
 * Mirrors `BlockInitPayload` in civitai/civitai's
 * `src/components/AppBlocks/types.ts`. Adding a field here without a
 * matching change on the platform side (or vice versa) is the bug class
 * `internal/validate.ts` exists to surface — keep the validator in lockstep
 * with both sides.
 */
export interface BlockInitPayload {
  blockInstanceId: string;
  blockId: string;
  /** The OauthClient (app) this block belongs to. */
  appId: string;
  token: WrappedToken;
  context: BlockContext;
  settings: BlockSettings;
  /** `null` when the viewer is anonymous. */
  viewer: ViewerInfo | null;
  theme: Theme;
  renderMode: 'iframe' | 'inline';
  /**
   * The color-domain the block is rendered inside (`green` | `blue` | `red`),
   * or `null` when the host did not resolve one. Informational ONLY — the SFW
   * policy is server-side; derive "is this SFW?" from {@link maxBrowsingLevel}
   * (via `isSfwCeiling` / `useDomainMaturity`), never from this string.
   *
   * Sent by civitai/civitai PR #2670. A host that predates it omits this field
   * (reads `undefined`).
   */
  domain?: ColorDomain | null;
  /**
   * Authoritative browsing-level BITMASK = the max NSFW levels the domain
   * allows, computed server-side from `domainBrowsingCeiling(color)` (green/
   * blue → SFW, red → all). Bits mirror the server `NsfwLevel` (see
   * `browsingLevel.ts`). A block reads this to decide whether to surface mature
   * affordances — `isSfwCeiling(maxBrowsingLevel)` is the canonical test.
   *
   * Sent by civitai/civitai PR #2670. A host that predates it omits this field
   * (reads `undefined`); the SDK fail-closes to SFW when it is absent.
   */
  maxBrowsingLevel?: number;
}

// ============================================================
// Shared storage (App Blocks SHARED datastore, W?-Phase 2)
// ============================================================

/**
 * The freeform value carried by one SHARED-storage entry. Unlike the per-user
 * `APP_STORAGE_*` KV (arbitrary JSON), the SHARED store is a structured,
 * append-only, community-votable list — every entry is a `{ title, body? }`
 * record contributed by one viewer and vote-counted across all viewers. `title`
 * is required; `body` is optional long-form.
 */
export interface SharedStorageValue {
  title: string;
  body?: string;
  /**
   * Optional, opaque, app-owned structured payload stored alongside the
   * moderated `title`/`body`. Mirrors civitai's merged shared-storage `data`
   * jsonb (`appendValueInput.data`). UNMODERATED — the content-safety belt runs
   * on `title`/`body` only, so apps MUST keep ALL user-visible TEXT in
   * `title`/`body` and place ONLY opaque app structure here (e.g. a serialized
   * generator spec / settings blob). Counts toward the per-value byte cap + the
   * per-app quota. Omit when the entry carries no structured payload.
   */
  data?: unknown;
}

/**
 * One SHARED-storage entry as it appears on the wire in `SHARED_LIST_RESULT`.
 * `createdAt`/`updatedAt` are ISO-8601 strings; the block-side hook rehydrates
 * them to `Date` (mirrors `APP_STORAGE_LIST_RESULT`'s `updatedAt`). `count` is
 * the current vote total; `authorUserId` is the contributing viewer.
 */
export interface SharedStorageItemWire {
  key: string;
  authorUserId: number;
  value: SharedStorageValue;
  count: number;
  /** ISO-8601; consumers rehydrate to Date. */
  createdAt: string;
  /** ISO-8601; consumers rehydrate to Date. */
  updatedAt: string;
  /**
   * Whether the REQUESTING viewer has an active up-vote on this entry. Lets a
   * block hydrate its vote-button state on load instead of guessing (fixes the
   * "double-click to unvote" bug). ADDITIVE + OPTIONAL: a host that predates
   * this field omits it — the block-side hook defaults a missing value to
   * `false`, so a new block on an old host degrades to today's behavior. An
   * anonymous viewer is always `false` (no per-viewer vote row). Resolved
   * server-side per viewer; never client-trusted.
   */
  viewerVoted?: boolean;
}

// ============================================================
// Parent → block
// ============================================================

export type ParentToBlockMessage =
  | { type: 'BLOCK_INIT'; payload: BlockInitPayload }
  | {
      // Host-pushed token rotation (~every 13min). No `requestId` — the
      // host is the initiator. Blocks must apply the new wrapped token
      // unconditionally; this is also what keeps the iframe alive across
      // refreshes (no remount).
      type: 'TOKEN_REFRESH';
      payload: { token: WrappedToken };
    }
  | {
      // Reply to a block-initiated `REQUEST_TOKEN`. `requestId` is echoed
      // back when the block supplied one; the payload otherwise mirrors
      // `TOKEN_REFRESH` so consumers can apply both through the same path.
      type: 'TOKEN_REFRESH_RESPONSE';
      payload: { requestId?: string; token: WrappedToken };
    }
  | {
      // Host-pushed SITE-THEME change. Sent when the viewer toggles light/dark
      // WHILE the block is mounted. No `requestId` — the host is the initiator,
      // exactly like `TOKEN_REFRESH`; blocks apply the new theme unconditionally
      // and there is no reply.
      //
      // WHY IT EXISTS: `theme` reaches a block twice at startup — in the
      // `BLOCK_INIT` payload and (when the host enables the fast path) in the
      // iframe URL fragment. Neither can change afterwards: `BLOCK_INIT` is
      // DEDUPED by the SDK transport (only the first is honored) and the
      // fragment is deliberately FROZEN at mount so a toggle cannot re-navigate
      // a third-party frame. So before this message a mounted block kept
      // rendering its mount-time theme until it was reloaded.
      //
      // BACK-COMPAT, BOTH DIRECTIONS — purely additive:
      //   • OLD BLOCK / NEW HOST: an SDK that predates this message has no
      //     handler for it. The iframe transport's `handleMessage` falls through
      //     to its no-op tail (it is not a `BLOCK_INIT`, not a `TOKEN_REFRESH`,
      //     carries no `requestId` so it matches no pending request, and has no
      //     push listener), so a deployed block is COMPLETELY unaffected — it
      //     simply keeps today's mount-time theme.
      //   • NEW BLOCK / OLD HOST: nothing here is ever awaited. A block reads the
      //     theme from its snapshot, which `BLOCK_INIT` already seeded; a host
      //     that never sends `THEME_CHANGE` just means the value never moves —
      //     i.e. today's behaviour. No hook blocks on it and there is no timeout
      //     to hit.
      type: 'THEME_CHANGE';
      payload: { theme: Theme };
    }
  | { type: 'ESTIMATE_RESULT'; payload: { requestId: string; snapshot: BlockWorkflowSnapshot } }
  | { type: 'WORKFLOW_SUBMITTED'; payload: { requestId: string; snapshot: BlockWorkflowSnapshot } }
  | { type: 'WORKFLOW_STATUS'; payload: { requestId: string; snapshot: BlockWorkflowSnapshot } }
  | { type: 'WORKFLOW_CANCELED'; payload: { requestId: string; snapshot: BlockWorkflowSnapshot } }
  | {
      type: 'BUZZ_PURCHASE_RESULT';
      payload: { requestId: string; purchased: boolean; newBalance?: number };
    }
  | {
      // Reply to GET_BUZZ_BALANCE. On success `balance` carries the viewer's
      // per-pool balance ({ blue, green, yellow }); on host-side failure (or an
      // anonymous viewer / missing scope) `error` is set and `balance` is
      // absent. Mirrors the `APP_STORAGE_GET_RESULT` value-or-error convention:
      // consumers treat a non-empty `error` as the failure signal.
      type: 'BUZZ_BALANCE_RESULT';
      payload: {
        requestId: string;
        balance?: { blue: number; green: number; yellow: number };
        error?: string;
      };
    }
  | {
      // Reply to GET_VIEWER — the viewer self-read. On success `viewer` carries
      // the signed-in viewer ({@link BlockViewer} — id/username/status/buzzBudget,
      // where `username` + `buzzBudget` are present-but-NULLABLE); on host-side
      // failure (anonymous / banned viewer, missing scope, or host failure)
      // `error` is a FREE-TEXT string and `viewer` is absent. Consumers treat a
      // non-empty `error` as the reject signal (mirrors BUZZ_BALANCE_RESULT).
      type: 'VIEWER_RESULT';
      payload: {
        requestId: string;
        viewer?: BlockViewer;
        error?: string;
      };
    }
  | {
      // Reply to GET_BUZZ_TRANSACTIONS — the Buzz-dashboard ledger read. On
      // success `result` carries the page (`cursor` for the next page +
      // `transactions`); on host-side failure `error` is a FREE-TEXT string
      // (the host forwards `err.message`, e.g. a missing-scope / rate-limit
      // message) and `result` is absent. Consumers treat a non-empty `error`
      // as the reject signal (mirrors BUZZ_BALANCE_RESULT). See the DATE WIRE
      // CAVEAT on {@link BlockBuzzTransaction} — `cursor` + each `date` arrive
      // as a `Date` INSTANCE today (raw structured-clone), not an ISO string;
      // the block-side guard + hook tolerate both.
      type: 'BUZZ_TRANSACTIONS_RESULT';
      payload: {
        requestId: string;
        result?: { cursor?: string; transactions: BlockBuzzTransaction[] };
        error?: string;
      };
    }
  | {
      // Reply to GET_BUZZ_ACCOUNTS — the viewer's all-pool balances (spendable
      // pools + creator payout pools). Success → `result.accounts`; host-side
      // failure → a free-text `error` (same convention as BUZZ_TRANSACTIONS).
      type: 'BUZZ_ACCOUNTS_RESULT';
      payload: {
        requestId: string;
        result?: { accounts: BlockBuzzAccount[] };
        error?: string;
      };
    }
  | {
      // Reply to GET_DAILY_COMPENSATION — per-modelVersion generation earnings
      // for the month of the requested `date`. Success → `result` ({ resources,
      // hasPublishedResources }); host-side failure → a free-text `error`.
      type: 'DAILY_COMPENSATION_RESULT';
      payload: {
        requestId: string;
        result?: { resources: BlockDailyCompensationResource[]; hasPublishedResources: boolean };
        error?: string;
      };
    }
  | {
      // Reply to GET_WILDCARD_PACK — the parsed wildcard pack the host resolved,
      // fetched, unzipped, and parsed AS THE USER. Success → `pack`; failure →
      // `error` a DISCRIMINATED ENUM ({@link BlockWildcardPackErrorCode}), NOT a
      // free-text string (unlike the buzz bridges). Consumers switch on the code
      // (`not-found`/`forbidden`/`too-large`/`parse-failed`/`busy`); `busy` is a
      // retryable host-side backpressure signal.
      type: 'WILDCARD_PACK_RESULT';
      payload: {
        requestId: string;
        pack?: BlockWildcardPack;
        error?: BlockWildcardPackErrorCode;
      };
    }
  | {
      // Reply to QUERY_APP_WORKFLOWS — the app generator SUBQUEUE page (the
      // calling app's OWN tag-scoped generations, newest-first). On success
      // `result` carries the page (`workflows` + the next-page `cursor`, which is
      // `null` on the last/only page); on host-side failure `error` is a FREE-TEXT
      // string (the host forwards `err.message`, e.g. a missing-scope / rate-limit
      // message) and `result` is absent. Consumers treat a non-empty `error` as
      // the reject signal (mirrors BUZZ_TRANSACTIONS_RESULT).
      type: 'APP_WORKFLOWS_RESULT';
      payload: {
        requestId: string;
        result?: { workflows: AppWorkflow[]; cursor: string | null };
        error?: string;
      };
    }
  | {
      // Reply to PUBLISH_GENERATION_OUTPUTS. On success `result.imageIds` are the
      // bare (post-less) scanned Image row ids created (order matches the resolved
      // outputs). On host-side failure (anon / missing scope / not-owned workflow /
      // rate-limit / upload/scan failure) `error` is a FREE-TEXT string and
      // `result` is absent. Consumers treat a non-empty `error` as the reject
      // signal (mirrors APP_WORKFLOWS_RESULT).
      type: 'PUBLISH_RESULT';
      payload: { requestId: string; result?: { imageIds: number[] }; error?: string };
    }
  | {
      // Reply to GET_IMAGES_BY_IDS. On success `result.images` is the per-viewer
      // gated projection (`BlockGatedImage[]`; unresolvable ids omitted). On host-
      // side failure `error` is a FREE-TEXT string and `result` is absent.
      type: 'IMAGES_RESULT';
      payload: { requestId: string; result?: { images: BlockGatedImage[] }; error?: string };
    }
  | {
      // Reply to CANCEL_APP_WORKFLOW — the terminal (canceled) projection of the
      // one workflow the block canceled in its OWN subqueue. On success `result`
      // carries the re-read `workflow`; on host-side failure (FORBIDDEN — not in
      // this app's subqueue / not owned — or a transport error) `error` is a
      // FREE-TEXT string and `result` is absent. Same value-or-error convention as
      // APP_WORKFLOWS_RESULT.
      type: 'CANCEL_APP_WORKFLOW_RESULT';
      payload: {
        requestId: string;
        result?: { workflow: AppWorkflow };
        error?: string;
      };
    }
  | {
      // Reply to OPEN_CHECKPOINT_PICKER. `selected` is absent when the user
      // dismissed the picker without choosing — the block's hook resolves
      // to `{ selected: undefined }` in that case.
      type: 'CHECKPOINT_PICKER_RESULT';
      payload: { requestId: string; selected?: BlockCheckpointInfo };
    }
  | {
      // Reply to OPEN_RESOURCE_PICKER (the PAGE resource picker). `selected` is
      // absent when the user dismissed without choosing — the block's hook
      // resolves to `null`. The payload is the narrow `BlockResourceInfo`
      // projection ONLY; the iframe never receives a list or the catalog.
      type: 'RESOURCE_PICKER_RESULT';
      payload: { requestId: string; selected?: BlockResourceInfo };
    }
  | {
      // Reply to OPEN_IMAGE_UPLOAD (the host-mediated block image upload).
      // `selected` is absent when the user dismissed the upload modal without a
      // successful upload — the block's hook resolves to `null`. The iframe never
      // handles the bytes. Mirrors the OPEN_RESOURCE_PICKER host-chrome pattern.
      //
      // `selected` is a UNION keyed by the request's `purpose` (+ `asyncScan`):
      //   • `'display'` (default), BLOCKING: a MODERATED public image
      //     ({@link BlockUploadedImageInfo} — imageId/nsfwLevel/contentRating/url,
      //     scanned clean, within the SFW ceiling, unflagged).
      //   • `'display'` + `asyncScan: true`: an EARLY-RESOLVE
      //     ({@link BlockPendingImageInfo} — `status:'pending'`, imageId, url) that
      //     resolves the modal on PERSIST (before the scan). The scan verdict
      //     streams later on `IMAGE_SCAN_RESOLVED`. `status:'pending'` is the
      //     on-wire discriminant vs the moderated shape.
      //   • `'generationSource'`: an UNSCANNED private img2img source
      //     ({@link BlockGenerationSourceImageInfo} — only { url, width, height };
      //     no imageId/nsfwLevel, scanned by the orchestrator at gen time).
      // The variant the host returns matches the `purpose`/`asyncScan` the block
      // requested; narrow structurally (`'status' in selected` for pending, then
      // `'imageId' in selected`) when a block uses more than one.
      type: 'IMAGE_UPLOAD_RESULT';
      payload: {
        requestId: string;
        selected?:
          | BlockUploadedImageInfo
          | BlockGenerationSourceImageInfo
          | BlockPendingImageInfo;
      };
    }
  | {
      // Host→block ASYNC scan verdict for a pending `'display'` upload (the
      // `asyncScan: true` early-resolve path). Sent AFTER an `IMAGE_UPLOAD_RESULT`
      // carrying a {@link BlockPendingImageInfo}, once the host-side scan poll
      // reaches a terminal outcome. Correlated to the originating
      // `OPEN_IMAGE_UPLOAD` by `requestId` (the unguessable id the SDK generated)
      // AND echoes `imageId` so the block can match it to the pending handle.
      // The host emits it AT MOST ONCE per request; the SDK honors only the first.
      //
      // `result` is a discriminated {@link BlockImageScanResult}: `'scanned'`
      // carries the moderated {@link BlockUploadedImageInfo} (the ONLY verdict a
      // block may persist to a cross-user surface); `'blocked'` is terminal
      // non-clean (no usable image); `'error'` is a transient/timeout, retryable.
      //
      // PARENT→block, so it is NOT a `BlockToParentMessage` and does NOT belong in
      // the host `hostHandlerParity.ts` request INVENTORY.
      type: 'IMAGE_SCAN_RESOLVED';
      payload: { requestId: string; imageId: number; result: BlockImageScanResult };
    }
  | {
      // Reply to SET_USER_CHECKPOINT. `ok: false` carries a UI-renderable
      // `error` string (e.g. "wrong-ecosystem"), distinct from the block
      // lifecycle error class.
      type: 'USER_CHECKPOINT_SET';
      payload: { requestId: string; ok: boolean; error?: string };
    }
  | {
      // Reply to APP_STORAGE_GET. `value` is `null` when the key isn't
      // set OR when the viewer is anon. `error` is set on host-side
      // failure; consumers always treat a non-empty `error` as the
      // promise-reject signal.
      type: 'APP_STORAGE_GET_RESULT';
      payload: { requestId: string; value: unknown; error?: string };
    }
  | {
      // Reply to APP_STORAGE_SET. `error: "PAYLOAD_TOO_LARGE"` covers
      // both the per-value 64KB cap and the per-app 50MB quota — the
      // host doesn't leak which one tripped. `sizeBytes` is the byte
      // size the row landed at, so the block can update its own quota
      // estimate without another round-trip to `getQuota`.
      type: 'APP_STORAGE_SET_RESULT';
      payload: { requestId: string; ok: boolean; error?: string; sizeBytes?: number };
    }
  | {
      // Reply to APP_STORAGE_DELETE. `deleted: false` indicates the
      // key wasn't present (still treated as success); explicit so
      // callers can distinguish "I cleared it" from "it was already
      // gone."
      type: 'APP_STORAGE_DELETE_RESULT';
      payload: { requestId: string; ok: boolean; deleted: boolean; error?: string };
    }
  | {
      // Reply to APP_STORAGE_LIST. `keys` carries the key + a
      // last-write timestamp (ISO string on the wire; the hook
      // rehydrates to Date). `nextCursor` is omitted when the page is
      // partial.
      type: 'APP_STORAGE_LIST_RESULT';
      payload: {
        requestId: string;
        keys: Array<{ key: string; updatedAt: string }>;
        nextCursor?: string;
        error?: string;
      };
    }
  | {
      type: 'APP_STORAGE_QUOTA_RESULT';
      payload: {
        requestId: string;
        usedBytes: number;
        rowCount: number;
        limitBytes: number;
        limitRows: number;
        error?: string;
      };
    }
  | {
      // Reply to SHARED_LIST. `items` are newest-first; `createdAt`/`updatedAt`
      // are ISO strings on the wire (the hook rehydrates to Date). `nextCursor`
      // is omitted on the final page. `error` on host-side failure — consumers
      // treat a non-empty `error` as the promise-reject signal (mirrors
      // `APP_STORAGE_LIST_RESULT`).
      type: 'SHARED_LIST_RESULT';
      payload: {
        requestId: string;
        items: SharedStorageItemWire[];
        nextCursor?: string;
        error?: string;
      };
    }
  | {
      // Reply to SHARED_GET_COUNT. `count` is the entry's current vote total
      // (0 when the key isn't present).
      type: 'SHARED_GET_COUNT_RESULT';
      payload: { requestId: string; count: number; error?: string };
    }
  | {
      // Reply to SHARED_GET_COUNTS. `counts` maps each requested key to its
      // vote total (absent keys resolve to 0).
      type: 'SHARED_GET_COUNTS_RESULT';
      payload: { requestId: string; counts: Record<string, number>; error?: string };
    }
  | {
      // Reply to SHARED_APPEND. `key` is the id the host minted for the new
      // entry. `error` on validation/host failure.
      type: 'SHARED_APPEND_RESULT';
      payload: { requestId: string; key: string; error?: string };
    }
  | {
      // Reply to SHARED_VOTE. `count` is the entry's vote total AFTER applying
      // the (idempotent) vote from this viewer.
      type: 'SHARED_VOTE_RESULT';
      payload: { requestId: string; count: number; error?: string };
    }
  | {
      // Reply to SHARED_UNVOTE. `count` is the entry's vote total AFTER
      // removing this viewer's vote (idempotent when they hadn't voted).
      type: 'SHARED_UNVOTE_RESULT';
      payload: { requestId: string; count: number; error?: string };
    }
  | {
      // Reply to SHARED_WITHDRAW. `deleted: false` means the viewer's entry
      // wasn't present (still treated as success — idempotent withdraw).
      type: 'SHARED_WITHDRAW_RESULT';
      payload: { requestId: string; ok: boolean; deleted: boolean; error?: string };
    }
  | {
      // Reply to SHARED_UPDATE. `ok: true` when the author's entry was updated
      // in place (key/votes/reports preserved). `error` on failure — `NOT_FOUND`
      // (missing/hidden), `FORBIDDEN` (viewer isn't the author), or a
      // belt/size/serialization rejection. Consumers treat a non-empty `error`
      // (or `ok: false`) as the promise-reject signal (mirrors
      // `SHARED_WITHDRAW_RESULT`).
      type: 'SHARED_UPDATE_RESULT';
      payload: { requestId: string; ok: boolean; error?: string };
    }
  | {
      // Reply to SHARED_GET (single-row fetch-by-key). On success `item` is the
      // same wire shape as one `SHARED_LIST_RESULT` item (incl. `count` +
      // `viewerVoted`), or `null` when the key is missing / hidden (so a `?g=`
      // deep-link to a withdrawn or moderated row resolves cleanly to "not
      // found" rather than leaking it). `error` on host-side failure — consumers
      // treat a non-empty `error` as the promise-reject signal.
      type: 'SHARED_GET_RESULT';
      payload: { requestId: string; item: SharedStorageItemWire | null; error?: string };
    }
  | {
      // Reply to SHARED_REPORT. `ok: true` when the report was filed for mod
      // review. `error` on host-side failure — NOT_FOUND (missing key), a
      // trust/scope rejection, or rate-limit. Consumers treat a non-empty
      // `error` (or `ok: false`) as the reject signal (mirrors
      // `SHARED_WITHDRAW_RESULT`). Filing a report does NOT hide the row — a
      // moderator decides.
      type: 'SHARED_REPORT_RESULT';
      payload: { requestId: string; ok: boolean; error?: string };
    }
  | {
      // Reply to SAVE_IMAGE (host-mediated download bridge). `ok: true` once the
      // host has triggered the browser download in its unsandboxed top frame.
      // `error` on host-side failure — a URL whose origin isn't on the civitai
      // image/blob allowlist, an `imageId` the requesting viewer isn't allowed
      // to see (gated read returned `hidden`/omitted), an over-size blob, or a
      // fetch failure. Consumers treat a non-empty `error` (or `ok: false`) as
      // the reject signal.
      type: 'SAVE_IMAGE_RESULT';
      payload: { requestId: string; ok: boolean; error?: string };
    }
  | { type: 'SUSPEND'; payload?: undefined }
  | { type: 'RESUME'; payload?: undefined };

export type ParentToBlockMessageType = ParentToBlockMessage['type'];

// ============================================================
// Block → parent
// ============================================================

export type BlockToParentMessage =
  // READINESS ANNOUNCE (the inverted handshake). Posted by the block's
  // transport the instant its `message` listener is attached — i.e. the first
  // moment a `BLOCK_INIT` could possibly be received — so the host can push the
  // payload IN RESPONSE instead of blind-polling for it.
  //
  // 🔴 It is a HINT, never a precondition. It carries no data, expects no
  // reply, and a host that never receives one (because the block runs an older
  // SDK, because the post was dropped, or because the block simply never sends
  // it) must still deliver `BLOCK_INIT` on its own bounded retry/timeout
  // schedule. Conversely a host that does not understand `BLOCK_HELLO` ignores
  // it — nothing about the handshake depends on it being handled.
  //
  // It is posted BEFORE any `BLOCK_INIT` has been validated, so at that moment
  // the block has NOT yet authenticated its parent. That is precisely why the
  // payload is empty: it discloses nothing a parent frame cannot already infer
  // from the URL it framed.
  | { type: 'BLOCK_HELLO'; payload?: undefined }
  | { type: 'BLOCK_READY'; payload: { height: number } }
  | { type: 'BLOCK_ERROR'; payload: { message: string; fatal: boolean } }
  | { type: 'REQUEST_TOKEN'; payload: { requestId: string; blockInstanceId: string } }
  | { type: 'RESIZE_IFRAME'; payload: { height: number } }
  // `idempotencyKey` (OPTIONAL): a stable client id the block reuses across its
  // own retry of the SAME logical submit. The host forwards it to the server,
  // which threads it to the orchestrator `externalId` dedupe so a lost-response /
  // timeout retry collapses to the existing workflow instead of a SECOND Buzz
  // charge. Absent → today's behavior (no dedupe). Additive/backward-compatible:
  // an older host that ignores the field simply never dedupes.
  | {
      type: 'SUBMIT_WORKFLOW';
      payload: { requestId: string; body: WorkflowBody; idempotencyKey?: string };
    }
  | { type: 'ESTIMATE_WORKFLOW'; payload: { requestId: string; body: WorkflowBody } }
  // `waitSeconds` (OPTIONAL): ask the host to LONG-POLL this read — to hold the
  // request open on the orchestrator (its `?wait=` parameter, in SECONDS, not
  // milliseconds) until the workflow reaches a terminal status, instead of
  // answering with whatever the status is right now. Absent → today's behavior
  // (an immediate read). Additive/backward-compatible in BOTH directions: an
  // older host that ignores the field answers immediately, and a block that
  // never sends it is unaffected by a host that honors it.
  //
  // 🔴 ONLY SEND THIS FROM A LOOP THAT AWAITS EACH POLL BEFORE ISSUING THE NEXT.
  // A fixed `setInterval` against a host holding 15s stacks ~7 concurrent
  // requests per workflow — which is why this is a per-message hint rather than
  // a server-side default: deployed blocks' loop shapes are unknown and cannot
  // be assumed sequential. `useBuzzWorkflow().watch()` is sequential by
  // construction and is the intended sender.
  | {
      type: 'POLL_WORKFLOW';
      payload: { requestId: string; workflowId: string; waitSeconds?: number };
    }
  // Ask the host to cancel a running workflow on the orchestrator (real
  // server-side stop, not just client-side untracking). The host re-derives
  // ownership from the viewer's orchestrator token, so a block can only
  // cancel workflows the viewer owns.
  | { type: 'CANCEL_WORKFLOW'; payload: { requestId: string; workflowId: string } }
  | { type: 'OPEN_BUZZ_PURCHASE'; payload: { requestId: string; suggestedAmount?: number } }
  // Ask the host for the viewer's per-pool Buzz balance. Host-mediated + token-
  // bound: the host reads it via the `blocks.getMyBuzzBalance` tRPC mutation
  // (scoped to the block token's viewer) and replies with `BUZZ_BALANCE_RESULT`.
  // The block never sees the balance API or credentials directly.
  | { type: 'GET_BUZZ_BALANCE'; payload: { requestId: string } }
  // Ask the host for the signed-in viewer (id/username/status + optional
  // buzzBudget). Host-mediated + token-bound: the host resolves the viewer from
  // the block token and reads via the `blocks.getMyViewer` tRPC mutation,
  // replying with `VIEWER_RESULT`. An anonymous / banned token comes back as the
  // reply's free-text `error`. The block never sees the viewer API directly.
  | { type: 'GET_VIEWER'; payload: { requestId: string } }
  // Ask the host for the viewer's Buzz-transaction ledger page. Host-mediated +
  // token-bound (scope `buzz:read:self`): the host self-binds the account off
  // the block token and reads via `blocks.getMyBuzzTransactions`, replying with
  // `BUZZ_TRANSACTIONS_RESULT`. `params` are advisory filters — never trusted for
  // auth. The block never sees the ledger API or credentials directly.
  | {
      type: 'GET_BUZZ_TRANSACTIONS';
      payload: { requestId: string; params?: BlockBuzzTransactionsParams };
    }
  // Ask the host for the viewer's all-pool Buzz balances (scope `buzz:read:self`).
  // Host reads via `blocks.getMyBuzzAccounts` → `BUZZ_ACCOUNTS_RESULT`.
  | { type: 'GET_BUZZ_ACCOUNTS'; payload: { requestId: string } }
  // Ask the host for the viewer's per-modelVersion generation compensation for
  // the month of `params.date` (scope `buzz:read:self`). Host reads via
  // `blocks.getMyDailyCompensation` → `DAILY_COMPENSATION_RESULT`.
  | {
      type: 'GET_DAILY_COMPENSATION';
      payload: { requestId: string; params?: BlockDailyCompensationParams };
    }
  // Ask the host to import a wildcard pack's parsed prompt lists by model version.
  // TOKEN-INDEPENDENT (no block scope): the host resolves + fetches + unzips +
  // parses it in the USER'S authenticated page session (every real download gate
  // enforced) and replies with `WILDCARD_PACK_RESULT` (a `pack` or a discriminated
  // `error` code). The untrusted iframe never sees the session, signed URL, or raw
  // bytes.
  | { type: 'GET_WILDCARD_PACK'; payload: { requestId: string; modelVersionId: number } }
  // Ask the host for a page of the calling app's OWN generator subqueue — the
  // tag-scoped list of generations this app produced for the viewer, newest-first
  // (scope `ai:write:budgeted`, same trust boundary as submit). Host-mediated +
  // token-bound: the host self-binds the account off the block token and forces
  // the per-app tag filter (the params carry NO `tags` — a block can't widen it),
  // reading via `blocks.queryAppWorkflows`, and replies with `APP_WORKFLOWS_RESULT`.
  // `params` (cursor/limit) are advisory — never trusted for auth.
  | {
      type: 'QUERY_APP_WORKFLOWS';
      payload: { requestId: string; params?: AppWorkflowsParams };
    }
  | {
      // Ask the host to PUBLISH selected outputs of ONE of the calling app's OWN
      // workflows (from its app subqueue) as bare, REAL-SCANNED public Image rows.
      // The block sends `workflowId` + optional `imageIndexes` (indexes into the
      // workflow's `images` as seen via QUERY_APP_WORKFLOWS) — NEVER urls: the
      // HOST resolves the orchestrator urls server-side from the ownership-
      // verified workflow, so the iframe can't inject an arbitrary blob. FAIL-
      // CLOSED server-side: the host re-derives (viewer, app, workflowId)
      // ownership before reading the workflow, re-uploads each selected output to
      // civitai storage, and runs the FULL image-scan pipeline (no skip). No Post,
      // no gallery attach, no rewards/notifications. Host reads via
      // `blocks.publishGenerationOutputs` → `PUBLISH_RESULT`. Host-chrome shows a
      // consent confirm before publishing. `imageIndexes` absent ⇒ all available
      // outputs. `title` is an optional advisory label (host MAY ignore it).
      type: 'PUBLISH_GENERATION_OUTPUTS';
      payload: { requestId: string; workflowId: string; imageIndexes?: number[]; title?: string };
    }
  | {
      // Ask the host for per-VIEWER gated display data for a set of image ids
      // (the ids a benchmark grid stored via shared storage). The host applies
      // the REQUESTING VIEWER's browsing-level clamp server-side and returns a
      // `BlockGatedImage` per resolvable id: `visible` (moderated projection incl.
      // url) or `hidden` (NO url — above ceiling / unscanned / flagged). The block
      // can NEVER obtain an unclamped url for an image the viewer isn't allowed to
      // see. Host reads via `blocks.getImagesByIds` → `IMAGES_RESULT`.
      type: 'GET_IMAGES_BY_IDS';
      payload: { requestId: string; imageIds: number[] };
    }
  // Ask the host to cancel ONE workflow in the calling app's OWN subqueue. FAIL-
  // CLOSED server-side: the host re-derives (viewer, app, workflowId) ownership +
  // asserts the per-app tag before the orchestrator cancel, so a block can only
  // cancel a workflow it actually submitted for this viewer. Host reads via
  // `blocks.cancelAppWorkflow` → `CANCEL_APP_WORKFLOW_RESULT` (the terminal
  // projection, or a free-text `error`).
  | { type: 'CANCEL_APP_WORKFLOW'; payload: { requestId: string; workflowId: string } }
  | {
      // Ask the host to open the platform's Checkpoint picker. `baseModelGroup`
      // is the ecosystem key (e.g. 'Flux1', 'SDXL') the picker filters to —
      // typically derived from `useBlockContext().context.checkpoint?.baseModel`
      // or from the LoRA's `baseModel` via the platform's group mapping.
      type: 'OPEN_CHECKPOINT_PICKER';
      payload: {
        requestId: string;
        baseModelGroup: string;
        /** Currently-selected versionId so the picker can pre-highlight it. */
        currentVersionId?: number;
      };
    }
  | {
      // Ask the host (PAGE surface) to open its native resource picker filtered
      // to a single type. Generalizes OPEN_CHECKPOINT_PICKER from Checkpoint-only
      // to a typed allowlist (v1: 'Checkpoint' | 'LORA'); the host REJECTS any
      // other `resourceType` (the modal never opens, the hook resolves to null
      // via the SDK timeout — callers should restrict to the allowed types).
      // `baseModelGroup` is an optional family hint (ecosystem key like 'Flux1'
      // or a baseModel name) so a LoRA pick can be constrained to the page's
      // checkpoint family. The host returns ONLY the chosen `BlockResourceInfo`.
      type: 'OPEN_RESOURCE_PICKER';
      payload: {
        requestId: string;
        resourceType: BlockResourcePickerType;
        /** Optional base-model family hint (ecosystem key or baseModel name). */
        baseModelGroup?: string;
      };
    }
  | {
      // Ask the host to open its native image-upload modal (host-chrome — the
      // iframe never handles the bytes). The app decides what the image is for
      // (avatar / cover / background / reference / img2img source / …).
      //
      // `purpose` selects the upload MODE (absent ⇒ `'display'`, so an older SDK
      // stays byte-compatible — the host normalizes an unknown value to the safe
      // moderated default):
      //   • `'display'` — a PUBLIC image; routes through civitai's session-authed
      //     scan pipeline (SFW + no-flag gate). The host returns a MODERATED
      //     {@link BlockUploadedImageInfo} on `IMAGE_UPLOAD_RESULT`.
      //   • `'generationSource'` — a PRIVATE img2img source; UNSCANNED (the
      //     orchestrator scans at gen time). The host returns ONLY the source
      //     shape ({@link BlockGenerationSourceImageInfo} — { url, width, height }).
      // Generalizes cleanly the same way OPEN_RESOURCE_PICKER did the picker.
      //
      // `asyncScan` OPTS IN to the NON-BLOCKING display flow (absent/false ⇒
      // BLOCKING, byte-compatible with an older SDK/host):
      //   • absent / `false` — the host blocks on the scan and returns a MODERATED
      //     {@link BlockUploadedImageInfo} on `IMAGE_UPLOAD_RESULT` (as before).
      //   • `true` (display only) — the host EARLY-RESOLVES on persist with a
      //     {@link BlockPendingImageInfo} (`status:'pending'`), then streams the
      //     scan verdict on `IMAGE_SCAN_RESOLVED`. IGNORED for `'generationSource'`
      //     (that path has no host-side scan). An older host that predates the flag
      //     ignores it and blocking-resolves a moderated image — the SDK hook
      //     tolerates that (treats it as immediately-scanned; see the compat matrix
      //     in `useImageUpload`).
      type: 'OPEN_IMAGE_UPLOAD';
      payload: { requestId: string; purpose?: BlockUploadPurpose; asyncScan?: boolean };
    }
  | {
      // Persist a viewer's checkpoint override via the host. `null` clears
      // the override and falls back to the publisher default.
      type: 'SET_USER_CHECKPOINT';
      payload: { requestId: string; versionId: number | null };
    }
  | {
      type: 'NAVIGATE';
      payload: { path: string; target: 'current' | 'new_tab' };
    }
  // Anonymous conversion. A block rendered for a logged-out viewer
  // (`BLOCK_INIT.viewer === null`) asks the host to start the platform's
  // login flow when the user clicks an action that needs auth/money (e.g.
  // Generate). The host validates this like every other inbound message
  // (origin + `event.source` pinned, only honored after BLOCK_READY) and
  // opens its login UI. `returnUrl` is an optional same-origin in-app path
  // to return to after sign-in; the host sanitises it (rejecting absolute /
  // protocol-relative values) and defaults to the current page when omitted.
  // Fire-and-forget — there is no host→block reply (the page reloads /
  // re-inits the block as an authenticated viewer once login completes).
  | {
      type: 'REQUEST_SIGN_IN';
      payload?: { returnUrl?: string };
    }
  // Lazy consent. A block rendered for a LOGGED-IN viewer whose block token is
  // missing a consent-gated scope (e.g. `ai:write:budgeted` / `buzz:read:self`
  // were withheld at mint because the viewer hasn't granted them yet) asks the
  // host to open its consent UI when the user clicks an action that needs that
  // capability (e.g. Generate) — instead of prompting on load. The host already
  // knows which scopes are missing (from the mint response), so `scopes` is an
  // optional advisory hint; the host grants the missing set it computed and
  // re-mints the token. The host validates this like every inbound message
  // (origin + `event.source` pinned, only honored after BLOCK_READY).
  //
  // Fire-and-forget — there is no host→block reply. On grant the host re-mints
  // and pushes a TOKEN_REFRESH carrying the now-granted scopes; the block sees
  // the new scope on its token and retries the action. Mirrors REQUEST_SIGN_IN.
  | {
      type: 'REQUEST_CONSENT';
      payload?: { scopes?: string[] };
    }
  | {
      type: 'TRACK_EVENT';
      payload: { eventName: string; properties?: Record<string, unknown> };
    }
  // Civitai Apps KV datastore (W4-v0). Storage calls go through the host —
  // the block never sees the apps DB credentials. Scope is (block instance,
  // user). `value` is freeform JSON; the host enforces a 64 KB per-value
  // cap and a 50 MB per-app quota.
  | {
      type: 'APP_STORAGE_GET';
      payload: { requestId: string; key: string };
    }
  | {
      type: 'APP_STORAGE_SET';
      payload: { requestId: string; key: string; value: unknown };
    }
  | {
      type: 'APP_STORAGE_DELETE';
      payload: { requestId: string; key: string };
    }
  | {
      type: 'APP_STORAGE_LIST';
      payload: { requestId: string; prefix?: string; limit?: number; cursor?: string };
    }
  | {
      type: 'APP_STORAGE_QUOTA';
      payload: { requestId: string };
    }
  // Civitai Apps SHARED datastore (W?-Phase 2). Unlike APP_STORAGE (per block
  // instance + viewer, arbitrary JSON), the SHARED store is APP-scoped, append-
  // only, and community-votable: any viewer appends a `{ title, body? }` entry
  // and any viewer votes it up/down. Calls go through the host — the block never
  // sees the datastore credentials, and the host injects the viewer identity +
  // block token (the block sends NO token).
  | {
      type: 'SHARED_LIST';
      payload: { requestId: string; prefix?: string; limit?: number; cursor?: string };
    }
  | {
      type: 'SHARED_GET_COUNT';
      payload: { requestId: string; key: string };
    }
  | {
      type: 'SHARED_GET_COUNTS';
      payload: { requestId: string; keys: string[] };
    }
  | {
      type: 'SHARED_APPEND';
      payload: { requestId: string; value: SharedStorageValue };
    }
  | {
      type: 'SHARED_VOTE';
      payload: { requestId: string; key: string };
    }
  | {
      type: 'SHARED_UNVOTE';
      payload: { requestId: string; key: string };
    }
  | {
      type: 'SHARED_WITHDRAW';
      payload: { requestId: string; key: string };
    }
  // Author-scoped in-place update of a SHARED entry the viewer contributed.
  // The host re-derives ownership from the injected viewer identity (the block
  // sends NO token) and rejects a non-author with FORBIDDEN / a missing (or
  // hidden) key with NOT_FOUND. `title`/`body` go through the same content
  // belt as SHARED_APPEND; `data` is opaque. The `key` and vote/report totals
  // are preserved — only the contributed `value` changes.
  | {
      type: 'SHARED_UPDATE';
      payload: { requestId: string; key: string; value: SharedStorageValue };
    }
  // Fetch ONE shared entry by key — the single-row companion to SHARED_LIST's
  // paged read, so a `?g=<key>` deep-link to an item past the first page
  // resolves. Host reads via `apps.shared.get`, replying with
  // `SHARED_GET_RESULT` (the full item incl. `count`/`viewerVoted`, or `null`
  // for a missing/hidden row). Respects the SAME per-viewer visibility gate as
  // `list` — a hidden/withdrawn row is never leaked. The block sends NO token.
  | {
      type: 'SHARED_GET';
      payload: { requestId: string; key: string };
    }
  // Report a posted shared entry for moderator review (post-write abuse
  // reporting on a shared board). Host reads via `apps.shared.report`, replying
  // with `SHARED_REPORT_RESULT`. Trust-gated + rate-limited server-side (same
  // write-scope trust boundary as SHARED_APPEND). `reason` is optional free
  // text (bounded server-side). The block sends NO token.
  | {
      type: 'SHARED_REPORT';
      payload: { requestId: string; key: string; reason?: string };
    }
  // Ask the host to DOWNLOAD an image the block already displays — the host
  // fetches the blob in its UNSANDBOXED top frame and triggers the browser
  // "Save As" (a sandboxed opaque-origin block lacks `allow-downloads`, so it
  // can only copy a URL). Host reads/validates + downloads, replying with
  // `SAVE_IMAGE_RESULT`. TWO complementary variants (send exactly one of `url`
  // / `imageId`):
  //   • `url` — the block's OWN fresh generation output (an orchestration blob
  //     it has no `imageId` for yet). The host ALLOWLISTS the URL's origin to
  //     the civitai image/blob CDN and REFUSES an arbitrary host (an unverified
  //     block's `url`/`data` is untrusted — never a host-side fetch of an
  //     attacker origin).
  //   • `imageId` — a cross-user grid image (e.g. a benchmark cell). The host
  //     resolves it through the SAME per-viewer gated read that backs
  //     `GET_IMAGES_BY_IDS`, so a withheld/above-ceiling image can NEVER be
  //     coerced into a download.
  // `filename` is an optional download name (the host sanitizes it — no path
  // traversal / duplicate-extension). The block sends NO token.
  | {
      type: 'SAVE_IMAGE';
      payload: {
        requestId: string;
        /** Own-output URL — origin-allowlisted host-side. Mutually exclusive with `imageId`. */
        url?: string;
        /** Cross-user image id — routed through the gated per-viewer read. Mutually exclusive with `url`. */
        imageId?: number;
        /** Optional download filename (host-sanitized). */
        filename?: string;
      };
    };

export type BlockToParentMessageType = BlockToParentMessage['type'];

/**
 * Narrowing helper for either-direction message handlers.
 *
 * **Discriminator-only.** This only checks `data.type`; it does NOT validate
 * the `payload` shape. A peer sending `{ type: 'BLOCK_INIT' }` with no
 * payload or a malformed payload will satisfy this guard, and downstream
 * access to fields like `data.payload.token.raw` will throw at runtime.
 * Transports that cross a trust boundary (e.g. iframe `postMessage`) MUST
 * runtime-validate the payload at the boundary before passing it on.
 *
 * Example:
 *   if (isMessage(event.data, 'BLOCK_INIT')) {
 *     // narrowed to BlockInitPayload — still must be validated
 *   }
 */
export function isMessage<T extends ParentToBlockMessage | BlockToParentMessage, K extends T['type']>(
  data: unknown,
  type: K,
): data is Extract<T, { type: K }> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as { type: unknown }).type === type
  );
}
