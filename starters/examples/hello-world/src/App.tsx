import { useEffect, useRef } from 'react';

import { useBlockContext, useBlockResize } from '@civitai/blocks-react';
import { Card, Stack } from '@civitai/blocks-react/ui';
import { isModelSlotContext, isPageSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';

/**
 * hello-world — the Civitai App lifecycle in one file.
 *
 *  - `useBlockContext()` — everything the host hands the block in BLOCK_INIT
 *    (slot context, viewer, theme, ids). Fields are sentinel-empty until
 *    `ready` flips true, so gate the real UI on `ready`.
 *  - `isModelSlotContext` / `isPageSlotContext` — `context` is a discriminated
 *    union keyed on `slotId`; narrowing is what makes a slot's fields readable,
 *    and it is a real runtime check on a value that crossed `postMessage`.
 *  - `isSignedIn(viewer)` — a SIGN-IN GATE, not an identity read.
 *    `viewer.id`/`username` are deprecated (BLOCK_INIT discloses them to every
 *    block on load); for the identity call `useViewer()`, which is scope-gated
 *    and audited per call. Call the predicate rather than open-coding the gate.
 *  - `useBlockResize(ref)` — tells the host how tall the iframe should be.
 *  - The host TRUST FRAME — civitai.com draws a bordered chrome bar AROUND this
 *    iframe. Don't draw your own outer border; you'd double the host's.
 *  - THEME (gotcha #60) — the host cannot reach into this iframe, so the block
 *    themes itself: `data-theme` on <html> (the effect below) themes the page
 *    and the `/ui` components, which read the --civitai-* tokens.
 */
export function App() {
  const { ready, context, viewer, theme, blockInstanceId } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  // Keep <html> in step with the host theme: BLOCK_INIT first, then every live
  // THEME_CHANGE. index.html seeded it from the URL fragment before first paint.
  // Gated on `ready`: before BLOCK_INIT, `theme` is the transport's 'light'
  // placeholder, which would flash a dark host's page white.
  useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  // Pre-init. The host shows its own loading state until BLOCK_READY, so this
  // needs no `rootRef`: `useBlockResize` picks up the real root when it mounts.
  if (!ready) return <div style={{ padding: 16 }}>Loading…</div>;

  return (
    <div ref={rootRef} data-theme={theme} style={{ padding: 16 }}>
      <Stack gap={8}>
        <strong>Hello from a Civitai App 👋</strong>
        <Card>
          <div>
            slot: <code>{context.slotId}</code>
          </div>
          <div>
            theme: <code>{theme}</code>
          </div>
          <div>
            instance: <code>{blockInstanceId}</code>
          </div>
        </Card>

        {isModelSlotContext(context) ? (
          <Card>
            Rendering on model <strong>{context.modelName}</strong> (#{context.modelId}, version{' '}
            {context.modelVersionId}, {context.modelType})
          </Card>
        ) : null}

        {isPageSlotContext(context) ? (
          <Card>
            Rendering as the page app <code>{context.slug}</code>
            {context.subPath ? <> at sub-path <code>{context.subPath}</code></> : null}
          </Card>
        ) : null}

        <Card>
          Viewer: <strong>{isSignedIn(viewer) ? 'signed in' : 'anonymous'}</strong>
        </Card>
      </Stack>
    </div>
  );
}
