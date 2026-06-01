/**
 * postMessage protocol between an embedding host page and an iframe-mode block.
 *
 * Discriminated by `type`. Both directions share this module so producers and
 * consumers stay in lockstep — adding a parent→block message means the block
 * side gets a compile error until it handles the new variant (and vice versa).
 *
 * Wire format: `window.postMessage({ type, payload }, targetOrigin)`.
 */

import type {
  BlockCheckpointInfo,
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
      // Reply to OPEN_CHECKPOINT_PICKER. `selected` is absent when the user
      // dismissed the picker without choosing — the block's hook resolves
      // to `{ selected: undefined }` in that case.
      type: 'CHECKPOINT_PICKER_RESULT';
      payload: { requestId: string; selected?: BlockCheckpointInfo };
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
      // Persist a viewer's checkpoint override via the host. `null` clears
      // the override and falls back to the publisher default.
      type: 'SET_USER_CHECKPOINT';
      payload: { requestId: string; versionId: number | null };
    }
  | {
      type: 'NAVIGATE';
      payload: { path: string; target: 'current' | 'new_tab' };
    }
  | {
      type: 'TRACK_EVENT';
      payload: { eventName: string; properties?: Record<string, unknown> };
    }
  // App Blocks KV datastore (W4-v0). Storage calls go through the host —
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
