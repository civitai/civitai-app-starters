# @civitai/block-components

Custom elements that speak the **Civitai App host bridge**. Everything
presentational lives in [`@civitai/components`](../civitai-components); this
package is only the elements that need to talk to the host frame.

```ts
import '@civitai/block-components/register';
```

```html
<civitai-sign-in-button return-url="/gallery">Sign in to continue</civitai-sign-in-button>
```

## Why this is a separate package

`@civitai/blocks-client` is for on-site block apps only — an external OAuth app
has no host frame to talk to, so there is nothing for the transport to reach.
If `@civitai/components` depended on it, every external app would pay for a
bridge it cannot use and the design system would stop being a design system.

So the dependency arrow points one way:

```
@civitai/block-components ──▶ @civitai/components ──▶ @civitai/theme
             └──────────────▶ @civitai/blocks-client
```

`pnpm --filter @civitai/block-components check:layering` fails the build if
`@civitai/components` ever imports the bridge or declares it as a dependency.
It runs in CI before anything else here.

## Before `BLOCK_INIT`

There is no validated host origin until the handshake lands, so every element
here is **inert** until then: pressing `<civitai-sign-in-button>` before init
sends nothing at all, and the button renders disabled so the refusal is visible
rather than silent. That is asserted, not assumed.

## What is not here yet

Most bridge-bound elements are waiting on host work rather than on this package.
`@civitai/blocks-client`'s `BREAKING.md` tracks the asks — `BUZZ_*` and
`ORCHESTRATION_*` have no host handler yet, tipping is REST-only, and the
resource pickers were dropped with reasons recorded.
