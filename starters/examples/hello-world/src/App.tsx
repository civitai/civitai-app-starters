import { useRef } from 'react';

import { useBlockContext, useBlockResize } from '@civitai/blocks-react';
import { isModelSlotContext, isPageSlotContext } from '@civitai/app-sdk/blocks';

/**
 * hello-world — the Civitai App lifecycle in one file.
 *
 * Demonstrates:
 *  - `useBlockContext()` — reads everything the host hands the block in
 *    BLOCK_INIT (slot context, viewer, theme, ids). Fields are sentinel-empty
 *    until `ready` flips true, so gate the real UI on `ready`.
 *  - `isModelSlotContext` / `isPageSlotContext` — `context` is a discriminated
 *    union keyed on `slotId`; narrowing with a guard is what makes a slot's
 *    fields readable, and it is a real runtime check on a value that crossed a
 *    `postMessage` boundary.
 *  - The viewer as a SIGN-IN GATE (`viewer ? … : 'anonymous'`) rather than an
 *    identity read. `viewer.id`/`viewer.username` are deprecated — BLOCK_INIT
 *    discloses them to every block on load, before any interaction. Need the
 *    identity? Call `useViewer()`: scope-gated, audited per call. (Not
 *    `viewer?.signedIn` yet: the dev hosts send it, production does not until
 *    the host counterpart lands (civitai/civitai#3707 — open, unmerged), so
 *    gating on it today would show every signed-in user the anonymous branch.)
 *  - `useBlockResize(ref)` — tells the host how tall the iframe should be
 *    (emits RESIZE_IFRAME on every height change). Attach to the root.
 *  - The host TRUST FRAME — civitai.com draws a bordered chrome bar with a
 *    "Civitai App block" badge AROUND this iframe. It lives in the host, not
 *    here, so a sandboxed block can't fake or hide it. Don't draw your own
 *    outer border; you'd just double the host's.
 *  - GOTCHA #60 — the block sets `data-theme` on its OWN root from
 *    `BLOCK_INIT.theme`. The host can't inject it across the iframe boundary,
 *    so any `[data-theme="dark"]` CSS (see index.css) is dormant until you do.
 */
export function App() {
  const { ready, context, viewer, theme, blockInstanceId } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  if (!ready) {
    // Pre-init: BLOCK_INIT hasn't landed. Render a minimal skeleton so the
    // iframe has something to measure. The host shows its own loading state
    // in the trust frame while it waits for our BLOCK_READY.
    return (
      <div ref={rootRef} data-theme={theme} className="hw-root">
        Loading…
      </div>
    );
  }

  return (
    <div ref={rootRef} data-theme={theme} className="hw-root">
      <strong>Hello from a Civitai App 👋</strong>
      <div className="hw-card">
        <div>
          slot: <code>{context.slotId}</code>
        </div>
        <div>
          theme: <code>{theme}</code> (this block set <code>data-theme</code> on its root)
        </div>
        <div>
          instance: <code>{blockInstanceId}</code>
        </div>
      </div>

      {isModelSlotContext(context) ? (
        <div className="hw-card">
          Rendering on model <strong>{context.modelName}</strong> (#{context.modelId}, version{' '}
          {context.modelVersionId}, {context.modelType})
        </div>
      ) : null}

      {isPageSlotContext(context) ? (
        <div className="hw-card">
          Rendering as the page app <code>{context.slug}</code>
          {context.subPath ? <> at sub-path <code>{context.subPath}</code></> : null}
        </div>
      ) : null}

      <div className="hw-card">
        Viewer: <strong>{viewer ? 'signed in' : 'anonymous'}</strong>
      </div>
    </div>
  );
}

