import { useRef } from 'react';

import { useBlockContext, useBlockResize } from '@civitai/blocks-react';
import { isModelSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';

/**
 * Replace this body with your block's actual UI.
 *
 * The starter demo:
 * - calls `useBlockContext()` to read host-provided state (slot context,
 *   viewer, theme) — the `ready` gate guards UI until BLOCK_INIT lands
 * - attaches `useBlockResize` to the root element so the host iframe
 *   shrinks/grows to fit content (RESIZE_IFRAME messages flow automatically)
 * - narrows `context` with `isModelSlotContext` since this starter is targeted
 *   at model-page slots; if your manifest targets the page slot use
 *   `isPageSlotContext` instead. `context` is a discriminated union keyed on
 *   `slotId`, so narrowing is what makes the slot's fields readable
 *
 * On the viewer: this calls `isSignedIn(viewer)` — a SIGN-IN GATE, which is all
 * most blocks need. `viewer.id` / `viewer.username` are deprecated: BLOCK_INIT
 * hands them to every block on load, before any interaction. If your block
 * genuinely needs the viewer's identity, call `useViewer()` — that read is
 * scope-gated and audited per call rather than broadcast at mount.
 *
 * 🔴 CALL THE PREDICATE; DO NOT OPEN-CODE THE GATE. This file gets copied, so a
 * gate spelled inline here becomes the gate the ecosystem writes — and two
 * earlier revisions of this comment argued for two DIFFERENT inline spellings
 * (`viewer !== null`, then `viewer?.signedIn === true`) as the wire contract
 * moved. `isSignedIn` is where that argument now lives, once, in the SDK; hover
 * it for which spelling it uses and the three measured reasons.
 */
export function App() {
  const { ready, context, viewer, theme, blockInstanceId } = useBlockContext();
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockResize(rootRef);

  if (!ready) {
    // Pre-init: the host hasn't sent BLOCK_INIT yet. The host shows its own
    // loading state while it waits for our BLOCK_READY, so this skeleton is
    // just a placeholder — it does NOT need `rootRef`. `useBlockResize` picks
    // up the real root when it mounts on a later render.
    return (
      <div className="block-loading" style={{ padding: 16, fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-theme={theme}
      data-block-instance-id={blockInstanceId}
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <strong>Civitai App starter</strong>
      <small style={{ opacity: 0.7 }}>
        slot: <code>{context.slotId}</code>
      </small>
      {isModelSlotContext(context) ? (
        <p style={{ margin: 0 }}>
          Rendering for model <strong>{context.modelName}</strong> (#{context.modelId}, v
          {context.modelVersionId})
        </p>
      ) : null}
      <p style={{ margin: 0 }}>
        Viewer: <strong>{isSignedIn(viewer) ? 'signed in' : 'anonymous'}</strong>
      </p>
    </div>
  );
}
