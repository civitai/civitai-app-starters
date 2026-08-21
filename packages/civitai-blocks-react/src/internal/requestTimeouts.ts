import type { BlockToParentMessageType } from '@civitai/app-sdk/blocks';

import type { OutboundRequest } from './transport.js';

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
 * paid for nothing.
 *
 * Formerly `PICKER_REQUEST_TIMEOUT_MS`, in `hooks/useCheckpointPicker.ts`. That
 * name described the first caller rather than the property that selects it, so
 * a consent confirm did not read as "a picker" to the author who omitted it.
 * It was never re-exported from `src/index.ts` and the package `exports` map has
 * no deep hook paths, so the rename touches no reachable API.
 */
export const HUMAN_INTERACTION_TIMEOUT_MS = 10 * 60_000;

/** Which bound a block→parent message is answered under. */
export type RequestTimeoutClass =
  /** Reply waits on a PERSON — must pass {@link HUMAN_INTERACTION_TIMEOUT_MS}. */
  | 'human'
  /** Reply is a server/host round-trip — {@link DEFAULT_REQUEST_TIMEOUT_MS} is right. */
  | 'protocol'
  /** Fire-and-forget `sendMessage`: no `requestId`, no pending promise, no timeout. */
  | 'no-reply';

/**
 * 🔴 THE TOTALITY GATE — every block→parent message type, bucketed.
 *
 * `satisfies Record<BlockToParentMessageType, …>` makes this record TOTAL: add a
 * message type to the SDK union and `pnpm --filter @civitai/blocks-react
 * typecheck` FAILS here until somebody decides which bound it answers under. A
 * new capability is almost always a new message type, so this is the check that
 * reaches the shape of civitai/civitai#4158 — a hook that never appears in any
 * ledger because nobody thought to add it.
 *
 * 🔴 IT FORCES A DECISION, NOT A CORRECT ONE. Nothing here can stop an author
 * bucketing a consent confirm as `'protocol'`; what it removes is the case where
 * the question is never asked. Weigh the bucket against the one question that
 * decides it: DOES THE REPLY WAIT FOR A PERSON TO ACT? If yes it is `'human'`,
 * however fast that person usually is.
 *
 * The runtime ledger below is DERIVED from this record, so the two cannot drift.
 */
const REQUEST_TIMEOUT_CLASS = {
  // ── Gated on a human ────────────────────────────────────────────────────
  OPEN_BUZZ_PURCHASE: 'human', //          viewer walks a purchase flow
  OPEN_CHECKPOINT_PICKER: 'human', //      viewer browses + picks
  OPEN_IMAGE_UPLOAD: 'human', //           viewer chooses a file
  OPEN_RESOURCE_PICKER: 'human', //        viewer browses + picks
  PUBLISH_GENERATION_OUTPUTS: 'human', //  viewer answers a consent confirm (#4158)

  // ── Fire-and-forget: no requestId, so no pending promise to time out ────
  BLOCK_ERROR: 'no-reply',
  BLOCK_HELLO: 'no-reply',
  BLOCK_READY: 'no-reply',
  NAVIGATE: 'no-reply',
  // Human-gated in SPIRIT, but the host never replies — a grant arrives later as
  // an unsolicited TOKEN_REFRESH push, so there is nothing here to bound.
  REQUEST_CONSENT: 'no-reply',
  REQUEST_SIGN_IN: 'no-reply',
  RESIZE_IFRAME: 'no-reply',
  TRACK_EVENT: 'no-reply',

  // ── Protocol round-trips: the host answers, no person in the loop ───────
  APP_STORAGE_DELETE: 'protocol',
  APP_STORAGE_GET: 'protocol',
  APP_STORAGE_LIST: 'protocol',
  APP_STORAGE_QUOTA: 'protocol',
  APP_STORAGE_SET: 'protocol',
  CANCEL_APP_WORKFLOW: 'protocol',
  CANCEL_WORKFLOW: 'protocol',
  // The workflow trio is server-bound, not person-bound. It carries its OWN
  // longer bound (`WORKFLOW_REQUEST_TIMEOUT_MS` in `hooks/useBuzzWorkflow.ts`)
  // for orchestrator latency — a different reason for a different number.
  ESTIMATE_WORKFLOW: 'protocol',
  POLL_WORKFLOW: 'protocol',
  SUBMIT_WORKFLOW: 'protocol',
  GET_BUZZ_ACCOUNTS: 'protocol',
  GET_BUZZ_BALANCE: 'protocol',
  GET_BUZZ_TRANSACTIONS: 'protocol',
  GET_DAILY_COMPENSATION: 'protocol',
  GET_IMAGES_BY_IDS: 'protocol',
  GET_VIEWER: 'protocol',
  GET_WILDCARD_PACK: 'protocol',
  QUERY_APP_WORKFLOWS: 'protocol',
  REQUEST_TOKEN: 'protocol',
  // The host fetches the blob and triggers the browser's own download; it replies
  // when the download STARTS, not when a person picks a destination. NOTE: that
  // host-side fetch is of an arbitrarily large image and could itself exceed 30s
  // — a pre-existing question about the right protocol bound, independent of
  // whether a human is involved. Not reclassified here.
  SAVE_IMAGE: 'protocol',
  SET_USER_CHECKPOINT: 'protocol',
  SHARED_APPEND: 'protocol',
  SHARED_GET: 'protocol',
  SHARED_GET_COUNT: 'protocol',
  SHARED_GET_COUNTS: 'protocol',
  SHARED_LIST: 'protocol',
  SHARED_REPORT: 'protocol',
  SHARED_UNVOTE: 'protocol',
  SHARED_UPDATE: 'protocol',
  SHARED_VOTE: 'protocol',
  SHARED_WITHDRAW: 'protocol',
} satisfies Record<BlockToParentMessageType, RequestTimeoutClass>;

