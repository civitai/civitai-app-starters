---
'@civitai/app-sdk': minor
'@civitai/blocks-react': patch
---

`isSignedIn(viewer)` — the sign-in gate, spelled once in the SDK

**New export:** `isSignedIn` from `@civitai/app-sdk/blocks`, alongside
`isModelSlotContext` / `isPageSlotContext`. This is a MINOR (new public value
export), not a patch.

```ts
import { isSignedIn } from '@civitai/app-sdk/blocks';
const { viewer } = useBlockContext();
return <p>{isSignedIn(viewer) ? 'signed in' : 'anonymous'}</p>;
```

**Why a function instead of a documented expression.** The gate was spelled in
six places — `ViewerInfo`'s doc, the `blocks-react` README, the block-starter's
`AGENTS.md`, two reference `App.tsx` files, and a repo guard — and the right
spelling had already changed once (`viewer !== null` → `viewer?.signedIn ===
true`) as `civitai/civitai#3707` landed. Every one of those sites is COPIED by
`tiged` into somebody's app, so each change of mind has to be chased through
every copy ever made. One named predicate makes the next change a version bump
instead of an archaeology exercise.

**What it does, and why.** `isSignedIn` answers from PRESENCE
(`viewer !== null && viewer !== undefined`), not from the `signedIn` flag.
Three measured reasons, all of which point the same way:

1. `signedIn` is `signedIn?: true` — OPTIONAL, and it must stay optional so the
   older payload shapes keep compiling. Against a host that omits it,
   `viewer?.signedIn === true` reads `false` for a viewer who IS signed in.
2. Presence is what the trust boundary actually enforces.
   `isValidBlockInitPayload` pins `viewer` as object-or-null — a compatibility
   floor compiled into every already-deployed block bundle — and in the same
   guard, deliberately, does **not** reject a malformed `signedIn`, because
   failing the whole init over one advisory flag would cost the block its token,
   context and settings. A gate on `signedIn` is a gate on the one viewer
   property nothing validates.
3. That guard names the future host mistake it refuses to brick for:
   `signedIn: !!user`. Under it, a flag-reading gate shows a sign-in CTA to
   someone already signed in; presence still answers correctly.

The stated reason to prefer `signedIn` — that it outlives the `@deprecated`
`id`/`username` — is delivered in full here: `isSignedIn` reads neither field,
so nothing written through it changes when they are removed. That was the real
requirement; reading `signedIn` was the weaker way to meet it. The field stays
on `ViewerInfo` and stays on the wire; it is what this function would switch to
if presence ever stopped meaning sign-in.

**Docs corrected.** `civitai/civitai#3707` merged **2026-08-07**. Seventeen
sites across both packages and two reference starters still asserted it was
"OPEN and unmerged", including four occurrences inside `@civitai/app-sdk`'s
published `dist/blocks/types.d.ts` — i.e. in the editor tooltip an author hovers
while deciding which gate to write. Re-verified against `civitai/civitai` `main`
(via `gh api`, not a local checkout): `src/components/AppBlocks/projectBlockInit.ts`
exports `withSignedInFlag()`, which returns `null` for an anonymous viewer and
`{ id, username, signedIn: true }` otherwise, from BOTH host surfaces
(`IframeHost` and `PageBlockHost`); that repo's contract test pins
`Object.keys(viewer).sort()` as exactly `['id', 'signedIn', 'username']` with
the value literally `true`.

**And the defect that made the whole question live.** All seven starter dev
harnesses hand-build their `BlockInitPayload` (they do not go through
`createMockHost`, so the existing `DEFAULT_VIEWER` fence could not see them) and
every one posted `viewer: { id: 2, username: 'dev-viewer', status: 'active' }`.
That is wrong in both directions at once: it OMITS `signedIn`, which production
always sends, and it ADDS `status`, which the platform deliberately withholds
from third-party iframes (civitai #2521) — so a block reading `status` passes
every local run and gets `undefined` in production. All seven now post
`{ id, username, signedIn }`.

Also corrected: the `useBlockContext` JSDoc example rendered
`viewer?.username ?? 'anon'` — an identity read on a `@deprecated` field
standing in for a presence check.

Two repo guards (not shipped in either package) hold the class rather than this
instance: `tests/guards/civitai-pr-status-claims.test.mjs` fails on any source
comment asserting a `civitai/civitai#NNNN` is open, unmerged or abandoned, and
`tests/guards/starter-signin-gate.test.mjs` pins every starter harness's viewer
key set against `createMockHost`'s `DEFAULT_VIEWER` (a relationship, so neither
side can move alone) and requires every starter that reads `viewer` to gate
through `isSignedIn` rather than open-code it.
