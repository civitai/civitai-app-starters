---
'@civitai/blocks-react': minor
---

Deep-copy the host-side slot context, so the dev harnesses match the production
`postMessage` boundary instead of aliasing the caller's nested values.

`hostContextWithTheme` — the host-side helper that layers the resolved `theme`
onto a slot context on its way into `BLOCK_INIT` — returned `{ ...ctx }`, a
SHALLOW copy. That fenced off whole-key reassignment and nothing else.

The divergence that made it matter: the function is imported by exactly two call
sites, both DEV hosts (`createMockHost`, `createLiveHost`), and both deliver
host→block messages with `win.dispatchEvent(new MessageEvent('message', …))` — a
same-realm synthetic event that passes `data` **by reference**. There is no
structured clone anywhere on that path. Production's real cross-origin
`postMessage` does structured-clone, but production never calls this function. So
every nested value on a dev-delivered context kept the harness's identity — for a
`ModelSlotContext` that is `checkpoint` (an object) and `showcaseImages` (an
array). A harness mutating `ctx.showcaseImages` IN PLACE after init still reached
the block's `BlockSnapshot`, which a block is entitled to treat as immutable; and
in the other direction anything downstream of the snapshot writing through its own
context corrupted the harness's own fixture.

It now returns `structuredClone(ctx)`. The rationale is **production parity, not
defensiveness**: the clone is exactly what the real boundary does, so a block that
behaves correctly in the harness behaves correctly in production — which is the
entire point of a dev harness.

🔴 **A non-cloneable `options.context` now THROWS, and that is fidelity, not a
regression.** A function, class instance, proxy or DOM node makes
`structuredClone` raise `DataCloneError`, and production's `postMessage` would
reject the same input; a silent shallow fallback would re-open the divergence the
clone exists to close. Because a raw `DataCloneError` from this depth names
nothing useful, it is re-thrown as an error naming the function, the offending
`slotId` and the likely cause, with the original `DataCloneError` preserved as
`cause`.

The theme-merge semantics are unchanged: still keyed on the slot id (not on
`'theme' in ctx`), and still never invents a `theme` on an `UnknownSlotContext`.
