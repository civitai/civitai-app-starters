/**
 * hostSurface.ts — which production host a dev host stands in for.
 *
 * civitai.com has two hosts. A full-page app (`app.page`) is mounted by the page
 * host; a block in a `model.*` slot is mounted by the model-slot host. They
 * answer a few messages differently, so a dev host has to know which of the two
 * it is imitating. Both dev hosts (`createMockHost`, `createLiveHost`) read it
 * from the one place they already model it: the `BLOCK_INIT` context.
 */

import type { BlockContext } from '@civitai/app-sdk/blocks';

/** The slot id of a full-page app. */
export const PAGE_SLOT_ID = 'app.page';

/**
 * Is this dev host standing in for the PAGE host?
 *
 * `context` is the `options.context` the harness passed. `undefined` is a page:
 * both dev hosts default to a complete page context when none is given.
 *
 * Keyed on the slot id alone, not on `isPageSlotContext`. Production picks the
 * host by the slot the app is mounted in, so an incomplete `{ slotId:
 * 'app.page' }` context is still a page.
 */
export function emulatesPageHost(context: BlockContext | undefined): boolean {
  return (context?.slotId ?? PAGE_SLOT_ID) === PAGE_SLOT_ID;
}

/**
 * The `error` the page host answers `SET_USER_CHECKPOINT` with, verbatim.
 *
 * A page token is bound to no model, and the server writes a checkpoint override
 * into the settings row of a model-bound install. The page host therefore
 * refuses every such request with `USER_CHECKPOINT_SET { requestId, ok: false,
 * error }`, whatever `versionId` was sent, and makes no server call.
 *
 * Read from `civitai/civitai` `main` at `c1fffa4d1f`
 * (`src/components/AppBlocks/PageBlockHost.tsx`). It is host-authored text: show
 * it or log it, do not branch on it.
 */
export const PAGE_CHECKPOINT_PERSIST_ERROR =
  'page blocks cannot persist a checkpoint override (no model binding)';
