import type { BlockToParentMessageType } from '@civitai/app-sdk/blocks';

/**
 * How long `IframeTransport.sendRequest` waits for a reply when the caller does
 * not say otherwise. Sized for a FAST PROTOCOL ROUND-TRIP — the host receives
 * the message, does its server-side work, and answers. Nothing on that path
 * waits for a person.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The timeout for a request whose reply is gated on a HUMAN ACTION — browsing a
 * catalog and picking, choosing a file to upload, confirming a publish, walking
 * a purchase flow. The host still resolves the moment the person acts (pick /
 * dismiss / confirm / close), so this is a ceiling on abandonment, not a delay
 * anyone waits out.
 *
 * 🔴 THE DEFAULT IS THE WRONG BOUND FOR THESE AND THE FAILURE IS EXPENSIVE.
 * 30 seconds is how long a person has to notice a modal, read it and click —
 * which is not long enough. `PUBLISH_GENERATION_OUTPUTS` shipped without this
 * opt-out and rejected mid-dialog (civitai/civitai#4158): the generation had
 * already been billed, the publish bridge died at 30s, the outputs reached
 * nothing, and there is no refund path for a dead bridge, so the viewer simply
 * paid for nothing. Anything added to {@link HUMAN_GATED_REQUEST_TYPES} MUST
 * pass this.
 *
 * Formerly `PICKER_REQUEST_TIMEOUT_MS`, in `hooks/useCheckpointPicker.ts`. That
 * name described the first caller rather than the property that selects it, so
 * a consent confirm did not read as "a picker" to the author who omitted it.
 * It was never re-exported from `src/index.ts` and the package `exports` map has
 * no deep hook paths, so the rename touches no public API.
 */
export const HUMAN_INTERACTION_TIMEOUT_MS = 10 * 60_000;

/**
 * THE LEDGER: every block→parent request whose reply waits on a human action,
 * and therefore every request that must pass
 * {@link HUMAN_INTERACTION_TIMEOUT_MS} rather than inherit
 * {@link DEFAULT_REQUEST_TIMEOUT_MS}.
 *
 * `test/humanGatedRequestTimeouts.test.tsx` pins this set EXACTLY (it fails when
 * the set grows or shrinks) and then drives the real hook for each member
 * through the real transport, asserting the request survives past the default
 * window. So adding a human-gated request type here without wiring the timeout
 * into its hook fails the suite, and adding such a hook without listing it here
 * fails the ledger assertion.
 *
 * DELIBERATELY EXCLUDED, so the omissions are decisions rather than oversights:
 *
 *  - `REQUEST_CONSENT` / `REQUEST_SIGN_IN` — human-gated, but fire-and-forget
 *    `sendMessage`, not `sendRequest`. There is no pending promise to time out;
 *    the grant arrives later as an unsolicited `TOKEN_REFRESH` push.
 *  - `SAVE_IMAGE` — the host fetches the blob and triggers the browser's own
 *    download; it replies when the download STARTS, not when a person picks a
 *    destination. A protocol round-trip.
 *  - `SUBMIT_WORKFLOW` / `ESTIMATE_WORKFLOW` / `POLL_WORKFLOW` — server-bound,
 *    no person in the loop. They carry their own longer bound
 *    (`WORKFLOW_REQUEST_TIMEOUT_MS` in `hooks/useBuzzWorkflow.ts`) for
 *    orchestrator latency, which is a different reason for a different number.
 */
export const HUMAN_GATED_REQUEST_TYPES: readonly BlockToParentMessageType[] = [
  'OPEN_BUZZ_PURCHASE',
  'OPEN_CHECKPOINT_PICKER',
  'OPEN_IMAGE_UPLOAD',
  'OPEN_RESOURCE_PICKER',
  'PUBLISH_GENERATION_OUTPUTS',
];
