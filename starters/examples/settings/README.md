# settings — manifest-driven settings

How a Civitai App declares settings and renders the form for them.

## What it shows

| Concept | Where |
|---|---|
| `settings` declaration in the manifest (4 fields, 3 types, 2 scopes) | `block.manifest.json` |
| Reading delivered settings with `useBlockSettings()` | `src/App.tsx` |
| The headless `SettingsForm` from `@civitai/blocks-react/ui` | `src/App.tsx` |
| `publisher` vs `viewer` scope | below |

## The settings model

Declare each setting in `block.manifest.json` under `settings`, keyed by a
`snake_case` field name:

```jsonc
"settings": {
  "watermark_text": {
    "scope": "publisher",          // model owner controls it
    "type": "string", "widget": "text",
    "label": "Watermark text",
    "description": "Stamped onto outputs.",
    "default": "made on civitai", "max_length": 40
  },
  "preferred_sampler": {
    "scope": "viewer",             // each user controls their own
    "type": "string", "widget": "select",
    "label": "Preferred sampler",
    "description": "Per-viewer sampler choice.",
    "enum": ["Euler", "DPM++ 2M Karras"], "default": "Euler"
  }
}
```

Types are `number` | `string` | `boolean`; widgets are `number` / `slider` /
`text` / `textarea` / `select` / `toggle` / `resource_picker`. Max 32 fields.
The platform validates user input against this declaration (`validateBlockSettings`)
and renders the form from it — same source of truth for both.

### Two scopes

- **`publisher`** — set by the model owner / installer. Stored on the install.
  The block **reads** them from `BLOCK_INIT.settings.publisherSettings`. A
  viewer can't change them.
- **`viewer`** — each signed-in user controls their own. Read from
  `BLOCK_INIT.settings.userSettings`.

## Where settings get written

From inside the iframe a block can only **read** the settings the host
delivered at init — there is no "set settings" postMessage. Persistence
happens on the platform's `/apps/installed` page (and the model-edit banner),
which renders this same `SettingsForm` and wires `onSubmit` to the platform
tRPC. This example renders the viewer form inline so you can see the component,
but its `onSubmit` only previews the values locally. Use it to prototype the
field layout; the real write path is the platform page.

## `SettingsForm`

```tsx
import { SettingsForm } from '@civitai/blocks-react/ui';

<SettingsForm
  manifestSettings={manifest.settings}
  declaredScopes={manifest.scopes}   // drives requires_scope gating
  forScope="viewer"                   // or "publisher"
  initialValues={settings.userSettings}
  onSubmit={async (values) => { /* persist (platform page) or preview */ }}
/>
```

It's intentionally **unstyled** (native controls, no Mantine, no CSS imports) —
the host page themes it. A field with `requires_scope: "ai:write:budgeted"`
only renders when that scope is in `declaredScopes`.

## Run it

```bash
cp .env.example .env
pnpm install
pnpm dev:harness   # → http://localhost:5181
```

The harness seeds both publisher and viewer settings so the form starts
populated. See the [root README](../../../README.md) for submit → review →
deploy.
