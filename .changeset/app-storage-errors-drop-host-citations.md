---
"@civitai/app-sdk": patch
"@civitai/blocks-react": patch
---

docs: delete the unverifiable host citations from the App Storage error docblocks

`appStorageErrors.ts`'s header and two of its member docblocks cited the host's
internals twice over: one host error string presented as *the* App Block storage
kill-switch refusal, and a walk-through of the host code that raises it, down to
line numbers in a file in another repository.

Both are **deleted rather than re-pointed**, and the deletion is the fix:

- A line number in another repository's file is a citation nothing here can
  check. There is no test, guard or CI job in this repository that reads the
  host's router, so an unrelated insertion upstream silently invalidates every
  offset — and re-pointing them would only reset the clock on the same defect.
- The string was never load-bearing. `classifyAppStorageError` matches only the
  six messages this module exports — five by containment, the per-value one by
  pattern — so it answers `null` for the cited string exactly as it does for
  every other non-ceiling rejection. The docblocks already labelled it an
  *illustration, not a bound*, and the structural claim it illustrated — every
  rejection outside the classified family arrives on the same `error` field and
  classifies `null` — stands on the bridge's blanket catch arms, not on any
  example.

What is kept: the retraction history of the two enumeration attempts, including
that the second missed four more messages and that one of those fit neither of
its published tables. That is the reason this module carries no list of host
strings, and it needs none of the deleted specifics to make its point. Nothing
replaces the removed illustration — inventing a fresh one would re-create a
citation with the same expiry.

Prose only, in both packages — no runtime behaviour changed and no export moved.
Patch releases because the published artifacts *are* these documents: the
docblocks ship inside `@civitai/app-sdk`'s `.d.ts` (and so reach IDE hover), and
the `@civitai/blocks-react` README ships in its tarball.
