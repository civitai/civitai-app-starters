/**
 * App reactions — the block side of `SET_ENTITY_REACTION` / `GET_ENTITY_REACTIONS`
 * (scope `social:react:self`, civitai/civitai#6144).
 *
 * A block may set, or read, the VIEWER'S reaction on an image a block endpoint
 * served it. The host calls `blocks.setReactionFromApp` /
 * `blocks.getReactionsForApp`, which run the SAME handler as the site's own
 * reaction button: rewards, metrics and notifications are the site's. What the
 * app path adds is an audit row per change, a provenance ticket per image and a
 * fail-closed kill switch.
 *
 * Every constant here MIRRORS civitai/civitai's
 * `src/shared/constants/block-reaction.constants.ts`. The host's copy is the
 * definition and this is the copy; `test/blocks/reactions.test.ts` pins each
 * value literally, so a change on either side is a visible diff here.
 *
 * The scope is `BLOCK_SCOPES.SOCIAL_REACT_SELF`: consent-gated (a token carries
 * it only after the viewer granted it) and sensitive (the manifest must justify
 * it in `scopeJustifications`).
 *
 * Zero dependencies, like the rest of `./blocks`.
 */

/**
 * The reactions an app may SET on an image.
 *
 * 🔴 `Dislike` IS DELIBERATELY ABSENT, and the host and the server both refuse
 * it. Image stats hardcode the dislike count to 0, so a Dislike is invisible on
 * the site, yet it is stored and still pays the reactor's encouragement reward.
 */
export const APP_REACTIONS = ['Like', 'Heart', 'Laugh', 'Cry'] as const;
export type BlockAppReaction = (typeof APP_REACTIONS)[number];

/**
 * Every reaction the site STORES. A viewer's existing reactions are reported in
 * this wider set: a viewer who disliked an image on the site still holds that
 * Dislike, and the read says so, even though an app may not set one.
 */
export const STORED_REACTIONS = ['Like', 'Dislike', 'Laugh', 'Cry', 'Heart'] as const;
export type BlockStoredReaction = (typeof STORED_REACTIONS)[number];

/** Entity types the host accepts. Image only in v1: nothing else is ticketed yet. */
export const REACTION_ENTITY_TYPES = ['image'] as const;
export type BlockReactionEntityType = (typeof REACTION_ENTITY_TYPES)[number];

/** Most ids one `GET_ENTITY_REACTIONS` may carry. More is refused as `invalid-request`. */
export const REACTION_READ_MAX_IDS = 100;

/** Longest ticket the host accepts. A real one is about 60 characters. */
export const REACT_TICKET_MAX_LENGTH = 256;

/**
 * The CLOSED set of errors `ENTITY_REACTION_RESULT` and `ENTITY_REACTIONS_RESULT`
 * carry. Unlike the follow and post bridges, the host maps EVERY failure,
 * its own refusals and every server error alike, onto one of these
 * (`classifyEntityReactionError` in civitai's `reactionGate.ts`), so a block can
 * branch on the code.
 *
 * - `invalid-request`: a malformed payload, or a reaction apps may not set
 *   (`Dislike`). A block bug, not a viewer outcome.
 * - `sign-in-required`: no session. Route it into `useRequestSignIn()`.
 * - `review-mode`: the app is running in a moderator's review sandbox, where
 *   the scope is never granted.
 * - `not-ready`: the host has not finished the handshake, or holds no token yet.
 *   Retry after `ready`.
 * - `needs-consent`: the viewer has not granted `social:react:self`. Ask with
 *   `useRequestConsent()`.
 * - `entity-unavailable`: everything else. A missing, expired or foreign
 *   ticket, an image the viewer may not react to, an owner who blocked the
 *   viewer, the kill switch, or a network failure. Deliberately one code: the
 *   block can retry or give up, and there is no truthful finer answer.
 * - `rate-limited`: the viewer's reaction quota is spent. It is the SAME quota
 *   the site's own reaction button draws on.
 */
export const ENTITY_REACTION_ERROR_CODES = [
  'invalid-request',
  'sign-in-required',
  'review-mode',
  'not-ready',
  'needs-consent',
  'entity-unavailable',
  'rate-limited',
] as const;
export type BlockEntityReactionErrorCode = (typeof ENTITY_REACTION_ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ENTITY_REACTION_ERROR_CODES);
const APP_REACTION_SET: ReadonlySet<string> = new Set(APP_REACTIONS);

/** `true` when `value` is one of the closed {@link ENTITY_REACTION_ERROR_CODES}. */
export function isEntityReactionErrorCode(value: unknown): value is BlockEntityReactionErrorCode {
  return typeof value === 'string' && ERROR_CODE_SET.has(value);
}

/** `true` when `value` is a reaction an app may set ({@link APP_REACTIONS}). */
export function isAppReaction(value: unknown): value is BlockAppReaction {
  return typeof value === 'string' && APP_REACTION_SET.has(value);
}

/** Reaction counts for one image, as the site's own feeds show them. */
export type BlockReactionCounts = Record<BlockAppReaction, number>;

/** One image's reaction state, as the read reports it. */
export interface BlockEntityReactionState {
  counts: BlockReactionCounts;
  /** Every reaction the viewer holds on the image. A viewer may hold several. */
  viewerReactions: BlockStoredReaction[];
  /**
   * `true` when the metric store could not answer for this image. `counts` are
   * then zeros, and must not be shown as "nobody reacted".
   */
  statsUnknown: boolean;
}

/** The success payload of `ENTITY_REACTION_RESULT`. */
export interface BlockEntityReactionResult extends BlockEntityReactionState {
  entityType: BlockReactionEntityType;
  entityId: number;
  reaction: BlockAppReaction;
  /**
   * Whether the viewer holds `reaction` NOW, read on the primary after the
   * write. 🔴 When this differs from the `reacted` the block asked for, a
   * concurrent change (a double tap, the viewer's own click elsewhere) won and
   * this request did not apply.
   */
  reacted: boolean;
  /**
   * Did THIS request write a change? `false` when the viewer was already in the
   * requested state: nothing was toggled, so nothing was paid and no metric
   * moved.
   */
  changed: boolean;
  /**
   * 🔴 `counts` CAN LAG `reacted`. They come from the metric store, which
   * updates asynchronously, so right after a change they may not include it yet.
   * `reacted` and `viewerReactions` are the truth.
   */
  counts: BlockReactionCounts;
}

/** The success payload of `ENTITY_REACTIONS_RESULT`. */
export interface BlockEntityReactionsResult {
  entityType: BlockReactionEntityType;
  /** One entry per ticketed id, keyed by the id as a string (it crossed JSON). */
  byId: Record<string, BlockEntityReactionState>;
  /**
   * Ids the host did not answer, because their ticket was missing, expired, or
   * issued to another app or viewer. 🔴 Not "the viewer has not reacted": an
   * unanswered id has NO known state, and a block must not offer a fresh
   * reaction on the assumption that there is none.
   */
  unavailable: number[];
}
