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
 * How long the fetch is given before it is aborted and the hook reports an
 * error. Without a deadline a stalled response leaves `status === 'loading'`
 * FOREVER: the hook owns its `AbortController` and never exposes it, so a
 * caller has nothing to cancel with and no timer of its own to hang one off.
 *
 * 30 seconds, equal to `transport/requestTimeouts.ts`'s
 * `DEFAULT_REQUEST_TIMEOUT_MS` and to `useEntitlements`' `ENTITLEMENTS_TIMEOUT_MS`
 * — this is a `'protocol'`-class wait in that file's vocabulary: a static-host
 * round trip with NO PERSON IN THE LOOP, so `HUMAN_INTERACTION_TIMEOUT_MS` is
 * the wrong bound. Declared locally rather than imported for the same reason
 * `useEntitlements` declares its own: `DEFAULT_REQUEST_TIMEOUT_MS` documents the
 * default of `IframeTransport.sendRequest`, and a `fetch` of a bundled document
 * is not a bridge request. Equal by intent, not derived.
 */
const NESTED_DOCUMENT_TIMEOUT_MS = 30_000;

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
 * `frame-ancestors` / `X-Frame-Options` derivation, the five-row DATED
 * EXTERNAL platform matrix (verified by nothing in this repo — re-measure it if
 * the platform's sandbox tiers or response headers change), and the known
 * limits of the `<base>` rewrite. Do not restate any of it here: it was
 * duplicated across 11 surfaces with nothing in the repo checking them for
 * agreement, which is exactly how two measured claims in these files' own test
 * headers went stale.
 *
 * 🔴 THE STRING IS NOT SANITIZED. It is your own markup and scripts, verbatim;
 * pass a `src` you control, and put a `sandbox` attribute on the iframe.
 *
 * Changing `src` restarts the fetch and aborts the previous one — `status` goes
 * back to `'loading'` in the SAME render that changes `src`, so no paint ever
 * shows a stale `srcDoc` as `'ready'` beside a new `src`. Unmounting aborts the
 * in-flight fetch, and no state is written after it.
 *
 * A fetch that never settles is bounded: after {@link NESTED_DOCUMENT_TIMEOUT_MS}
 * it is aborted and `status` becomes `'error'` with a message naming the
 * timeout. A timeout is distinguished from the hook's own aborts (unmount, a
 * `src` change) — those stay silent, as they must.
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

  // 🔴 RESET DURING RENDER, NOT IN THE EFFECT. The effect runs AFTER the commit,
  // so between the render that changes `src` and the effect that sets `LOADING`
  // the hook used to return the PREVIOUS document still labelled `'ready'` —
  // one painted frame in which `(src, srcDoc)` disagree, and a consumer that
  // keys an iframe off `src` would show the wrong document in it. This is
  // React's documented "adjust state when a prop changes" pattern: the
  // `setState` below re-renders this component immediately, before the browser
  // paints, so the stale pair is never committed.
  //
  // The key carries BOTH inputs because both are effect dependencies. They are
  // joined by a NUL rather than by a printable character: two distinct
  // `(src, baseUrl)` pairs can only collide on one key if the separator itself
  // occurs inside one of them, and a NUL is the byte least likely to appear in
  // a URL anyone passes here. A collision would mean a missed reset, not a
  // wrong document — the effect's own `[src, baseUrl]` deps still re-run it.
  const key = `${src ?? ''}\u0000${baseUrl ?? ''}`;
  const [stateKey, setStateKey] = useState(key);
  let current = state;
  if (stateKey !== key) {
    setStateKey(key);
    // 🔴 RETURNED FROM THIS PASS, not merely queued. React discards the JSX of
    // a render that calls `setState` and retries, so queueing alone already
    // keeps the stale pair off the screen — but it would still be the value
    // this call RETURNS, which is the hook's contract and the thing a test can
    // observe. Assigning locally makes every render consistent, committed or
    // not.
    current = src ? LOADING : IDLE;
    // `IDLE`/`LOADING` are module constants, so when the effect sets the same
    // one a moment later React bails out on reference equality.
    setState(current);
  }

  useEffect(() => {
    if (!src) {
      setState(IDLE);
      return;
    }

    // `cancelled` is belt AND braces alongside `abort()`: an abort only rejects
    // a fetch that is still in flight, so a response that has already resolved
    // can still land in a `.then` after unmount. Both are needed.
    let cancelled = false;
    // 🔴 A SEPARATE FLAG, NOT `controller.signal.aborted`. The timeout aborts
    // THIS controller, and the `.catch` below drops anything whose signal is
    // aborted — so a timeout wired to the same controller would be SWALLOWED
    // and the hook would sit on `'loading'` exactly as it did with no timeout
    // at all. The flag is what tells "the deadline passed" (report it) from
    // "we unmounted / the src changed" (stay silent).
    let timedOut = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, NESTED_DOCUMENT_TIMEOUT_MS);
    setState(LOADING);

    fetchNestedDocument({ src, baseUrl, signal: controller.signal })
      .then((doc) => {
        if (cancelled) return;
        setState({ status: 'ready', srcDoc: doc.srcDoc, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (timedOut) {
          setState({
            status: 'error',
            srcDoc: null,
            error: new Error(
              `useNestedDocument: fetching ${src} timed out after ` +
                `${NESTED_DOCUMENT_TIMEOUT_MS}ms.`,
            ),
          });
          return;
        }
        // Any OTHER abort is this hook's own cleanup, never something to
        // surface: the component is gone, or a newer `src` already owns the
        // state.
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          srcDoc: null,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [src, baseUrl]);

  return current;
}
