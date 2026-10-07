// Registers the GENERIC `<civitai-*>` kit — every element except seven:
//  - the civitai.com vocabulary (`<civitai-avatar>`, `<civitai-media-card>`,
//    `<civitai-rating-badge>`, `<civitai-reaction>`, `<civitai-tag>`) needs
//    `import '@civitai/components/register-site';` instead (it includes this);
//  - the two SDK-backed elements (`<civitai-sign-in-button>`,
//    `<civitai-workflow-button>`) each need their own
//    `import '@civitai/components/<tag>/define';`.
// To trim the bundle, swap this for the elements you actually use, e.g.
// `import '@civitai/components/civitai-text/define';`. Either way, an element
// nothing defines renders as an unstyled, inert tag with NO error —
// `test/block.test.ts` fails if the starter uses one.
import '@civitai/components/register';

import { BridgeError, initialize, type BlockAppClient } from '@civitai/sdk';
import { isModelSlotContext, isSignedIn } from '@civitai/app-sdk/blocks';

import { DIRECT_LOAD_TIMEOUT_MS, isTopLevel, renderDirectLoadFallback } from './directLoad.js';

/**
 * Replace the markup and `fill` with your block's actual UI.
 *
 * The starter demo:
 * - `initialize()` from `@civitai/sdk` waits for the host's `BLOCK_INIT` and
 *   resolves with `app` — slot context, viewer, theme, settings, and `app.host`
 *   for host UI. Until it resolves, the boot skeleton in index.html is what the
 *   viewer sees, so there is no separate loading state to render.
 * - The view is BUILT ONCE and then UPDATED IN PLACE: `app.onChange` fires on
 *   every snapshot change — a theme toggle, a route change, and also every
 *   token rotation, which changes nothing on screen — so it only re-syncs the
 *   theme and rewrites the text of the `data-field` elements. Rebuilding the
 *   view there would throw away anything the viewer typed every few minutes.
 * - `app.host.autoResize(root)` keeps the host iframe as tall as the content
 *   (`RESIZE_IFRAME` messages flow automatically).
 * - `context` is narrowed with `isModelSlotContext` since this starter targets
 *   model-page slots; if your manifest targets the page slot use
 *   `isPageSlotContext` instead. `context` is a union keyed on `slotId`, so
 *   narrowing is what makes the slot's fields readable.
 *
 * On the viewer: this calls `isSignedIn(app.viewer)` — a SIGN-IN GATE, which is
 * all most blocks need. 🔴 CALL THE PREDICATE; DO NOT OPEN-CODE THE GATE. This
 * file gets copied, so a gate spelled inline here becomes the gate the ecosystem
 * writes; the wire contract has moved before, and `isSignedIn` is where that
 * argument lives, once, in the SDK. If your block genuinely needs the viewer's
 * identity, read it from the block route `app.site.get('blocks/me')` rather
 * than from `app.viewer` — NOT `app.site.get('me')`, which the block token
 * cannot authenticate. `blocks/me` needs the `user:read:self` scope declared in
 * block.manifest.json (this starter declares none) and is consent-gated, so ask
 * for it with `app.requestGrants` first (see AGENTS.md).
 */
export async function mountBlock(root: HTMLElement): Promise<BlockAppClient> {
  const app = await waitForHost(root);

  const view = createView();
  const update = () => {
    syncTheme(app);
    fill(view, app);
  };
  update();
  // Replacing #root's children — once — is also what removes the boot skeleton
  // (or the direct-load card, if a late host answered).
  root.replaceChildren(view.root);
  app.onChange(update);
  app.host.autoResize(root);
  return app;
}

/**
 * Starts the block and makes a failure VISIBLE: a block that cannot start
 * (a malformed host payload, a bug in `fill`) shows an error in place of the
 * boot skeleton, which would otherwise stay up forever with nothing said.
 * This is what `src/main.ts` calls.
 */
export async function startBlock(root: HTMLElement): Promise<void> {
  try {
    await mountBlock(root);
  } catch (error) {
    console.error('[civitai-block] could not start:', error);
    renderStartError(root);
  }
}

