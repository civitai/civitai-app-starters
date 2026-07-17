import { useEffect, useState, type ReactNode } from 'react';

import { hostToRunUrl } from '../internal/directLoad.js';
import { useDirectLoad } from '../hooks/useDirectLoad.js';
import { Card } from './Card.js';
import { Stack } from './Stack.js';
import { useBlocksStyles } from './styles.js';

/**
 * Read the OS/browser color-scheme preference, live.
 *
 * A directly-loaded block has NO `BLOCK_INIT`, so there is no host `theme` to
 * set `data-theme` from (the usual gotcha-#60 path). We fall back to
 * `prefers-color-scheme` so the fallback card still themes correctly in light
 * AND dark. Guarded for SSR / engines without `matchMedia`.
 */
function usePrefersColorScheme(): 'light' | 'dark' {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    // Modern browsers: addEventListener. Older Safari: addListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    if (typeof mql.addListener === 'function') {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
    return;
  }, []);

  return dark ? 'dark' : 'light';
}

/**
 * Props for {@link DirectLoadFallback}.
 */
export interface DirectLoadFallbackProps {
  /**
   * Override the hostname used to derive the `civitai.com/apps/run/<slug>` URL.
   * Defaults to `window.location.hostname`. Primarily a testing seam.
   */
  hostname?: string;
  /**
   * When set (and a run URL could be derived), auto-navigate the top window to
   * the run URL after this many milliseconds. OFF by default — a click-to-open
   * landing is the safe default (no surprise navigation; good for shared links,
   * social unfurls, and SEO). The visible button is always the primary path.
   */
  autoRedirectMs?: number;
}

const wrapperStyle: React.CSSProperties = {
  minHeight: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  boxSizing: 'border-box',
  background: 'var(--ci-color-surface-2)',
  color: 'var(--ci-color-text)',
};

const brandStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ci-color-primary)',
};

const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 700 };

const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
  color: 'var(--ci-color-text-dimmed)',
};

/**
 * The branded "Open on Civitai" landing shown when a block is loaded DIRECTLY
 * (top-level at its bare `<slug>.civit.ai` origin) instead of embedded in the
 * civitai host — the graceful degrade for what would otherwise be a perpetual
 * loading spinner.
 *
 * Two states, chosen from the (overridable) hostname:
 *  - Deployed block host (`<slug>.civit.ai`): a card with an "Open on Civitai"
 *    link to `https://civitai.com/apps/run/<slug>` (a real anchor — right/middle
 *    click, shareable, crawlable). Optional {@link DirectLoadFallbackProps.autoRedirectMs}
 *    auto-redirect on top of the button.
 *  - Non-civit.ai host (e.g. `localhost` in dev without the harness): a neutral
 *    "waiting for the Civitai host" card with a dev hint — NEVER a broken
 *    `apps/run/localhost` link.
 *
 * Theme-aware via `prefers-color-scheme` (there is no host `theme` on a direct
 * load) and styled with the `/ui` pack's tokens.
 */
export function DirectLoadFallback({
  hostname,
  autoRedirectMs,
}: DirectLoadFallbackProps): React.JSX.Element {
  useBlocksStyles();
  const theme = usePrefersColorScheme();
  const resolvedHost =
    hostname ?? (typeof window !== 'undefined' ? window.location?.hostname : undefined);
  const runUrl = hostToRunUrl(resolvedHost);

  useEffect(() => {
    if (!runUrl || autoRedirectMs == null || typeof window === 'undefined') return;
    const id = setTimeout(() => {
      try {
        // Navigate the TOP frame (equals self on a direct load; correct either way).
        (window.top ?? window).location.href = runUrl;
      } catch {
        window.location.href = runUrl;
      }
    }, autoRedirectMs);
    return () => clearTimeout(id);
  }, [runUrl, autoRedirectMs]);

  return (
    <div
      data-theme={theme}
      data-civitai-block-direct-load="true"
      style={wrapperStyle}
    >
      <Card withBorder padding="lg" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
        <Stack gap={12} align="center">
          <span style={brandStyle}>Civitai App</span>
          {runUrl ? (
            <>
              <strong style={titleStyle}>Open this app on Civitai</strong>
              <span style={bodyStyle}>
                This is a Civitai App. It runs inside Civitai, where you can sign in and use it.
              </span>
              {/* A real anchor styled as the pack's button — shareable, crawlable,
                  right/middle-clickable. `target="_top"` navigates the whole page. */}
              <a
                data-civitai-ui="button"
                data-variant="filled"
                data-size="lg"
                data-full-width="true"
                data-civitai-block-open-on-civitai="true"
                href={runUrl}
                target="_top"
                rel="noopener"
              >
                Open on Civitai
              </a>
            </>
          ) : (
            <>
              <strong style={titleStyle}>Waiting for the Civitai host…</strong>
              <span style={bodyStyle} role="status">
                This is a Civitai App. It’s meant to run inside the Civitai host. In local
                development, load it through the block dev harness.
              </span>
            </>
          )}
        </Stack>
      </Card>
    </div>
  );
}

/**
 * Props for {@link BlockGate}.
 */
export interface BlockGateProps {
  /** The block app. Rendered whenever the block is NOT a direct (unembedded) load. */
  children: ReactNode;
  /**
   * Milliseconds to wait for `BLOCK_INIT` before treating a top-level load as a
   * direct load. Forwarded to {@link useDirectLoad}. Defaults to 2000ms.
   */
  timeoutMs?: number;
  /** Override the fallback rendered on a direct load. Defaults to {@link DirectLoadFallback}. */
  fallback?: ReactNode;
  /** Forwarded to the default {@link DirectLoadFallback} (testing seam). */
  hostname?: string;
  /** Forwarded to the default {@link DirectLoadFallback}. */
  autoRedirectMs?: number;
}

/**
 * Drop-in wrapper that shows the {@link DirectLoadFallback} when a block is
 * loaded DIRECTLY (top-level, no `BLOCK_INIT` within the timeout) and otherwise
 * renders `children` unchanged.
 *
 * Wrap your app root once so EVERY SDK-built block degrades gracefully instead
 * of hanging on a loading spinner when its `<slug>.civit.ai` URL is opened
 * directly:
 *
 * ```tsx
 * import { BlockGate } from '@civitai/blocks-react/ui';
 *
 * createRoot(el).render(
 *   <BlockGate>
 *     <App />
 *   </BlockGate>,
 * );
 * ```
 *
 * The embedded happy path and the dev harness are untouched — see
 * {@link useDirectLoad} for exactly why the trigger can't fire in either.
 */
export function BlockGate({
  children,
  timeoutMs,
  fallback,
  hostname,
  autoRedirectMs,
}: BlockGateProps): React.JSX.Element {
  const directLoad = useDirectLoad({ timeoutMs });
  if (directLoad) {
    return (
      <>{fallback ?? <DirectLoadFallback hostname={hostname} autoRedirectMs={autoRedirectMs} />}</>
    );
  }
  return <>{children}</>;
}
