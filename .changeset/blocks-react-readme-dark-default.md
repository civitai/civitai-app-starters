---
"@civitai/blocks-react": patch
---

docs: the README said "no attribute = light"; since `@civitai/theme@0.5.0` the default is dark

`packages/civitai-blocks-react/README.md`'s auto-theming bullet told authors that
with no `data-theme` attribute the components render **light**, "matching the
starter palette". `@civitai/theme@0.5.0` flipped the base to **dark** and removed
the OS-preference override, so both halves have been false since that release.

Corrected by reusing the wording the canonical contract already carries
(`@civitai/components`' `MARKUP.md`): default (no attribute) is the dark palette,
and nothing consults the OS preference. No new claim is introduced and no
behaviour changes — but the README *is* a published artifact, so the correction
needs a release to reach the npm page.

🔴 **Why it outlived the flip, which is the part worth carrying:** the sentence
**wraps across two lines**, so a line-based `grep -c 'no attribute = light'`
returns **0** and reads as already-retired. It is visible only over
newline-normalised text. The mirror image hides it on npm: the registry's
`readme` field is truncated at exactly 64 KiB while this README is ~102 KB, so
the claim sits past the cut and the registry reports no occurrences there either.
Each check alone reports "fixed" — the repo one and the published one retire on
different clocks, so a correction here is only confirmed once BOTH the file on
`main` and the newest tarball read zero.
