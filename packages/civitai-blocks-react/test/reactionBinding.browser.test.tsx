import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement, useEffect, useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isAppReaction } from '@civitai/app-sdk/blocks';
import { defineCivitaiReaction, type CivitaiReaction } from '@civitai/components/civitai-reaction';

import { useReactions } from '../src/hooks/useReactions.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport, type MockHost } from '../src/testing.js';

// 🔴 A REAL BROWSER, for the binding the README documents: `<civitai-reaction>`
// flips itself on a click, before any React render, so "the element is put
// back after a refused write" is only observable with the real custom element.
//
// The binding writes `reacted` / `count` from `byId` on EVERY render, and that
// rewrite is what undoes the element's own flip. That every rejected `toggle`
// re-renders its owner, including the refusals that never move `byId` (no
// ticket, busy), is pinned in `useReactions.test.tsx`: each sets `error`.

const ORIGIN = window.location.origin;
defineCivitaiReaction();

function Like({ id, tickets }: { id: number; tickets: Record<number, string> }) {
  const r = useReactions('image', [id], { tickets });
  const ref = useRef<CivitaiReaction>(null);
  const latest = useRef(r);
  latest.current = r;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.reaction = 'Like';
    el.reacted = r.byId[id]?.viewerReactions.includes('Like') ?? false;
    el.count = r.byId[id]?.counts.Like ?? 0;
    el.disabled = !r.byId[id] || r.pending(id, 'Like');
  });

  useEffect(() => {
    const el = ref.current!;
    const onReact = (event: Event) => {
      const { reaction, reacted } = (event as CustomEvent<{ reaction?: string; reacted: boolean }>)
        .detail;
      if (!isAppReaction(reaction)) return;
      latest.current.toggle(id, reaction, reacted).catch(() => {});
    };
    el.addEventListener('react', onReact);
    return () => el.removeEventListener('react', onReact);
  }, [id]);

  return createElement('civitai-reaction', { ref, emoji: '👍' });
}

const element = (): CivitaiReaction => document.querySelector('civitai-reaction') as CivitaiReaction;

const press = async (): Promise<void> => {
  element().shadowRoot!.querySelector('button')!.click();
  await element().updateComplete;
};

describe('the documented <civitai-reaction> binding, in a real browser', () => {
  let host: MockHost;
  let uninstall: () => void;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
    host = createMockHost({
      declaredScopes: ['social:react:self'],
      reactionStates: { 1: { counts: { Like: 4 } } },
    });
    uninstall = host.install();
  });
  afterEach(() => {
    cleanup();
    uninstall();
    resetTransport();
  });

  it('a tap reacts, and the element follows the host', async () => {
    render(<Like id={1} tickets={{ 1: 't-1' }} />);
    await waitFor(() => expect(element().disabled).toBe(false));
    await press();
    await waitFor(() => expect(element().disabled).toBe(false));
    expect(element().reacted).toBe(true);
    expect(element().count).toBe(5);
  });

  it('a refused write puts the element back', async () => {
    render(<Like id={1} tickets={{ 1: 't-1' }} />);
    await waitFor(() => expect(element().disabled).toBe(false));
    host.setScenario({ reactionError: 'rate-limited' });
    await press();
    await waitFor(() => expect(element().reacted).toBe(false));
    expect(element().count).toBe(4);
  });
});
