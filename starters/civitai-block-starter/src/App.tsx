import { useRef } from 'react';

import { useBlockContext, useBlockResize } from '@civitai/blocks-react';
import type { BlockContext, ModelSlotContext } from '@civitai/app-sdk/blocks';

/**
 * Replace this body with your block's actual UI.
 *
 * The starter demo:
 * - calls `useBlockContext()` to read host-provided state (slot context,
 *   viewer, theme) — the `ready` gate guards UI until BLOCK_INIT lands
 * - attaches `useBlockResize` to the root element so the host iframe
 *   shrinks/grows to fit content (RESIZE_IFRAME messages flow automatically)
 * - narrows `context` to `ModelSlotContext` since this starter is targeted
 *   at model-page slots; if your manifest targets a different slot, use
 *   the appropriate narrowing or stick with the loose `BlockContext` shape
 */
export function App() {
  const { ready, context, viewer, theme, blockId, blockInstanceId } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  if (!ready) {
    // Pre-init: the host hasn't sent BLOCK_INIT yet. Render a minimal
    // skeleton so the iframe has *something* to measure — the host
    // separately shows a loading state while it waits for our BLOCK_READY.
    return (
      <div ref={rootRef} className="block-loading" style={{ padding: 16, fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  const model = asModelContext(context);

  return (
    <div
      ref={rootRef}
      data-theme={theme}
      data-block-id={blockId}
      data-block-instance-id={blockInstanceId}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <strong>Civitai App Block starter</strong>
      <small style={{ opacity: 0.7 }}>
        slot: <code>{context.slotId}</code>
      </small>
      {model ? (
        <p style={{ margin: 0 }}>
          Rendering for model <strong>{model.modelName}</strong> (#{model.modelId}, v
          {model.modelVersionId})
        </p>
      ) : null}
      <p style={{ margin: 0 }}>
        Viewer: <strong>{viewer ? (viewer.username ?? `user ${viewer.id}`) : 'anonymous'}</strong>
        {viewer?.status === 'banned' || viewer?.status === 'muted' ? (
          <span style={{ marginLeft: 8, opacity: 0.7 }}>({viewer.status})</span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Narrows the loose `BlockContext` to `ModelSlotContext` when the slot is
 * one of the model-page slots. Returns `null` for other slots so the UI
 * can render a slot-appropriate fallback instead of reaching into missing
 * fields.
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
