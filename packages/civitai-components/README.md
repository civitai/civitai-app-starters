# @civitai/components

Attribute-driven, **framework-agnostic** component CSS for civitai App Blocks.
Plain HTML (or any framework) gets civitai-themed components with no build step —
style is selected entirely by `data-civitai-ui="…"` + `data-variant` /
`data-size` attributes, themed by [`@civitai/theme`](../civitai-theme)'s
`--civitai-*` tokens.

Components: `Button, TextInput, Textarea, NumberInput, Card, Stack, Group,
Alert, Loader, Badge`.

## Consume

**Zero JS** — link both stylesheets and author plain HTML per
[`MARKUP.md`](./MARKUP.md):

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/theme/styles.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@civitai/components/styles.css" />

<button data-civitai-ui="button" data-variant="filled" data-size="md">Generate</button>
```

**From JS** — `injectStyles()` injects both the tokens and the component CSS,
idempotently:

```ts
import { injectStyles } from '@civitai/components';
injectStyles();
```

React authors want [`@civitai/components-react`](../civitai-components-react),
which renders exactly this markup.

## Design

- All rules live in `@layer civitai.components`, so consumer CSS wins the
  cascade without specificity fights.
- State colors (hover/active/tint) are derived with `color-mix()` from base
  tokens — no shade enumeration.
- Authored in plain CSS with native nesting (no preprocessor); `src/components.css`
  is the single source of truth (copied to `dist/components.css` and embedded as
  the injectable string, guarded by a parity test).

## Markup contract

[`MARKUP.md`](./MARKUP.md) documents every component's `data-*` attributes,
allowed variant/size values, and the expected ARIA/role markup — the executable
contract the `html-vs-react-parity` browser test enforces.

## Demo

`demo/index.html` renders all components in light + dark with zero JS. Build the
packages first (`pnpm -r --filter "./packages/*" build`), then open the file.
