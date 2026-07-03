import { useRef } from 'react';

import { useBlockContext, useBlockResize } from '@civitai/blocks-react';
import type { BlockContext, ModelSlotContext } from '@civitai/app-sdk/blocks';

/**
 * hello-world — the Civitai App lifecycle in one file.
 *
 * Demonstrates:
 *  - `useBlockContext()` — reads everything the host hands the block in
 *    BLOCK_INIT (slot context, viewer, theme, ids). Fields are sentinel-empty
 *    until `ready` flips true, so gate the real UI on `ready`.
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
  const { ready, context, viewer, theme, blockId, blockInstanceId } = useBlockContext();
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

  const model = asModelContext(context);

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
          block: <code>{blockId}</code> · instance: <code>{blockInstanceId}</code>
        </div>
      </div>

      {model ? (
        <div className="hw-card">
          Rendering on model <strong>{model.modelName}</strong> (#{model.modelId}, version{' '}
          {model.modelVersionId}, {model.modelType})
        </div>
      ) : null}

      <div className="hw-card">
        Viewer:{' '}
        <strong>{viewer ? (viewer.username ?? `user ${viewer.id}`) : 'anonymous'}</strong>
        {viewer && viewer.status !== 'active' ? (
          <span style={{ marginLeft: 8, opacity: 0.7 }}>({viewer.status})</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Narrows the loose `BlockContext` to `ModelSlotContext` for the model-page
 * slots. Returns `null` for other slots so the UI can render a fallback
 * instead of reaching into fields that aren't there.
 */
function asModelContext(ctx: BlockContext): ModelSlotContext | null {
  if (
    ctx.slotId === 'model.sidebar_top' ||
    ctx.slotId === 'model.below_images' ||
    ctx.slotId === 'model.actions_extra'
  ) {
    return ctx as ModelSlotContext;
  }
  return null;
}
