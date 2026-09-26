---
'@civitai/blocks-react': patch
---

The documented settings write path pointed at `/apps/installed`, a route that
301s away. Three shipped sites said so; none of them says it now.

Documentation only — no API, type or behaviour change. Two of the three are
JSDoc under `src/`, so they reach **IDE hover for every consumer** through the
emitted `.d.ts`. That is worse than a stale docs page: a reader never navigates
to it, it arrives unbidden at the call site.

The sites, enumerated rather than sampled — `/apps/installed` occurred exactly
three times in shipped code and prose before this change, all in this package,
and occurs **zero** times there now. (It still appears in text *about* the
retraction — this changeset, and the guard that enforces it — both of which sit
outside the guard's corpus. Inside the corpus the guard cannot tell a live claim
from a quoted retraction, and deliberately fails on either; its header says so):

- `src/hooks/useBlockSettings.ts` — *"settings are written on the platform
  `/apps/installed` page"*.
- `src/ui/SettingsForm.tsx` — a four-item *"Designed to be used from"* list.
- `README.md` — the `useBlockSettings()` section, repeating the hook's docblock.

**What is actually true**, verified against civitai/civitai at `origin/main`:

- `/apps/installed` is retired. `next.config.mjs` 301s it to `/apps/activity`,
  and `src/__tests__/pages/apps-activity-redirect.test.ts` pins that redirect.
  There is no `src/pages/apps/installed.tsx`.
- Settings are written by civitai's own app settings panel,
  `src/components/Apps/AppSettingsModal.tsx`, through
  `trpc.blocks.upsertSubscription`.
- That panel builds its form from the same manifest `settings` declaration but
  with its **own widgets**. It does not render this package's `SettingsForm`:
  the only occurrence of that name in civitai's tree is a comment in
  `src/server/schema/blocks/manifest-settings.meta.schema.ts`. The control for
  that zero is that civitai *does* import `@civitai/blocks-react` elsewhere
  (e.g. `src/components/AppBlocks/IframeHost.tsx`), so the absence is real and
  not an artefact of the package being unused there.

`SettingsForm`'s four-item list was false in every item, not just in the URL:
`/apps/installed` is retired, item 2 depended on it, there is no
`/apps/[appBlockId]/settings` page, and no component under `src/components/Model`
renders a settings form. The list is replaced by what the component actually is
— a headless form for the block author's own UI, whose `onSubmit` persists
nothing by itself.

**No replacement URL is named, deliberately.** Naming one is how this text
rotted: the route was correct when written and became a 301 under it. The
corrected prose describes the mechanism and the owner instead, reusing the
wording an earlier fix to the unpublished example docs already settled on. The
one write a block *can* perform itself — the viewer's checkpoint, via
`SET_USER_CHECKPOINT` — is now named, because that is the question a reader who
wanted a write path is really asking.

Guarded by `tests/guards/retired-platform-routes.test.mjs`, which fails if any
published package names a retired `/apps/*` route. It was mutation-tested
against each of the three pre-change sites individually: every one turns the
guard red with its own error, and the guard is green with all three fixed.