function renderStartError(root: HTMLElement): void {
  const alert = document.createElement('civitai-alert');
  alert.setAttribute('color', 'error');
  alert.setAttribute('heading', 'This app could not start');
  alert.setAttribute('role', 'alert');
  alert.dataset.blockError = '';
  // A fixed sentence, not the error's message: a message can carry host data,
  // and the details are in the console.
  alert.textContent = 'Reload the page to try again.';
  const wrapper = document.createElement('div');
  wrapper.dataset.blockRoot = '';
  wrapper.append(alert);
  root.replaceChildren(wrapper);
}

/**
 * Keeps the PAGE (`<html>`) in step with the host theme, so a live THEME_CHANGE
 * repaints the background behind the app too — and the `<civitai-*>` elements
 * with it, since they read the `--civitai-*` tokens that `[data-theme]` selects.
 * index.html's inline script seeds the same attribute from the URL fragment
 * before first paint; from BLOCK_INIT onward this owns it (the payload is
 * authoritative — it must be able to correct a stale fragment).
 */
function syncTheme(app: BlockAppClient): void {
  document.documentElement.dataset.theme = app.theme;
}

/**
 * The markup is STATIC — no value is ever interpolated into it. Everything that
 * comes from the host (the model name above all, which is user-authored) is
 * written with `textContent`, so it can never be parsed as HTML. Keep it that
 * way when you extend it: `innerHTML` with a template literal that includes host
 * data is an XSS hole.
 */
const VIEW = document.createElement('template');
VIEW.innerHTML = `
  <civitai-stack gap="sm" data-block-root>
    <civitai-text as="h2" size="md" weight="bold">Civitai App starter</civitai-text>
    <civitai-text size="xs" data-dimmed>slot: <code data-field="slot"></code></civitai-text>
    <civitai-text size="sm" data-field="model">
      Rendering for model <strong data-field="model-name"></strong>
      (#<span data-field="model-id"></span>, v<span data-field="model-version-id"></span>)
    </civitai-text>
    <civitai-group gap="sm">
      <civitai-text size="sm">Viewer:</civitai-text>
      <civitai-badge variant="light" data-field="viewer"></civitai-badge>
    </civitai-group>
  </civitai-stack>
`;

interface View {
  root: HTMLElement;
  field(name: string): HTMLElement;
}

function createView(): View {
  const fragment = VIEW.content.cloneNode(true) as DocumentFragment;
  const root = fragment.querySelector<HTMLElement>('[data-block-root]')!;
  return {
    root,
    field: (name) => root.querySelector<HTMLElement>(`[data-field="${name}"]`)!,
  };
}

/**
 * Writes the current snapshot into the view's fields. Runs on mount and on
 * every `onChange`, so it must only UPDATE: set text and visibility, never
 * replace nodes — anything you add to the view keeps its state across calls.
 */
function fill(view: View, app: BlockAppClient): void {
  const { context } = app;
  view.field('slot').textContent = context.slotId;

  if (isModelSlotContext(context)) {
    view.field('model').style.display = '';
    view.field('model-name').textContent = context.modelName;
    view.field('model-id').textContent = String(context.modelId);
    view.field('model-version-id').textContent = String(context.modelVersionId);
  } else {
    // An inline style, not the `hidden` attribute: a custom element's own
    // `:host { display: … }` outranks the UA's `[hidden]` rule.
    view.field('model').style.display = 'none';
  }

  view.field('viewer').textContent = isSignedIn(app.viewer) ? 'signed in' : 'anonymous';
}

/**
 * Resolves once the host has sent `BLOCK_INIT`.
 *
 * Opened top-level (no host will ever answer), it shows the "Open on Civitai"
 * card after {@link DIRECT_LOAD_TIMEOUT_MS} — but keeps waiting, so a late
 * `BLOCK_INIT` still mounts the block over it. Embedded, it never gives up: a
 * slow host is not a missing one, and the viewer keeps the boot skeleton.
 */
async function waitForHost(root: HTMLElement): Promise<BlockAppClient> {
  const topLevel = isTopLevel();
  let fallbackShown = false;
  for (;;) {
    try {
      return await initialize({ timeoutMs: DIRECT_LOAD_TIMEOUT_MS });
    } catch (error) {
      // Only "no host answered yet" is retried; anything else is a real failure.
      if (!(error instanceof BridgeError) || error.code !== 'unavailable') throw error;
      if (topLevel && !fallbackShown) {
        renderDirectLoadFallback(root);
        fallbackShown = true;
      }
    }
  }
}
