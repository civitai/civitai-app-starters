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
`data-theme` and has no pre-paint script at all, and it paints the page white
under `@media (prefers-color-scheme: light)` — so a light-OS viewer opening
`<slug>.civit.ai` directly now gets a DARK card on a WHITE page, where before the
two matched. There the page theme *was* the OS preference, so reading the OS was
following the page; this release reads `data-theme`, which those pages never set.

**The fix is in your page's CSS, not in an attribute.** Re-scaffold
(`civitai app init`) — the current `index.html` carries the dark values on the
base rules and applies light only behind `html[data-theme='light']`, so a
fragment-less direct load paints dark and the card matches. Or make that one
change by hand: drop the `@media (prefers-color-scheme: light)` block from your
`index.html`, or gate it on `html[data-theme='light']`.

🔴 **Adding `data-theme` to `<html>` is NOT a fix, in either value**, and it is
the obvious thing to reach for. `data-theme="dark"` moves nothing: the card is
already dark without it, and the white page comes from your own OS-keyed CSS,
which `@civitai/theme` cannot override because it paints no `html`/`body`
background at all — it only defines custom properties. `data-theme="light"` is
worse than nothing: it matches the white page under a light OS and, under a dark
OS, puts a LIGHT card on the `#1a1b1e` page that scaffold paints by default —
re-creating the exact defect this release fixes, permanently, because nothing in
that scaffold ever rewrites `<html>`'s attribute afterwards.

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
