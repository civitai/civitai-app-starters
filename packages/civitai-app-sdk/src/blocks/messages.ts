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
  BlockUploadPurpose,
  BlockContext,
  BlockSettings,
  Theme,
  ViewerInfo,
  WorkflowBody,
  BlockWorkflowSnapshot,
} from './types.js';

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
      // `selected` is a UNION keyed by the request's `purpose`:
      //   • `'display'` (default): a MODERATED public image
      //     ({@link BlockUploadedImageInfo} — imageId/nsfwLevel/contentRating/url,
      //     scanned clean, within the SFW ceiling, unflagged).
      //   • `'generationSource'`: an UNSCANNED private img2img source
      //     ({@link BlockGenerationSourceImageInfo} — only { url, width, height };
      //     no imageId/nsfwLevel, scanned by the orchestrator at gen time).
      // The variant the host returns matches the `purpose` the block requested;
      // narrow structurally (`'imageId' in selected`) when a block uses both.
      type: 'IMAGE_UPLOAD_RESULT';
      payload: {
        requestId: string;
        selected?: BlockUploadedImageInfo | BlockGenerationSourceImageInfo;
      };
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
  | { type: 'SUSPEND'; payload?: undefined }
  | { type: 'RESUME'; payload?: undefined };

export type ParentToBlockMessageType = ParentToBlockMessage['type'];

// ============================================================
// Block → parent
// ============================================================

export type BlockToParentMessage =
  | { type: 'BLOCK_READY'; payload: { height: number } }
  | { type: 'BLOCK_ERROR'; payload: { message: string; fatal: boolean } }
  | { type: 'REQUEST_TOKEN'; payload: { requestId: string; blockInstanceId: string } }
  | { type: 'RESIZE_IFRAME'; payload: { height: number } }
  | { type: 'SUBMIT_WORKFLOW'; payload: { requestId: string; body: WorkflowBody } }
  | { type: 'ESTIMATE_WORKFLOW'; payload: { requestId: string; body: WorkflowBody } }
  | { type: 'POLL_WORKFLOW'; payload: { requestId: string; workflowId: string } }
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
      type: 'OPEN_IMAGE_UPLOAD';
      payload: { requestId: string; purpose?: BlockUploadPurpose };
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
