import { useEffect, useState } from 'react';

import { fetchNestedDocument } from '@civitai/app-sdk/blocks';

/**
 * Where the fetch has got to. `idle` is the no-`src` state, not a
 * pre-fetch tick: a mount WITH a `src` goes straight to `loading`.
 */
export type NestedDocumentStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * What {@link useNestedDocument} returns. The three fields are driven from ONE
 * state object, so they can never disagree: `srcDoc` is non-null exactly when
 * `status === 'ready'`, and `error` is non-null exactly when
 * `status === 'error'`.
 */
export interface UseNestedDocument {
  /** The string to hand an iframe's `srcdoc`. Non-null iff `status === 'ready'`. */
  srcDoc: string | null;
  status: NestedDocumentStatus;
  /** Non-null iff `status === 'error'`. A `NestedDocumentError` carries a `.code`. */
  error: Error | null;
}

/** Options for {@link useNestedDocument}. */
export interface UseNestedDocumentOptions {
  /**
   * The nested document to inline. Relative URLs resolve against `baseUrl`, or
   * the current document. `undefined` or `''` keeps the hook `idle` and fetches
   * nothing — the shape to use while you are still deciding what to embed.
   */
  src?: string | undefined;
  /** Explicit base for resolving a relative `src`. */
  baseUrl?: string | undefined;
}

/** `ready`/`error` is a pair; keeping them in one object makes the pair atomic. */
type State =
  | { status: 'idle'; srcDoc: null; error: null }
  | { status: 'loading'; srcDoc: null; error: null }
  | { status: 'ready'; srcDoc: string; error: null }
  | { status: 'error'; srcDoc: null; error: Error };

const IDLE: State = { status: 'idle', srcDoc: null, error: null };
const LOADING: State = { status: 'loading', srcDoc: null, error: null };

/**
 * Fetch one of your OWN bundled documents and get back a `srcdoc` string with
 * an absolute `<base href>` injected — the only way a block can embed a nested
 * document of its own.
 *
 * 🔴 PREFER NOT TO NEED THIS. A plain `<iframe src="/game/index.html">` of your
 * own bundle **cannot load**, and no manifest change fixes it. An engine build
 * (Defold, Unity, Phaser) is a `<canvas>` plus a JS loader and normally mounts
 * directly into the block's own document, which avoids the whole problem class;
 * reach for this hook only when a separate document is genuinely required.
 *
 * WHY, measured, in ONE place: the header of `@civitai/app-sdk`'s
 * `src/blocks/nestedDocument.ts`. It carries the opaque-origin /
 * `frame-ancestors` / `X-Frame-Options` derivation, the five-row measured
 * matrix with its positive control, and the known limits of the `<base>`
 * rewrite. Do not restate any of it here: it was duplicated across 11 surfaces
 * with nothing in the repo checking them for agreement, which is exactly how
 * two measured claims in these files' own test headers went stale.
 *
 * 🔴 THE STRING IS NOT SANITIZED. It is your own markup and scripts, verbatim;
 * pass a `src` you control, and put a `sandbox` attribute on the iframe.
 *
 * Changing `src` restarts the fetch and aborts the previous one. Unmounting
 * aborts the in-flight fetch, and no state is written after it.
 *
 * @example
 * ```tsx
 * const { srcDoc, status, error } = useNestedDocument({ src: '/game/index.html' });
 * if (status === 'error') return <p>Could not load the game: {error?.message}</p>;
 * if (status !== 'ready') return <p>Loading…</p>;
 * return <iframe title="game" sandbox="allow-scripts" srcDoc={srcDoc ?? undefined} />;
 * ```
 */
export function useNestedDocument(options?: UseNestedDocumentOptions): UseNestedDocument {
  const src = options?.src;
  const baseUrl = options?.baseUrl;
  const [state, setState] = useState<State>(src ? LOADING : IDLE);

  useEffect(() => {
    if (!src) {
      setState(IDLE);
      return;
    }

    // `cancelled` is belt AND braces alongside `abort()`: an abort only rejects
    // a fetch that is still in flight, so a response that has already resolved
    // can still land in a `.then` after unmount. Both are needed.
    let cancelled = false;
    const controller = new AbortController();
    setState(LOADING);

    fetchNestedDocument({ src, baseUrl, signal: controller.signal })
      .then((doc) => {
        if (cancelled) return;
        setState({ status: 'ready', srcDoc: doc.srcDoc, error: null });
      })
      .catch((err: unknown) => {
        // An abort is this hook's own cleanup, never something to surface: the
        // component is gone, or a newer `src` already owns the state.
        if (cancelled || controller.signal.aborted) return;
        setState({
          status: 'error',
          srcDoc: null,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [src, baseUrl]);

  return state;
}
