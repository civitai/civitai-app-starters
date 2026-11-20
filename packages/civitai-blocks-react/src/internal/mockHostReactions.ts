/**
 * mockHostReactions.ts — the dev host's half of `SET_ENTITY_REACTION` /
 * `GET_ENTITY_REACTIONS` (app reactions, civitai/civitai#6144).
 *
 * It mirrors the REAL host's decision order, from civitai's `reactionGate.ts`
 * and `blocks.setReactionFromApp` / `blocks.getReactionsForApp`:
 *
 *   1. no usable `requestId` → dropped (nothing to reply to);
 *   1b. a forced `review-mode` / `not-ready` (`reactionError`) → that code,
 *      since the host's preflight checks both before anything else;
 *   2. no viewer → `sign-in-required` (identity before payload);
 *   3. malformed payload, or a reaction apps may not set (`Dislike`) →
 *      `invalid-request`;
 *   4. `social:react:self` not among the manifest's declared scopes →
 *      `needs-consent`;
 *   5. the forced-error knob, when set;
 *   6. a write without a ticket → `entity-unavailable`; a read answers only
 *      ticketed ids and lists the rest in `unavailable`.
 *
 * 🔴 WHAT THIS CANNOT CHECK: whether a ticket is GENUINE. A real ticket is an
 * HMAC the server signs with a secret no block holds, so this mock accepts any
 * well-formed one (1 to 256 characters). A block that invents tickets passes
 * here and fails in production with `entity-unavailable`; the tickets a block
 * passes should be the `reactTicket` fields its images arrived with.
 *
 * The mock never produces `review-mode` or `not-ready` on its own; force them
 * with `reactionError`, and they are answered at step 1b, as the host would.
 */

import type {
  BlockAppReaction,
  BlockEntityReactionResult,
  BlockEntityReactionState,
  BlockEntityReactionsResult,
  BlockReactionCounts,
  BlockStoredReaction,
} from '@civitai/app-sdk/blocks';

import { REACTIONS } from '../hooks/useReactions.js';

/** The scope both messages need. */
export const REACTION_SCOPE = 'social:react:self';

/** A seeded image for the mock. Every field is optional; absent counts are 0. */
export interface MockReactionSeed {
  counts?: Partial<BlockReactionCounts>;
  viewerReactions?: BlockStoredReaction[];
  /** Report this image's counts as unknown, as the real metric store sometimes does. */
  statsUnknown?: boolean;
}

/** The reply payload, minus `requestId`. */
export type MockReactionReply<T> = { result: T } | { error: string };

const MAX_IDS = 100;
const MAX_TICKET = 256;

const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;
const isTicket = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_TICKET;
const isAppReaction = (v: unknown): v is BlockAppReaction =>
  typeof v === 'string' && (REACTIONS as readonly string[]).includes(v);

function zeroCounts(): BlockReactionCounts {
  return { Like: 0, Heart: 0, Laugh: 0, Cry: 0 };
}

export interface MockReactions {
  set(payload: unknown): MockReactionReply<BlockEntityReactionResult>;
  get(payload: unknown): MockReactionReply<BlockEntityReactionsResult>;
  /** Replace the seed and the forced error, as `setScenario` does. */
  configure(patch: { seed?: Record<number, MockReactionSeed>; error?: string | null }): void;
}

