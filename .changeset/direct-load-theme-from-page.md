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

**The fix is to re-scaffold** (`civitai app init`), and the current
`starters/civitai-block-starter` is the reference for what that buys: the page
owns its own background, dark on the base rule with light only behind
`html[data-theme='light']`, a pre-paint script that sets the attribute from the
host fragment, and `src/App.tsx` keeping `documentElement` in step afterwards.
Those parts are coupled — `tests/guards/boot-skeleton.test.mjs` asserts each of
them — so take the starter as a whole rather than porting a rule or two across.

🔴 **Do NOT hardcode `data-theme` on `<html>` as a shortcut.** On the pre-0.61
scaffold nothing ever rewrites that attribute (its `App.tsx` stamps `data-theme`
on its own wrapper, never on `documentElement`), so a hand-set value is permanent
on **every** surface — the embedded block included, where it is not a cosmetic
choice: measured in a real iframe, `data-theme="dark"` turns a see-through embed
into an unconditional opaque `#121212` panel for every light-OS viewer. It also
only half-works where you wanted it: `@civitai/blocks-react` injects its
stylesheet from an effect, so on that scaffold the page is still the OS-coloured
browser canvas until React mounts — `#ffffff` through first paint under a light
OS, flipping afterwards. That window is exactly what the starter's inline
`<style>` and `bootSkeleton: true` exist to own.

⚠️ **A page that sets `data-theme` to anything other than `light`** — `auto` is
the one we have seen — **gets a dark card, and takes `@civitai/theme`'s light
root tokens**, because its OS-dark fallback is gated on `:root:not([data-theme])`
and any value defeats that. Point it at `dark` or `light`, or let the scaffold's
script own it.

This release changes only the direct-load landing, never the embedded path.

Covered by six cases in `test/BlockGate.test.tsx`, each fixture setting the OS
preference to the OPPOSITE of the expected answer so it cannot pass by agreeing
with both rules at once, plus an assertion that the OS is never *asked* (not
merely overruled). All six are red against the pre-change component; two mutants
— inverting the comparison, and letting only an explicit `'dark'` be dark — are
each killed by the cases that own them.

This is the same decision already applied to the scaffolded starters
(civitai-app-starters#509, civitai/cli#766): boot dark, take light only from the
host, never from the OS.
