import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CivitaiReaction } from '@civitai/components/civitai-reaction';

import { useReactions } from '../src/hooks/useReactions.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport, type MockHost } from '../src/testing.js';
import { ReactionBar } from '../src/ui/ReactionBar.js';

// 🔴 A REAL BROWSER, because the defect this guards is the custom element's own
// optimistic flip: a click flips `<civitai-reaction>` before any React render,
// and only a real custom element does that. Under happy-dom the element is not
// upgraded the same way, so "the button went back" is not observable there.

const ORIGIN = window.location.origin;

function Bar({ id, tickets }: { id: number; tickets: Record<number, string> }) {
  const reactions = useReactions('image', [id], { tickets });
  return <ReactionBar id={id} reactions={reactions} />;
}

const element = (reaction: string): CivitaiReaction =>
  document.querySelector(`civitai-reaction[reaction="${reaction}"]`) as CivitaiReaction;

const press = async (reaction: string): Promise<void> => {
  const el = element(reaction);
  el.shadowRoot!.querySelector('button')!.click();
  await el.updateComplete;
};

describe('<ReactionBar> with <civitai-reaction>, in a real browser', () => {
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

  async function mount(tickets: Record<number, string> = { 1: 't-1' }) {
    render(<Bar id={1} tickets={tickets} />);
    await waitFor(() => expect(element('Like')?.disabled).toBe(false));
  }

  it('renders the four reactions with their counts, carrying `reaction`', async () => {
    await mount();
    const els = [...document.querySelectorAll('civitai-reaction')] as CivitaiReaction[];
    expect(els.map((el) => el.reaction)).toEqual(['Like', 'Heart', 'Laugh', 'Cry']);
    expect(element('Like').count).toBe(4);
    expect(element('Like').reacted).toBe(false);
  });

  it('a tap reacts, and the host state agrees', async () => {
    await mount();
    await press('Like');
    await waitFor(() => expect(element('Like').disabled).toBe(false));
    expect(element('Like').reacted).toBe(true);
    expect(element('Like').count).toBe(5);
  });

  it('🔴 a refused write puts the button back', async () => {
    await mount();
    host.setScenario({ reactionError: 'rate-limited' });
    await press('Like');
    // The element flipped itself at once…
    // …and is put back once the host refuses.
    await waitFor(() => expect(element('Like').reacted).toBe(false));
    expect(element('Like').count).toBe(4);
    expect(element('Like').disabled).toBe(false);
  });

  it('🔴 a refusal that never reaches the host (no ticket) puts the button back too', async () => {
    // Read with a ticket, then lose it: the hook refuses the write locally and
    // `byId` never moves, so only an explicit re-sync can undo the element's flip.
    const { rerender } = render(<Bar id={1} tickets={{ 1: 't-1' }} />);
    await waitFor(() => expect(element('Like')?.disabled).toBe(false));
    rerender(<Bar id={1} tickets={{}} />);
    await press('Heart');
    await waitFor(() => expect(element('Heart').reacted).toBe(false));
    expect(element('Heart').count).toBe(0);
  });
});
