---
"@civitai/components": patch
"@civitai/components-react": patch
---

Patch release (0.2.1) — implement the documented component defaults in the base CSS.

`MARKUP.md` documents a default `data-variant` / `data-size` / `data-color` for several components, but `@civitai/components` gated **all** of that styling on an **explicit** attribute — so a bare element (including MARKUP's own minimal examples) rendered unstyled or zero-size. This was a doc-vs-code mismatch: the docs were correct; the CSS did not match them.

The documented defaults now live on the unconditional **base** rule, so bare markup (`<span data-civitai-ui="badge">`, `<button data-civitai-ui="button">`, a bare alert / loader) renders the documented default; the explicit `data-variant` / `data-size` / `data-color` rules still **override**.

**Components that had the gap (now fixed):**

- **Badge** — no default variant (`filled`) or size (`md`): a bare badge had no padding and no fill. Now renders filled + md.
- **Button** — no default size (`md`): a bare button had no height/padding. The base filled default is also completed (`border-color` + hover).
- **Alert** — no default color (`info`): a bare alert rendered neutral chrome instead of the documented info intent (tinted bg + border). Now renders the info intent.
- **Loader** — no default size (`md`): a bare loader was `0×0` (invisible). Now renders the 22px md spinner.

Badge's `light` variant now resets `border-color: transparent` explicitly (it previously relied on the base transparent border, which the fix changes to primary) — light badges are visually unchanged. **No documented default was changed** — the CSS was made to match the docs, not vice versa.

The `@civitai/components-react` bindings are behaviorally unchanged (they already emit explicit attributes; the CSS defaults benefit hand-written HTML consumers) and get the patch as the lockstep React binding of `@civitai/components`.
