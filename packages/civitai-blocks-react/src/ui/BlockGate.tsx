import { useEffect, type ReactNode } from 'react';

import { hostToRunUrl } from '../transport/directLoad.js';
import { useDirectLoad } from '../hooks/useDirectLoad.js';
import { Card } from './Card.js';
import { Stack } from './Stack.js';
import { useBlocksStyles } from './styles.js';

/**
 * The theme the PAGE is already painted in — never the OS preference.
 *
 * A directly-loaded block has no host: no `BLOCK_INIT`, no `THEME_CHANGE`. The
 * only theme signal that can reach this card is the one the document itself
 * booted with — `data-theme` on `<html>`, which the scaffolded `index.html`
 * sets pre-paint from the host fragment (`#civitai-block=v1&theme=…`). So the
 * card follows the page instead of second-guessing it, and a block with no
 * fragment boots dark like every other Civitai surface.
 *
 * `'light'` is the ONLY value that buys light — exactly the rule the pre-paint
 * script applies. Absent, empty, `'auto'`, a typo, or no DOM at all (SSR) are
 * all dark.
 *
 * Reading `prefers-color-scheme` here was the defect: on a light-OS machine it
 * painted a LIGHT card on a deliberately DARK page.
 *
 * Setting the attribute explicitly, rather than inheriting it, keeps this card's
 * theme a decision of this component rather than of whatever is above it.
 *
 * ⚠️ It used to be load-bearing for a stronger reason that no longer holds:
 * `@civitai/theme` shipped
 * `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }`, so a
 * document carrying no `data-theme` handed its tokens back to the OS and only an
 * explicit attribute could stop it. Since `@civitai/theme@0.5.0` the base is
 * dark and that at-rule is gone, so inheriting would reach the same answer on a
 * direct-load page. One real difference survives and is why this stays: the read
 * below is `document.documentElement`, whereas inheritance takes the NEAREST
 * `[data-theme]` ancestor. Those coincide on a direct load — no host, no wrapper
 * — but that is a property of the deployment, not of this code.
 */
function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement?.dataset?.theme === 'light' ? 'light' : 'dark';
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
  background: 'var(--civitai-color-surface-2)',
  color: 'var(--civitai-color-text)',
};

const brandStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--civitai-color-primary)',
};

const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 700 };

const bodyStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.5,
  color: 'var(--civitai-color-text-dimmed)',
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
 * Themed from the PAGE — `data-theme` on `<html>`, dark when absent — never
 * from the OS preference (see {@link readDocumentTheme}), and styled with the
 * `/ui` pack's tokens.
 */
export function DirectLoadFallback({
  hostname,
  autoRedirectMs,
}: DirectLoadFallbackProps): React.JSX.Element {
  useBlocksStyles();
  const theme = readDocumentTheme();
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
 *
 * It also injects the design-system stylesheets, on BOTH branches. Every `/ui`
 * component calls {@link useBlocksStyles} itself, so styling used to arrive as a
 * side effect of rendering one — which means a block that wraps its root in
 * `BlockGate` but renders NO `/ui` component (its own markup, another UI
 * library, a canvas) got the tokens on the direct-load fallback and ZERO
 * design-system CSS on the happy path. Wrapping the root is the one thing every
 * block is told to do, so that is the right place to make it unconditional.
 */
export function BlockGate({
  children,
  timeoutMs,
  fallback,
  hostname,
  autoRedirectMs,
}: BlockGateProps): React.JSX.Element {
  // BEFORE the branch, and unconditional: hook order must not depend on
  // `directLoad`, and the happy path is the branch that was missing styles.
  useBlocksStyles();
  const directLoad = useDirectLoad({ timeoutMs });
  if (directLoad) {
    return (
      <>{fallback ?? <DirectLoadFallback hostname={hostname} autoRedirectMs={autoRedirectMs} />}</>
    );
  }
  return <>{children}</>;
}
