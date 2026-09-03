---
'@civitai/blocks-react': minor
---

Add `ReportButton` to `/ui` — a shared, two-step control that files a shared-board row for platform moderator review via `useSharedStorage().report()`.

Three first-party blocks reached for this control independently (app-requests inline, model-benchmarking as a local component, custom-generators now needing a third), and each time the risk was the same one: wording that lets a viewer believe they deleted something. `report()` files a row and explicitly does **not** hide it — a moderator decides — and an app owner has no server-side hide to offer instead, because `update` and `withdraw` are author-scoped.

So the three visible strings — the confirm question, the failure line and the settled line — are **not props**, and each is pinned whole by a test. Only `noun` varies.

🔴 **What that guarantee is, precisely:** the wording *this component renders* cannot drift across blocks by accident. It does **not** constrain what `onReport` does — a consumer can wire a real delete behind it and the control will still settle to "Reported for review" — and it cannot stop a host page restyling the settled text out of view. "Cannot drift by accident" is the claim; "unforgeable" would be wrong.

Behaviour:

- Nothing is filed from the trigger — only from an armed confirm, and the confirm is inert while a request is in flight, so one row cannot be filed twice (`report()` is not documented idempotent the way `vote`/`unvote` are). Cancel stays live throughout: `onReport` is a postMessage round-trip with no timeout, so disabling it would let a reply that never arrives wedge the control permanently. A settle that lands after Cancel is discarded instead.
- A rejected report keeps the control armed with "Could not send — try again?" rather than settling, and that line carries `role="alert"` — success is announced by a focus move, so without it a rejection is silent to exactly the users the fixed wording protects.
- Focus moves with the control at both transitions. Each step replaces the element the viewer just activated, so otherwise a keyboard user is dropped to `<body>` mid-handshake.
- `reported` lets your app drive the settled state. 🔴 The shared store cannot supply it — `SharedListItem` has `viewerVoted` and no report equivalent — so the only source is your own per-viewer record, written when `onReport` resolves. Without it the settled state is local-only, so any remount resets the control and the same viewer can file again.
- The four secondary test hooks are derived from `data-testid` by suffix, so two rows in one list stay distinguishable once armed or settled.

The caller decides who sees it: render only for a signed-in viewer who does not own the row, since `report` rejects anonymous viewers and an author has a real Remove.

Not covered: there is no way to supply `report()`'s optional `reason` — a block needing one would have to abandon the component, so that is worth deciding before wide adoption.
