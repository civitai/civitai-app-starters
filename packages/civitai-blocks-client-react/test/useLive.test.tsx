import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Live } from '@civitai/blocks-client';
import { useLive } from '../src/useLive.js';

afterEach(cleanup);

/**
 * A stand-in with `Live<T>`'s observable contract: an EventTarget dispatching
 * `change`, with stable value identity between changes. Deliberately NOT the
 * real `LiveValue` — this pins the contract the binding relies on, so if the
 * client ever stops dispatching `change` or starts returning fresh identities,
 * these tests keep passing and the parity check is what should fail instead.
 */
class FakeLive<T> extends EventTarget {
  value: T | undefined;
  error: unknown;
  loading = false;
  refreshes = 0;

  settle(value: T | undefined, error?: unknown) {
    this.value = value;
    this.error = error;
    this.loading = false;
    this.dispatchEvent(new Event('change'));
  }

  async refresh(): Promise<T> {
    this.refreshes += 1;
    return this.value as T;
  }
}

function asLive<T>(f: FakeLive<T>): Live<T> {
  return f as unknown as Live<T>;
}

describe('useLive', () => {
  it('reads the current value and re-renders on change', () => {
    const live = new FakeLive<number[]>();
    const seen: Array<number[] | undefined> = [];

    function Probe() {
      const { value } = useLive(asLive(live));
      seen.push(value);
      return null;
    }

    render(<Probe />);
    expect(seen.at(-1)).toBeUndefined();

    act(() => live.settle([1, 2]));
    expect(seen.at(-1)).toEqual([1, 2]);
  });

  it('surfaces error and loading from the same store', () => {
    const live = new FakeLive<string>();
    const seen: Array<{ error: unknown; loading: boolean }> = [];

    function Probe() {
      const { error, loading } = useLive(asLive(live));
      seen.push({ error, loading });
      return null;
    }

    render(<Probe />);
    const boom = new Error('nope');
    act(() => live.settle(undefined, boom));

    expect(seen.at(-1)).toEqual({ error: boom, loading: false });
  });

  // 🔴 THE TRAP THIS BINDING IS SHAPED AROUND.
  // useSyncExternalStore calls getSnapshot on every render and bails out only on
  // Object.is equality. A composed `{value, error, loading}` snapshot allocates a
  // new object each call, never compares equal, and React re-renders forever.
  // Reading each field through its own store keeps snapshots stable — this test
  // is what says so, by bounding the render count.
  it('does not re-render without a change event (stable snapshots)', () => {
    const live = new FakeLive<string>();
    let renders = 0;

    function Probe() {
      renders += 1;
      useLive(asLive(live));
      return null;
    }

    render(<Probe />);
    const afterMount = renders;

    // No change dispatched: React must not be driven to render again.
    act(() => {});
    expect(renders).toBe(afterMount);

    act(() => live.settle('a'));
    const afterOneChange = renders;
    expect(afterOneChange).toBeGreaterThan(afterMount);

    // One change must produce a bounded number of renders, not a runaway loop.
    expect(afterOneChange - afterMount).toBeLessThanOrEqual(2);

    act(() => {});
    expect(renders).toBe(afterOneChange);
  });

  it('unsubscribes on unmount', () => {
    const live = new FakeLive<string>();
    const seen: Array<string | undefined> = [];

    function Probe() {
      const { value } = useLive(asLive(live));
      seen.push(value);
      return null;
    }

    const { unmount } = render(<Probe />);
    act(() => live.settle('before'));
    const count = seen.length;

    unmount();
    act(() => live.settle('after'));

    expect(seen.length).toBe(count);
    expect(seen).not.toContain('after');
  });

  it('refresh() delegates to the live value', async () => {
    const live = new FakeLive<string>();
    let api: { refresh: () => Promise<string> } | undefined;

    function Probe() {
      api = useLive(asLive(live));
      return null;
    }

    render(<Probe />);
    await act(async () => {
      await api!.refresh();
    });

    expect(live.refreshes).toBe(1);
  });
});
