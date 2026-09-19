# @civitai/components-react

Thin React bindings over [`@civitai/components`](../civitai-components) —
`forwardRef` wrappers that render the framework-agnostic `data-civitai-ui`
markup and auto-inject the stylesheet + `--civitai-*` tokens. Presentational
only; this is **not** a replacement for `@civitai/blocks-react` (which stays the
home of the transport hooks + block-authoring components).

```tsx
import { Button, TextInput, Alert } from '@civitai/components-react';

<Button variant="filled" onClick={onGenerate}>Generate</Button>
<TextInput label="Prompt" error={err} />
<Alert color="success" title="Saved">Your changes are live.</Alert>
<Badge color="success" variant="light">ready</Badge>
```

`Badge` takes an optional `color` (`info | success | warning | error`, mirroring
`Alert`); omit it for the default primary accent.

Components: `Button, TextInput, Textarea, NumberInput, Card, Stack, Group,
Alert, Loader, Badge`. Each renders the exact markup documented in
[`@civitai/components/MARKUP.md`](../civitai-components/MARKUP.md).

## Elements

React bindings for the custom elements in
[`@civitai/components`](../civitai-components#elements), on their own entry
point so nothing here pulls a renderer unless you ask for one:

```tsx
import { ButtonElement, SegmentedControlElement } from '@civitai/components-react/elements';

<ButtonElement variant="outline" onClick={run}>Generate</ButtonElement>
<SegmentedControlElement data={views} value={view} onChange={setView} aria-label="View" />
```

These sit alongside `Button` / `SegmentedControl`, which keep rendering the
attribute markup. The difference is where the behaviour lives: the elements
carry it themselves, so the same keyboard handling works outside React too.

Props are assigned as **properties** after mount. React chooses between
attribute and property by whether the element has upgraded, so a boolean can
arrive as the string `""` and never reach Lit's converter — and an array prop
like `data` cannot survive an attribute at all.

## The point of this package

It proves the **dual-consumption** claim: the `html-vs-react-parity` browser
test renders each component both as React and as hand-written HTML with the same
`data-*` attributes, then asserts **identical** `getComputedStyle()` in light
and dark. Passing means external authors can ship plain HTML that looks
byte-identical to the React path.

## Tests

- `pnpm --filter @civitai/components-react test` — happy-dom unit suite (markup
  + ARIA contract).
- `pnpm --filter @civitai/components-react test:browser` — real headless
  Chromium: HTML-vs-React computed-style parity (light + dark) + axe a11y, plus
  an opt-in visual-regression layer (`VITE_RUN_VR=1`).

On NixOS, point Playwright at a system Chromium:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(nix-shell -p chromium --run 'command -v chromium') pnpm --filter @civitai/components-react test:browser`.
