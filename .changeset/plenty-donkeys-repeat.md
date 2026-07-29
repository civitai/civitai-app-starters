---
'@civitai/blocks-react': minor
---

Move the `@civitai/app-sdk` peer range to `^0.28.0`, in lockstep with the SDK
minor that adds the optional manifest `tagline`.

No functional change here — this package's code is untouched. The bump exists
because a pre-1.0 caret pins the minor: `^0.27.0` means `>=0.27.0 <0.28.0`, so
leaving it would put the peer out of range the moment `@civitai/app-sdk` goes to
`0.28.0`. Changesets would then bump this package as an out-of-range peer
dependent, which it treats as a breaking change and resolves to a phantom
`1.0.0`. Setting the range to the *actual* resulting SDK release keeps it in
range, so the release stays inside 0.x. Same lockstep the `safe-storage` minor
used.

`minor` rather than `patch` is deliberate: this raises the minimum peer a
consumer must satisfy. As a patch it would reach anyone tracking `^0.36.0`
automatically and conflict with an `@civitai/app-sdk` pinned to `^0.27.0`; as a
minor, existing `^0.36.x` consumers stay put and pick it up when they move the
SDK too.
