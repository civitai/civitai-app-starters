/**
 * Test-only helpers for `@civitai/blocks-react`. Not part of the runtime
 * surface — block apps should never import from here in production code (the
 * `./testing` subpath keeps accidental prod imports visible in review).
 *
 * Exposes:
 *  - `resetTransport` / `mockParentMessage` — low-level test primitives.
 *  - `createMockHost` — a framework-agnostic fake of the civitai.com embedding
 *    host (usable from node/jsdom/happy-dom tests AND a dev harness).
 *  - `<Harness>` / `<MockHostProvider>` — a thin React wrapper that installs a
 *    mock host for local dev, with an optional on-screen message log.
 *
 * These replace the ~250-line per-block hand-rolled harness.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { __resetTransport } from './internal/singleton.js';
import {
  createMockHost,
  readMockHostUrlOptions,
  type MockHostOptions,
} from './internal/mockHost.js';

export { __resetTransport as resetTransport };

export {
  createMockHost,
  readMockHostUrlOptions,
  type MockHost,
  type MockHostOptions,
  type MockHostFailMode,
  type CannedPick,
} from './internal/mockHost.js';

/**
 * Builds a `MessageEvent` that mimics a parent-frame postMessage so tests can
 * exercise `IframeTransport.handleMessage` without a real cross-frame setup.
 */
export function mockParentMessage(data: unknown, origin: string): MessageEvent {
  return new MessageEvent('message', { data, origin, source: null });
}

interface OutboundLog {
  type: string;
  payload?: unknown;
}

/**
 * Props for the dev `<Harness>` (a.k.a. {@link MockHostProvider}).
 */
export interface HarnessProps extends MockHostOptions {
  /** The block app to render inside the mocked host. */
  children: ReactNode;
  /**
   * Read the gen-matrix URL toggles (`?viewer/?consent/?fail/?theme/?pick/
   * ?pickCkpt`) and apply them ON TOP of the props (URL wins). Default `true`
   * so a dev harness stays interactive. Pass `false` in a deterministic test.
   */
  applyUrlToggles?: boolean;
  /**
   * Render the on-screen outbound-message log panel (bottom-right). Default
   * `true`. Set `false` to mount the mock host with no chrome.
   */
  showLog?: boolean;
}

/**
 * Thin React wrapper that installs a {@link createMockHost} on mount (and tears
 * it down on unmount) so a block app renders against a fake civitai host for
 * local dev — no real platform, no real Buzz.
 *
 * IMPORTANT: the SDK transport DROPS inbound host messages whose origin isn't
 * in its allowlist, and the mock host fires from `window.location.origin`. So
 * a block app using `<Harness>` in dev MUST include its OWN origin in the
 * transport allowlist, e.g.:
 *
 *   VITE_BLOCK_ALLOWED_PARENT_ORIGINS=http://localhost:5173
 *
 * (or pass it to `getTransport({ allowedParentOrigins: [window.location.origin] })`
 * in the harness entrypoint). Otherwise BLOCK_INIT never lands.
 *
 * @example
 * createRoot(el).render(
 *   <Harness failMode="some">
 *     <App />
 *   </Harness>,
 * );
 */
export function Harness({
  children,
  applyUrlToggles = true,
  showLog = true,
  ...options
}: HarnessProps) {
  const [outbound, setOutbound] = useState<OutboundLog[]>([]);
  // Snapshot the merged options once per mount so the effect's identity is
  // stable (avoids re-installing the host on every render).
  const optionsRef = useRef<MockHostOptions | null>(null);
  if (optionsRef.current === null) {
    const urlOverlay = applyUrlToggles ? readMockHostUrlOptions() : {};
    optionsRef.current = { ...options, ...urlOverlay };
  }

  useEffect(() => {
    const host = createMockHost({
      ...optionsRef.current!,
      onOutbound: (msg) => {
        optionsRef.current!.onOutbound?.(msg);
        if (msg.type === 'RESIZE_IFRAME') return; // noise; skip the log
        queueMicrotask(() => setOutbound((prev) => [...prev, msg]));
      },
    });
    return host.install();
  }, []);

  const opts = optionsRef.current!;
  const anon = opts.viewer === null;
  const theme = opts.theme ?? 'dark';
  const consent = opts.consentGranted ? 'granted' : 'withheld';

  return (
    <div data-harness="true" style={{ position: 'relative', width: '100vw', minHeight: '100dvh' }}>
      <main data-harness-frame="true" style={{ width: '100%', minHeight: '100%' }}>
        {children}
      </main>
      {showLog && (
        <details style={harnessLogStyle}>
          <summary style={{ cursor: 'pointer' }}>
            DEV HARNESS · viewer={anon ? 'anon' : 'dev-viewer'} · consent={consent} · theme={theme} ·
            outbound:{outbound.length}
          </summary>
          <pre style={{ margin: 0, maxHeight: 200, overflow: 'auto' }}>
            {outbound.length === 0
              ? '// no outbound messages yet'
              : outbound
                  .map((m, i) => `${i + 1}. ${m.type} ${JSON.stringify(m.payload ?? {})}`)
                  .join('\n')}
          </pre>
        </details>
      )}
    </div>
  );
}

/** Alias of {@link Harness} — same component, clearer name when used as a context provider. */
export const MockHostProvider = Harness;

const harnessLogStyle = {
  position: 'fixed',
  bottom: 8,
  right: 8,
  zIndex: 9999,
  maxWidth: 520,
  background: 'rgba(17,17,17,0.92)',
  color: '#7fc',
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  padding: '6px 10px',
  borderRadius: 6,
} as const;
