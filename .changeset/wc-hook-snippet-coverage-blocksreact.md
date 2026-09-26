---
'@civitai/blocks-react': patch
---

README: "The hooks" promised *"one minimal snippet each"*. It is not one each —
six of the hooks exported from the package root have no snippet in that section.
The claim is now true, and the gap is named.

Documentation only — no API, type or behaviour change. The README ships inside
the published tarball and reaches the npm package page and IDE hover, so a false
coverage claim there is a defect a consumer reads: it tells a reader that a hook
absent from the section does not exist.

Enumerated, not sampled. The package root (`src/index.ts`) value-exports **36**
identifiers matching `use[A-Z]…`; the section documents **30** of them with a
per-hook heading and a fenced snippet. Of the six remaining:

- `useGatedImages()`, `usePublishGenerationOutputs()`, `useSaveImage()`,
  `useTip()` and `useTipAllowance()` have **no snippet anywhere** in the README.
  `useSaveImage()` was not mentioned in it at all; the tip pair appeared only
  inside the `/ui` `TipButton` row, and the other two only as prose asides in a
  neighbouring hook's section.
- `useDirectLoad()` **does** have a snippet — under "Direct-load fallback",
  not under "The hooks" — so the section is the thing that was incomplete, not
  the documentation.

**No snippets were invented.** Writing five new examples is new content, not a
correction, and each identifier and field in them would need verifying against
the built declarations. Instead the headline claim is now scoped to the hooks
that have a section, the type declarations are named as the authoritative export
surface, and the six are listed with a pointer to where the tip pair's usage
rules already live. The `useDirectLoad()` line is a cross-reference, so that hook
is now reachable from the section a reader searches first.

The count itself is kept out of the prose: a coverage figure in a README is
unguarded by every check in this repo (`pnpm typecheck:readme` typechecks
snippets, not assertions about coverage), so it would rot on the next hook added.
The list of uncovered hooks can go stale too — but it goes stale *visibly*, and
it is greppable, which a number is not.
