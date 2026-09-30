import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CallOptions } from '@civitai/blocks-client';
import { useAsyncIterable } from '../src/useAsyncIterable.js';

afterEach(cleanup);

/** A generator this test drives one yield at a time. */
function controlled<T>() {
  const queue: Array<{ value: T; done: boolean }> = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let aborted = false;

  async function* gen(opts: CallOptions): AsyncGenerator<T> {
    opts.signal?.addEventListener('abort', () => {
      aborted = true;
      wake?.();
    });
    while (!ended) {
      while (queue.length) {
        if (opts.signal?.aborted) return;
        yield queue.shift()!.value;
      }
      if (ended || opts.signal?.aborted) return;
      await new Promise<void>((r) => {
        wake = r;
      });
    }
  }

  return {
    gen,
    push(v: T) {
      queue.push({ value: v, done: false });
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    get aborted() {
      return aborted;
    },
  };
}

describe('useAsyncIterable', () => {
  it('accumulates yielded items and completes when the iterable ends', async () => {
    async function* three(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      yield 3;
    }
    const seen: Array<{ items: number[]; loading: boolean; done: boolean }> = [];

    function Probe() {
      const s = useAsyncIterable<number>(() => three(), []);
      seen.push({ items: s.items, loading: s.loading, done: s.done });
      return null;
    }

    await act(async () => {
      render(<Probe />);
    });

    expect(seen.at(-1)?.items).toEqual([1, 2, 3]);
    expect(seen.at(-1)?.done).toBe(true);
    expect(seen.at(-1)?.loading).toBe(false);
  });

  it('surfaces a mid-stream failure', async () => {
    const boom = new Error('bridge down');
    async function* failing(): AsyncGenerator<number> {
      yield 1;
      throw boom;
    }
    const seen: Array<{ items: number[]; error: unknown; done: boolean }> = [];

    function Probe() {
      const s = useAsyncIterable<number>(() => failing(), []);
      seen.push({ items: s.items, error: s.error, done: s.done });
      return null;
    }

    await act(async () => {
      render(<Probe />);
    });

    expect(seen.at(-1)?.error).toBe(boom);
    expect(seen.at(-1)?.items).toEqual([1]);
    expect(seen.at(-1)?.done).toBe(false);
  });

  // 🔴 Cancellation is the whole job — an endless iterable (watchWorkflow) must
  // stop and must abort its signal when the component goes away.
  it('aborts and stops iterating on unmount', async () => {
    const c = controlled<number>();
    const seen: number[][] = [];

    function Probe() {
      const s = useAsyncIterable<number>((opts) => c.gen(opts), []);
      seen.push(s.items);
      return null;
    }

    const { unmount } = render(<Probe />);
    await act(async () => {
      c.push(1);
      await Promise.resolve();
    });

    unmount();
    expect(c.aborted).toBe(true);

    const before = seen.length;
    await act(async () => {
      c.push(2);
      await Promise.resolve();
    });

    expect(seen.length).toBe(before);
    expect(seen.flat()).not.toContain(2);
  });

  // 🔴 The #392 shape again, with more chances to hit it: a superseded run
  // yields many times, and none of those yields may join the new run's list.
  it('a superseded run never appends to the next run’s items', async () => {
    const first = controlled<string>();
    const second = controlled<string>();
    const seen: string[][] = [];

    function Probe({ which }: { which: 'a' | 'b' }) {
      const s = useAsyncIterable<string>(
        (opts) => (which === 'a' ? first.gen(opts) : second.gen(opts)),
        [which],
      );
      seen.push(s.items);
      return null;
    }

    const { rerender } = render(<Probe which="a" />);
    await act(async () => {
      first.push('a1');
      await Promise.resolve();
    });

    // Supersede while the first stream is still open.
    await act(async () => {
      rerender(<Probe which="b" />);
      await Promise.resolve();
    });
    expect(first.aborted).toBe(true);

    await act(async () => {
      second.push('b1');
      first.push('a2'); // the dead stream keeps producing
      await Promise.resolve();
    });

    const latest = seen.at(-1)!;
    expect(latest).toContain('b1');
    expect(latest).not.toContain('a1');
    expect(latest).not.toContain('a2');
  });

  // 🔴 REACHABILITY, and it took two tries to get right — recorded because the
  // wrong version looks identical.
  //
  // The `cancelled` flag is NOT reachable via unmount: React 18 makes setState
  // on an unmounted component a no-op, so deleting the flag leaves an
  // unmount-based test green and the guard uncertified. It is not reachable via
  // the `controlled` fixture either, because that one honours its AbortSignal
  // and stops on its own.
  //
  // The case that needs it is SUPERSEDE WHILE MOUNTED, by an iterable that
  // ignores its signal — a third-party generator, or one parked mid-`await`
  // when the abort fires. Then the dead run's setState lands on a LIVE
  // component and clobbers the current run's items. `cancelled` is the only
  // thing preventing it.
  it('a signal-ignoring stream cannot clobber the next run after being superseded', async () => {
    const emitters: Record<string, ((v: string) => void) | undefined> = {};

    function defiant(key: string) {
      return (async function* (): AsyncGenerator<string> {
        while (true) {
          const next = await new Promise<string>((r) => {
            emitters[key] = r;
          });
          yield next; // never consults opts.signal
        }
      })();
    }

    const seen: string[][] = [];

    function Probe({ which }: { which: string }) {
      const s = useAsyncIterable<string>(() => defiant(which), [which]);
      seen.push(s.items);
      return null;
    }

    const { rerender } = render(<Probe which="a" />);
    await act(async () => {
      emitters['a']!('a1');
      await Promise.resolve();
    });
    expect(seen.at(-1)).toEqual(['a1']);

    // Supersede. The component stays mounted, so a stray setState WOULD apply.
    await act(async () => {
      rerender(<Probe which="b" />);
      await Promise.resolve();
    });

    await act(async () => {
      emitters['b']!('b1');
      await Promise.resolve();
    });
    expect(seen.at(-1)).toEqual(['b1']);

    // The dead stream ignores its abort and keeps producing.
    await act(async () => {
      emitters['a']!('a2');
      await Promise.resolve();
      await Promise.resolve();
    });

    const latest = seen.at(-1)!;
    expect(latest).toEqual(['b1']);
    expect(latest).not.toContain('a2');
  });

  it('resets items when a run supersedes', async () => {
    async function* one(v: string): AsyncGenerator<string> {
      yield v;
    }
    const seen: string[][] = [];

    function Probe({ which }: { which: string }) {
      const s = useAsyncIterable<string>(() => one(which), [which]);
      seen.push(s.items);
      return null;
    }

    const { rerender } = render(<Probe which="a" />);
    await act(async () => {});
    expect(seen.at(-1)).toEqual(['a']);

    await act(async () => {
      rerender(<Probe which="b" />);
    });

    expect(seen.at(-1)).toEqual(['b']);
  });
});
