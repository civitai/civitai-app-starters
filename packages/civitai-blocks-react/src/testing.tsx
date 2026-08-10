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
  disallowedAccountError,
  type MockHost,
  type MockHostOptions,
  type MockHostFailMode,
  type MockHostScenarioPatch,
  type MockGenerationScenario,
  type MockBuzzScenario,
  type MockBuzzBalance,
  type MockBuzzHandle,
  type MockStorageScenario,
  type MockSharedScenario,
  type MockSharedSeed,
  type MockCannedImageScan,
  type CostSpec,
  type ImageSpec,
  type CannedPick,
} from './internal/mockHost.js';

export {
  createLiveHost,
  decodeBlockTokenPayload,
  type LiveHostOptions,
} from './internal/liveHost.js';

export {
  buildCatalogUrl,
  fetchCatalog,
  modelToCard,
  responseToPage,
  edgeThumb,
  cardToCheckpoint,
  cardToResource,
  filterCardsByFamily,
  CATALOG_API_BASE,
  CATALOG_API_BASE_BLOCKS,
  DEFAULT_LIMIT,
  type CatalogQuery,
  type CatalogCard,
  type CatalogPage,
  type CatalogResult,
  type CatalogModelType,
} from './internal/catalog.js';

export {
  openPickerOverlay,
  type PickerOverlayHandle,
  type PickerSelection,
  type OpenPickerOptions,
} from './internal/pickerOverlay.js';

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

/** The consent states the harness chrome can report. */
type HarnessConsentLabel = 'granted' | 'withheld' | 'ungrantable' | 'granted+ungrantable';

/**
 * What the harness chrome's `consent=` readout says, from the TWO INDEPENDENT
 * booleans that describe consent in the mock host.
 *
 * 🔴 THIS IS NOT A BOOLEAN, AND TREATING IT AS ONE IS THE BUG THIS SDK CHANGE
 * EXISTS TO FIX. `consentGranted` says whether the token already carries the
 * gated scope; `consentGrantable` says whether a consent round-trip could EVER
 * add it here. `?consent=ungrantable` sets only the second one and leaves the
 * first `undefined`, so a two-state `consentGranted ? 'granted' : 'withheld'`
 * reports **withheld** — which reads as *"not granted yet, try again"*, the
 * precise message `CONSENT_UNAVAILABLE` was added to replace. A developer
 * exercising the new refusal path would then see their block correctly say
 * "unavailable" while the harness chrome next to it said "withheld", and the
 * chrome is the surface they trust to describe the fake host.
 *
 * All four combinations are named rather than collapsed. `granted+ungrantable`
 * is a real, tested configuration (`createMockHost({ consentGranted: true,
 * consentGrantable: false })`) and it behaves differently from both neighbours:
 * a request for the already-granted scope stays SILENT (nothing is un-grantable
 * about it), while a request for anything else is refused. Collapsing it into
 * either `granted` or `ungrantable` mis-describes one of those two paths.
 */
function harnessConsentLabel(opts: {
  consentGranted?: boolean;
  consentGrantable?: boolean;
}): HarnessConsentLabel {
  // Mirrors `createMockHost`'s own default (`options.consentGrantable ?? true`):
  // absent means "this host can grant", i.e. today's behaviour.
  const grantable = opts.consentGrantable ?? true;
  const granted = !!opts.consentGranted;
  if (grantable) return granted ? 'granted' : 'withheld';
  return granted ? 'granted+ungrantable' : 'ungrantable';
}

/**
 * Chrome colour for the consent readout. An un-grantable host is the state a dev
 * is least likely to have set on purpose (it can arrive from a URL toggle), so
 * it is tinted amber rather than sharing the neutral accent of the other values.
 */
function consentColor(label: HarnessConsentLabel): string {
  return label === 'ungrantable' || label === 'granted+ungrantable' ? '#e2c08d' : '#7fd9ff';
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
  const consent = harnessConsentLabel(opts);

  return (
    <div data-harness="true" style={{ position: 'relative', width: '100vw', minHeight: '100dvh' }}>
      {/* Reserve space at the bottom so the fixed dev-log badge never sits over
          the block's own bottom content (e.g. action buttons). Without this the
          badge overlaps + intercepts clicks on whatever the app renders last. */}
      <main
        data-harness-frame="true"
        style={{ width: '100%', minHeight: '100%', paddingBottom: showLog ? 56 : 0 }}
      >
        {children}
      </main>
      {showLog && (
        // pointerEvents:none on the wrapper so the badge's bounding box can't
        // steal clicks from content beneath it; re-enabled on the interactive
        // bits (summary toggles the log; pre is scrollable/selectable).
        <details style={harnessLogStyle}>
          <summary style={harnessSummaryStyle}>
            <span style={{ color: '#5ec8a0' }}>$</span>{' '}
            <span style={{ color: '#9aa0aa' }}>DEV HARNESS</span>{' '}
            <span style={{ color: '#5b626d' }}>·</span> viewer=
            <span style={{ color: '#7fd9ff' }}>{anon ? 'anon' : 'dev-viewer'}</span>{' '}
            <span style={{ color: '#5b626d' }}>·</span> consent=
            {/* `data-harness-consent` carries the SAME string the chrome shows,
                so a test can assert the exact state instead of substring-matching
                body text — `ungrantable` is a substring of `granted+ungrantable`. */}
            <span data-harness-consent={consent} style={{ color: consentColor(consent) }}>
              {consent}
            </span>{' '}
            <span style={{ color: '#5b626d' }}>·</span> theme=
            <span style={{ color: '#7fd9ff' }}>{theme}</span>{' '}
            <span style={{ color: '#5b626d' }}>·</span> outbound:
            <span style={{ color: '#e2c08d' }}>{outbound.length}</span>
          </summary>
          <pre style={harnessPreStyle}>
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

// Minimal console / terminal aesthetic: dark terminal slab, monospace, a
// subtle accent top border, dim chrome text with brighter accents for the
// live readout values. Compact + unobtrusive — shared chrome rendered by
// every block app's `dev:harness`, so kept neutral, not loud.
const harnessLogStyle = {
  position: 'fixed',
  bottom: 8,
  right: 8,
  zIndex: 9999,
  pointerEvents: 'none',
  maxWidth: 520,
  background: 'rgba(13,15,18,0.94)',
  color: '#c8ccd2',
  fontSize: 11,
  lineHeight: 1.5,
  letterSpacing: '0.01em',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.06)',
  borderTop: '1px solid rgba(94,200,160,0.35)',
  boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
} as const;

const harnessSummaryStyle = {
  cursor: 'pointer',
  pointerEvents: 'auto',
  color: '#c8ccd2',
  listStyle: 'none',
  userSelect: 'none',
} as const;

const harnessPreStyle = {
  margin: '6px 0 0',
  paddingTop: 6,
  borderTop: '1px solid rgba(255,255,255,0.06)',
  maxHeight: 200,
  overflow: 'auto',
  color: '#9aa0aa',
  pointerEvents: 'auto',
} as const;
