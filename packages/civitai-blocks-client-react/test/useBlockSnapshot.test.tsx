import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlockSnapshot, BlockTransport } from '@civitai/blocks-client';
import { useBlockSnapshot } from '../src/useBlockSnapshot.js';

afterEach(cleanup);

/**
 * A transport stub with the store contract the real one exposes: one held
 * snapshot field, replaced wholesale, with listeners fired on change. Identity
 * stability is the property under test, so it is reproduced here rather than
 * imported — a stub that happened to memoize differently would hide the bug.
 */
function fakeTransport(initial: Partial<BlockSnapshot> = {}) {
  let snap = { ready: false, theme: 'dark', context: { slotId: '' }, ...initial } as BlockSnapshot;
  const listeners = new Set<() => void>();
  const transport = {
    snapshot: {
      get: () => snap,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    notify: () => {},
    request: async () => undefined,
    on: () => () => {},
  } as unknown as BlockTransport;

  return {
    transport,
    settle(next: Partial<BlockSnapshot>) {
      snap = { ...snap, ...next } as BlockSnapshot;
      listeners.forEach((l) => l());
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

describe('useBlockSnapshot', () => {
  it('reads the current snapshot and re-renders when the host amends it', () => {
    const t = fakeTransport({ ready: false });
    const seen: BlockSnapshot[] = [];

    function Probe() {
      const s = useBlockSnapshot(t.transport);
      seen.push(s);
      return null;
    }

    render(<Probe />);
    expect(seen.at(-1)?.ready).toBe(false);

    act(() => t.settle({ ready: true, theme: 'light' }));

    expect(seen.at(-1)?.ready).toBe(true);
    expect(seen.at(-1)?.theme).toBe('light');
  });

  // 🔴 The same trap useLive is shaped around: getSnapshot is called on every
  // render and bails out only on Object.is equality. The transport returns a
  // held field, so identity is stable and React settles. A getSnapshot that
  // built a fresh object would render forever — this bounds it.
  it('does not re-render without a change (stable snapshot identity)', () => {
    const t = fakeTransport();
    let renders = 0;

    function Probe() {
      renders += 1;
      useBlockSnapshot(t.transport);
      return null;
    }

    render(<Probe />);
    const afterMount = renders;

    act(() => {});
    expect(renders).toBe(afterMount);

    act(() => t.settle({ ready: true }));
    const afterChange = renders;
    expect(afterChange).toBeGreaterThan(afterMount);
    expect(afterChange - afterMount).toBeLessThanOrEqual(2);

    act(() => {});
    expect(renders).toBe(afterChange);
  });

  it('unsubscribes on unmount', () => {
    const t = fakeTransport();

    function Probe() {
      useBlockSnapshot(t.transport);
      return null;
    }

    const { unmount } = render(<Probe />);
    expect(t.listenerCount).toBeGreaterThan(0);

    unmount();
    expect(t.listenerCount).toBe(0);
  });
});
