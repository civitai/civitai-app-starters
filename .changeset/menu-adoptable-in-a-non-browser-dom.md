---
'@civitai/components': minor
'@civitai/blocks-react': minor
---

`<civitai-menu>` is adoptable by an App Block: it works in a non-browser DOM, and
its items can sit in a container the consumer owns.

Two independent blockers, either of which alone stopped a real adoption (#485).

**It threw in every non-browser DOM.** The element read its own open state through
`:popover-open` and drove its panel with `showPopover()`. Neither exists in
`jsdom` or `happy-dom` at any version, so a consumer's own suite — the
`happy-dom` environment `@civitai/blocks-react/testing` is documented for — could
not mount a screen containing a menu, let alone open one. The panel's visibility
is now decided by a `data-open` attribute the element writes, which is true in
every DOM and assertable outside a browser. `showPopover()`/`hidePopover()` are
**still called wherever they exist**, so a real browser keeps the two things
popover was chosen for: escape from a clipping ancestor via the top layer, and
native light dismiss. One code path, not two — the attribute is the state, the
popover API is presentation.

**Its items could not be given an addressable hook.** `part="panel"` styles the
panel but is not a query target, and `document.querySelector` does not pierce a
shadow root, so a test id or analytics hook had nowhere to live. Wrapping the
items in a `<div>` of your own used to break the menu outright:
`assignedElements({ flatten: true })` returned the `<div>`, the `role="menuitem"`
filter yielded zero items, and `show()` focused nothing. The menu now descends
into assigned elements to collect items, in DOM order, so a consumer-owned
container is a **supported pattern** — several containers, and wrapped mixed with
unwrapped, included.

`@civitai/blocks-react/testing` gains **`installPopoverShim`** (plus
`PopoverShimHandle` and `PopoverShimOptions`) for consumers whose *own* code calls
into the popover API. The components do not need it. It is inert in a real
browser, and it deliberately does not paper over the remaining limitation: under
`happy-dom` a click on slotted content never reaches a listener on the `<slot>`
Lit bound `@click` to, so a trigger click is silent. The shim measures that on
install, exposes it as `slottedClicksReachSlots`, and warns — drive overlay
elements with `show()`/`hide()` there.

Both READMEs document the environment, the `show()`-not-click constraint, and the
container pattern; `popover` previously appeared in no README in the repo.

Minor rather than major for `@civitai/components`: nothing a consumer can observe
from outside the shadow root changes. The `.panel` class name, `part="panel"`, and
`:popover-open` matching in a real browser are all unchanged; what changed is
which selector the element's *own* rule keys on, plus strictly looser acceptance
of the markup you may put inside it.
