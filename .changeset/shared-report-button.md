---
'@civitai/blocks-react': minor
---

Add `ReportButton` to `/ui` — a shared, two-step control that files a shared-board row for platform moderator review via `useSharedStorage().report()`.

Three first-party blocks reached for this control independently (app-requests inline, model-benchmarking as a local component, custom-generators now needing a third), and each time the risk was the same one: wording that lets a viewer believe they deleted something. `report()` files a row and explicitly does **not** hide it — a moderator decides — and an app owner has no server-side hide to offer instead, because `update` and `withdraw` are author-scoped.

So the settled copy ("Reported for review") and the confirm copy are **deliberately not props**. Only `noun` varies. Making the strings configurable would hand that risk back to every consumer and defeat the reason this was promoted out of app code.

Behaviour: nothing is filed from the trigger — only from an armed confirm. A rejected report keeps the control armed with "Could not send — try again?" rather than settling, because a failed report that closes quietly reads as a filed one.

The caller decides who sees it: render it only for a signed-in viewer who does not own the row, since `report` rejects for an anonymous viewer and an author has a real Remove.
