---
'@civitai/components': minor
'@civitai/components-react': minor
---

`<civitai-workflow-button>` prices a workflow, runs it on the viewer's Buzz and
reports it — as one control. The price is in its label before a press; while it
runs it spins, names the stage the workflow is at, counts its steps off as they
finish and fills its own background with the lowest progress rate any step
reports; a second press asks whether to cancel,
offering the workflow id to copy. A finished run
says how it ended before the button offers its price again. A metered workflow,
billed as it runs, is offered without a price rather than as free. It
emits `priced`, `submitted`, `progress`, `finished`, `canceled` and `error`, so
an app stops rebuilding submit-watch-cancel around every generate button.

`variant`, `size`, `full-width` and `disabled` pass through to the button it
wraps, so an app never needs `::part` CSS for what a plain button already does.

Like `<civitai-sign-in-button>` it needs `@civitai/sdk` (an optional peer) and
sits behind its own entry point, out of `register` and the CDN bundles.
