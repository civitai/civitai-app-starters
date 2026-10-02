---
"@civitai/blocks-react": patch
---

fix(BlockGate): the direct-load fallback took its theme from the OS, so a dark page got a light card

`DirectLoadFallback` read `prefers-color-scheme` through a local
`usePrefersColorScheme` hook and stamped the result onto its own wrapper's
`data-theme`. That attribute is the thing that decides the card's tokens, so on
a light-OS machine the card painted **light on a deliberately dark page** — it
overrode the page rather than following it.

It now reads the one theme signal that can actually reach a directly-loaded
block: `data-theme` on `<html>`, which the scaffolded `index.html` sets pre-paint
from the host fragment (`#civitai-block=v1&theme=…`). `'light'` is the only value
that buys light — absent, empty, `'auto'`, a typo, or no DOM at all (SSR) are all
dark, exactly the rule the pre-paint script applies.

Three things worth knowing:

1. **Setting the attribute explicitly is load-bearing, so it stays.** The
   obvious simplification — drop `data-theme` and inherit — reintroduces the bug
   by another route: `@civitai/theme` ships
   `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }`, so a
   page carrying no `data-theme` hands its tokens straight back to the OS. An
   explicit attribute on the wrapper is what makes the card deterministic in a
   page that never set one.
2. **The live OS listener is gone, not replaced.** A direct load has no host, so
   there is no `BLOCK_INIT` and no `THEME_CHANGE` — nothing can move the value
   mid-session, and a `matchMedia` subscription only existed to watch the signal
   this fix stops consulting. `readDocumentTheme()` is a plain read.
3. **No API change.** `usePrefersColorScheme` was module-local and never
   exported; `BlockGate`, `DirectLoadFallback` and both their prop types are
   untouched. The embedded happy path never ran this code.

🔴 **One consumer-visible inversion, stated because an upgrading block cannot act
on it otherwise.** On a page whose `<html>` carries no `data-theme` — or carries
any value other than `light` — the card is now dark where it used to follow the
OS. For a block on the CURRENT scaffold that is the intended fix. For a block
still on the PRE-0.61 scaffold it goes the other way: that `index.html` sets no
`data-theme` and has no pre-paint script at all, and that page ends up **white
under a light OS** — so a light-OS viewer opening `<slug>.civit.ai` directly now
gets a DARK card on a WHITE page, where before the two matched. There the page
theme *was* the OS preference, so reading the OS was following the page; this
release reads `data-theme`, which those pages never set.

**Fix it in one line: put `data-theme="dark"` on `<html>`.** Measured in headless
Chromium against that scaffold's own two stylesheets: the page goes from
`#ffffff` to `#121212` and the card is already dark, so the two match — and they
then match under a dark OS too.

Why an attribute moves the page at all, since the mechanism is not obvious and is
the whole reason the one-liner works: on the pre-0.61 scaffold the page colour is
the **browser canvas**, not that `index.html`'s inline `background`. Its
`src/index.css` declares `html, body { background: transparent }`, and Vite emits
that file as a `<link>` *after* the inline `<style>`, so at equal specificity the
transparent rule wins and the inline dark/light backgrounds are dead. The canvas
then follows `color-scheme`, which `@civitai/theme` declares — `:root` light,
`[data-theme='dark']` dark, plus an OS-keyed fallback for a root with no
attribute — and `BlockGate` injects that sheet on both branches. So the attribute
reaches the page through `color-scheme`, and `data-theme="light"` is a valid
choice too: it gives a white page and a light card, matched under either OS.

Re-scaffolding (`civitai app init`) also fixes it, and it is the better end state
— the current starter paints `#1a1b1e` on the base rule, applies light only
behind `html[data-theme='light']`, and has **removed** the `background:
transparent` declaration from `src/index.css`, which is the part that matters.
🔴 **If you hand-port instead, you must change BOTH files.** Editing
`index.html` alone does nothing: measured, dropping the
`@media (prefers-color-scheme: light)` block leaves the page `#ffffff`, and so
does re-gating it on `html[data-theme='light']`, because the transparent rule in
`src/index.css` is still winning.

⚠️ **`data-theme="auto"` is the one value that is now wrong in both directions.**
`auto` is not `light`, so the card is dark; and `@civitai/theme`'s OS-dark
fallback is gated on `:root:not([data-theme])`, so an `auto` root takes the light
tokens unconditionally — measured `#ffffff` under a dark OS as well as a light
one. Change it to `dark` (or `light`); do not leave it on `auto`.

The direct-load landing is the only surface affected, never the embedded path.

Covered by six cases in `test/BlockGate.test.tsx`, each fixture setting the OS
preference to the OPPOSITE of the expected answer so it cannot pass by agreeing
with both rules at once, plus an assertion that the OS is never *asked* (not
merely overruled). All six are red against the pre-change component; two mutants
— inverting the comparison, and letting only an explicit `'dark'` be dark — are
each killed by the cases that own them.

This is the same decision already applied to the scaffolded starters
(civitai-app-starters#509, civitai/cli#766): boot dark, take light only from the
host, never from the OS.