export function createMockReactions(opts: {
  seed?: Record<number, MockReactionSeed>;
  error?: string;
  /** Is a viewer signed in? Read on every call. */
  signedIn: () => boolean;
  /** Does the manifest declare the scope? Read on every call. */
  hasScope: () => boolean;
}): MockReactions {
  const states = new Map<number, BlockEntityReactionState>();
  let forcedError: string | undefined = opts.error;

  const seedWith = (seed: Record<number, MockReactionSeed> | undefined) => {
    states.clear();
    for (const [key, value] of Object.entries(seed ?? {})) {
      states.set(Number(key), {
        counts: { ...zeroCounts(), ...(value.counts ?? {}) },
        viewerReactions: [...(value.viewerReactions ?? [])],
        statsUnknown: value.statsUnknown === true,
      });
    }
  };
  seedWith(opts.seed);

  const stateOf = (id: number): BlockEntityReactionState =>
    states.get(id) ?? { counts: zeroCounts(), viewerReactions: [], statsUnknown: false };

  /** Steps 2 to 5; `null` when the request may proceed. */
  const refuse = (validPayload: boolean): string | null => {
    // The host's own preflight refusals come before everything else
    // (`reactionGate.ts`: review mode, then the handshake, then the viewer), so
    // a forced one is answered first. Every other forced code stands for a
    // SERVER answer, which only a request past the host's gate can get.
    if (forcedError === 'review-mode' || forcedError === 'not-ready') return forcedError;
    if (!opts.signedIn()) return 'sign-in-required';
    if (!validPayload) return 'invalid-request';
    if (!opts.hasScope()) return 'needs-consent';
    if (forcedError !== undefined) return forcedError;
    return null;
  };

  return {
    set(payload) {
      const p = (payload ?? {}) as Record<string, unknown>;
      const valid =
        p.entityType === 'image' &&
        isPositiveInt(p.entityId) &&
        isAppReaction(p.reaction) &&
        typeof p.reacted === 'boolean' &&
        (p.ticket === undefined || isTicket(p.ticket));
      const refusal = refuse(valid);
      if (refusal !== null) return { error: refusal };
      if (!isTicket(p.ticket)) return { error: 'entity-unavailable' };

      const id = p.entityId as number;
      const reaction = p.reaction as BlockAppReaction;
      const reacted = p.reacted as boolean;
      const before = stateOf(id);
      const holds = before.viewerReactions.includes(reaction);
      const changed = holds !== reacted;
      const after: BlockEntityReactionState = changed
        ? {
            counts: {
              ...before.counts,
              [reaction]: Math.max(0, before.counts[reaction] + (reacted ? 1 : -1)),
            },
            viewerReactions: reacted
              ? [...before.viewerReactions, reaction]
              : before.viewerReactions.filter((r) => r !== reaction),
            statsUnknown: before.statsUnknown,
          }
        : before;
      states.set(id, after);
      return {
        result: {
          entityType: 'image',
          entityId: id,
          reaction,
          reacted,
          changed,
          counts: { ...after.counts },
          viewerReactions: [...after.viewerReactions],
          statsUnknown: after.statsUnknown,
        },
      };
    },

    get(payload) {
      const p = (payload ?? {}) as Record<string, unknown>;
      const ids = p.ids;
      const ticketsOk =
        p.tickets === undefined ||
        (typeof p.tickets === 'object' && p.tickets !== null && !Array.isArray(p.tickets));
      const valid =
        p.entityType === 'image' &&
        Array.isArray(ids) &&
        ids.length > 0 &&
        ids.length <= MAX_IDS &&
        ids.every(isPositiveInt) &&
        ticketsOk;
      if (valid && p.tickets !== undefined) {
        // The real gate refuses a malformed ticket for a REQUESTED id, and
        // ignores the tickets for ids it was not asked about.
        const wanted = new Set((ids as number[]).map(String));
        for (const [key, value] of Object.entries(p.tickets as Record<string, unknown>)) {
          if (wanted.has(key) && !isTicket(value)) return { error: refuse(false) ?? 'invalid-request' };
        }
      }
      const refusal = refuse(valid);
      if (refusal !== null) return { error: refusal };

      const tickets = (p.tickets ?? {}) as Record<string, unknown>;
      const byId: Record<string, BlockEntityReactionState> = {};
      const unavailable: number[] = [];
      for (const id of new Set(ids as number[])) {
        if (!isTicket(tickets[String(id)])) {
          unavailable.push(id);
          continue;
        }
        const s = stateOf(id);
        byId[String(id)] = {
          counts: { ...s.counts },
          viewerReactions: [...s.viewerReactions],
          statsUnknown: s.statsUnknown,
        };
      }
      return { result: { entityType: 'image', byId, unavailable } };
    },

    configure(patch) {
      if (patch.seed !== undefined) seedWith(patch.seed);
      if (patch.error !== undefined) forcedError = patch.error ?? undefined;
    },
  };
}
