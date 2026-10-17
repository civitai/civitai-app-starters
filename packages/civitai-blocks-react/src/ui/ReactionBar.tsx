import { createElement, useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';

import {
  defineCivitaiReaction,
  type CivitaiReaction,
  type ReactionDetail,
} from '@civitai/components/civitai-reaction';

import {
  REACTIONS,
  ReactionError,
  type BlockAppReaction,
  type UseReactions,
} from '../hooks/useReactions.js';

/** The site's own emoji for each reaction an app may set. */
export const REACTION_EMOJI: Readonly<Record<BlockAppReaction, string>> = {
  Like: '👍',
  Heart: '❤️',
  Laugh: '😂',
  Cry: '😢',
};

export interface ReactionBarProps {
  /** The image these reactions are on. */
  id: number;
  /** What `useReactions(...)` returned. */
  reactions: Pick<UseReactions, 'byId' | 'toggle' | 'pending'>;
  /** Which reactions to show, in order. Defaults to all four. */
  show?: readonly BlockAppReaction[];
  /** Replace the default emoji for any reaction. */
  emoji?: Partial<Record<BlockAppReaction, string>>;
  /**
   * Called when a toggle fails, after the buttons have been put back. Route
   * `.signInRequired` into `useRequestSignIn()` and `.needsConsent` into
   * `useRequestConsent()`; the rest needs no more than a quiet retry.
   */
  onError?: (error: ReactionError) => void;
}

/**
 * One `<civitai-reaction>` per reaction, wired to {@link useReactions}.
 *
 * A tap flips the button at once (the element's own optimistic update),
 * `toggle`s the reaction, and on failure the buttons follow `byId` again. That
 * includes a refusal the hook makes without sending anything (no ticket), which
 * never moves `byId`: the button is still put back, because every render
 * rewrites every button from `byId`.
 *
 * The buttons are disabled while the image's state is unknown (not read yet,
 * or listed in `unavailable`) and while their own reaction is in flight.
 */
export function ReactionBar({
  id,
  reactions,
  show = REACTIONS,
  emoji,
  onError,
}: ReactionBarProps): ReactElement {
  defineCivitaiReaction();

  const refs = useRef(new Map<BlockAppReaction, CivitaiReaction>());
  const latest = useRef({ id, reactions, onError });
  latest.current = { id, reactions, onError };

  // Write every button from the current `byId`, on EVERY render. That is what
  // puts a button back after a failed toggle: each failure path re-renders the
  // owner of `useReactions` (it sets `error`, or clears `pending`), and this
  // overwrites the element's own optimistic flip with the state `byId` holds.
  const sync = (): void => {
    const { id: current, reactions: r } = latest.current;
    const state = r.byId[current];
    for (const [reaction, el] of refs.current) {
      el.reaction = reaction;
      el.reacted = state ? state.viewerReactions.includes(reaction) : false;
      el.count = state ? (state.counts[reaction] ?? 0) : 0;
      el.disabled = !state || r.pending(current, reaction);
    }
  };

  useLayoutEffect(sync);

  const showKey = show.join(',');

  useEffect(() => {
    const listeners = new Map<CivitaiReaction, (event: Event) => void>();
    for (const [, el] of refs.current) {
      const listener = (event: Event): void => {
        const detail = (event as CustomEvent<ReactionDetail>).detail;
        if (!detail.reaction) return;
        const { id: current, reactions: r } = latest.current;
        r.toggle(current, detail.reaction, detail.reacted).catch((err: unknown) => {
          if (err instanceof ReactionError) latest.current.onError?.(err);
        });
      };
      el.addEventListener('react', listener);
      listeners.set(el, listener);
    }
    return () => {
      for (const [el, listener] of listeners) el.removeEventListener('react', listener);
    };
    // The elements are keyed by `show`; a new set re-attaches.
  }, [showKey]);

  return createElement(
    'span',
    { 'data-civitai-reaction-bar': '', style: { display: 'inline-flex', gap: '6px' } },
    show.map((reaction) =>
      createElement('civitai-reaction', {
        key: reaction,
        ref: (el: CivitaiReaction | null) => {
          if (el) refs.current.set(reaction, el);
          else refs.current.delete(reaction);
        },
        reaction,
        emoji: emoji?.[reaction] ?? REACTION_EMOJI[reaction],
        label: reaction,
      }),
    ),
  );
}
