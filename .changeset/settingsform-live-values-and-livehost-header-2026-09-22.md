---
'@civitai/blocks-react': minor
---

`SettingsForm` now tracks its props instead of seeding once on mount, and `liveHost.ts`'s
header enumerations are measured rather than typed (#396, #387).

**MINOR, not patch.** #396 is a bug fix, but it changes two things a consumer can observe
and may have built around, so it is not a silent repair:

- `initialValues` goes from **mount-only to live**. Passing a new object after mount now
  re-seeds every visible field the user has not edited. A host that deliberately mutated
  the prop between renders while relying on the form ignoring it will see different
  values on screen.
- **The submitted key set is now scoped to the current `forScope` slice.** `onSubmit`
  previously received whatever keys were visible at MOUNT; it now receives exactly the
  keys visible NOW. A host reading a key outside the current slice off that payload will
  find it absent.

The defects both came from one cause: `values` was a `useState` lazy initializer (runs
exactly once) while `visibleFields` was a `useMemo` (recomputes). They drifted, two ways:

1. **Async `initialValues` were dropped.** The normal shape is `{}` while a fetch is in
   flight, then the stored row. The form rendered manifest defaults for ever, and Save
   wrote those defaults back **over** the user's stored value.
2. **A `forScope` flip submitted the wrong slice.** Flipping `publisher` → `viewer` on a
   mounted form recomputed `visibleFields` to the viewer slice while `values` still held
   the publisher keys — so the viewer fields rendered blank (the manifest `default` was
   skipped, the seed had already run) and `onSubmit` posted the **publisher slice's keys
   under a viewer-scope save**.

`values` is now derived — a re-seed from `(visibleFields, initialValues)` overlaid with
the user's own edits — so (1) fixes itself and (2) is closed **structurally**: the merge
walks the seed's keys, so a key outside the current slice has no path into the submitted
object at all, whatever is left in edit state.

#387 is documentation and a guard, no runtime change. `liveHost.ts`'s header claimed "the
only network it does is (a) `GET /api/v1/blocks/me` and (b) the four
`blocks.{estimate,submit,poll,cancel}Workflow` tRPC mutations" while the file called 29
tRPC procedures — several of them documented twenty lines further down in the same
header. That claim is replaced by a description of the two real fetch chokepoints plus a
`--- BEGIN DERIVED ---` block that `tests/guards/livehost-header-enumerations.test.mjs`
regenerates from the source and asserts, so the counts cannot go stale again unnoticed.
The refusal bullet list under SCOPE is pinned the same way, by set equality against the
handlers that actually refuse.