/** The keys of {@link REQUEST_TIMEOUT_CLASS} bucketed as `C`, at the type level. */
type KeysBucketed<C extends RequestTimeoutClass> = {
  [K in keyof typeof REQUEST_TIMEOUT_CLASS]: (typeof REQUEST_TIMEOUT_CLASS)[K] extends C
    ? K
    : never;
}[keyof typeof REQUEST_TIMEOUT_CLASS];

type HumanGatedRequestType = KeysBucketed<'human'>;
type NoReplyMessageType = KeysBucketed<'no-reply'>;

/** `true` when `T` is `never` — used to reject a VACUOUSLY-satisfied assertion below. */
type IsNever<T> = [T] extends [never] ? true : false;

/**
 * 🔴 THE BUCKETING IS CHECKED IN BOTH DIRECTIONS, AND ONE DIRECTION ALONE IS NOT
 * ENOUGH. `OutboundRequest['type']` is exactly the set of message types carrying
 * a `requestId` — i.e. the ones with a timeout to set — so:
 *
 *  (a) every `'human'` key MUST be in it. Bucketing a fire-and-forget message as
 *      `'human'` would put an entry in the ledger that the guard test cannot
 *      drive, and this fails `tsc` instead.
 *
 *  (b) NO `'no-reply'` key may be in it — the converse, and the one whose absence
 *      left this bug's own shape reachable one level down. Without (b), a FUTURE
 *      request type (one that does carry a `requestId`) bucketed `'no-reply'`
 *      compiles clean, is excluded from the derived ledger, never gets a
 *      `timeoutMs`, and silently inherits the 30s default — civitai/civitai#4158
 *      all over again, arriving through the hole next to the one that was closed.
 *      Zero instances today; this keeps it that way.
 *
 * Both are `undefined as unknown as …` assignments: erased at build, checked by
 * `tsc`, no runtime cost.
 */
const _humanGatedAreRequests: OutboundRequest['type'] =
  undefined as unknown as HumanGatedRequestType;
void _humanGatedAreRequests;

const _noReplyAreNotRequests: never = undefined as unknown as Extract<
  NoReplyMessageType,
  OutboundRequest['type']
>;
void _noReplyAreNotRequests;

/**
 * 🔴 NON-VACUITY GUARDS — without these, BOTH assertions above pass in the one
 * state that matters. `never` is assignable to everything, so if every `'human'`
 * bucket were removed `HumanGatedRequestType` degenerates to `never` and (a)
 * succeeds while asserting nothing; the same is true of (b) for `'no-reply'`.
 * A check that goes green precisely when its subject has been deleted is not
 * load-bearing, so pin both buckets non-empty.
 */
const _humanBucketIsNonEmpty: false = undefined as unknown as IsNever<HumanGatedRequestType>;
void _humanBucketIsNonEmpty;

const _noReplyBucketIsNonEmpty: false = undefined as unknown as IsNever<NoReplyMessageType>;
void _noReplyBucketIsNonEmpty;

/**
 * THE RUNTIME LEDGER: every request whose reply waits on a human action, and
 * therefore every request that must pass {@link HUMAN_INTERACTION_TIMEOUT_MS}
 * rather than inherit {@link DEFAULT_REQUEST_TIMEOUT_MS}.
 *
 * DERIVED from {@link REQUEST_TIMEOUT_CLASS}, never hand-maintained — the
 * totality gate above is what makes a NEW type impossible to omit, and this
 * projection is what makes an EXISTING one impossible to leave unwired.
 *
 * 🔴 WHAT EACH HALF ACTUALLY CATCHES — the two are not interchangeable, and an
 * earlier revision of this file overclaimed by conflating them:
 *
 *  - `test/humanGatedRequestTimeouts.test.tsx` pins this derived set exactly and
 *    behaviourally drives every member past the default window. That catches a
 *    REGRESSION on an already-bucketed type: dropping its `timeoutMs`, or
 *    quietly deleting it from the ledger. It CANNOT catch a type that was never
 *    bucketed `'human'` — a test enumerating the ledger is green when the ledger
 *    is wrong in that direction, which is precisely how #4158 shipped.
 *  - The `satisfies` totality gate is the half that reaches the unlisted case,
 *    and it does so at `tsc` time, not in this suite. A new message type is a
 *    TYPE ERROR here until bucketed.
 */
export const HUMAN_GATED_REQUEST_TYPES: readonly BlockToParentMessageType[] = (
  Object.keys(REQUEST_TIMEOUT_CLASS) as (keyof typeof REQUEST_TIMEOUT_CLASS)[]
)
  .filter((t) => REQUEST_TIMEOUT_CLASS[t] === 'human')
  .sort();
