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

Covered by six cases in `test/BlockGate.test.tsx`, each fixture setting the OS
preference to the OPPOSITE of the expected answer so it cannot pass by agreeing
with both rules at once, plus an assertion that the OS is never *asked* (not
merely overruled). All six are red against the pre-change component; two mutants
— inverting the comparison, and letting only an explicit `'dark'` be dark — are
each killed by the cases that own them.

This is the same decision already applied to the scaffolded starters
(civitai-app-starters#509, civitai/cli#766): boot dark, take light only from the
host, never from the OS.
