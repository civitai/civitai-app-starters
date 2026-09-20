---
'@civitai/blocks-react': patch
---

useBlockResize: observe a root element that mounts on a later render

The effect's dependency array was `[ref]` — the ref **wrapper**, which
`useRef` keeps stable forever. So the effect ran exactly once, on the first
render, found `ref.current === null`, and was never re-run. Every block renders
a skeleton until `BLOCK_INIT` lands, which means the root the hook is asked to
observe does not exist on that first render: the `ResizeObserver` was never
created and the host was never told to size the iframe.

The hook now keys on the **observed element**. Note the mechanical difference
from `useBlockBreakpoint`, which solves the same problem by comparing
`ref.current` read during render: that works there because the hook re-renders
its own caller. `useBlockResize` re-renders nobody, and React attaches a ref
during *commit* — after the render that mounts it — so a dependency read during
render is one render behind with no further render coming. Measured: with
`[ref.current]` as the dependency, a component that mounts its root on the
second render still observes nothing. The effect therefore runs per render and
does its own reference compare against the element it is already watching,
rebuilding the observer only when that element actually changes.

**This removes a constraint.** Blocks no longer need to pin the same `ref` to
every branch of a loading/ready conditional. The starter and all six examples
drop that workaround; the README and the "build your first app block" guide
drop it from their snippets.
