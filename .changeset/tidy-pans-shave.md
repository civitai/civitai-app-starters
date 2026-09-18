---
'@civitai/blocks-react': minor
---

Correct the `@civitai/app-sdk` peer floor: `>=0.29.0` → `>=0.40.0`.

The declared range was satisfied by app-sdk versions that do not export symbols this package imports, so installs warned about nothing and the failure surfaced at module evaluation in consumers — on one, as 27 of 43 test files collecting zero tests while the summary line reported no failures (#309). CI cannot see this: `pnpm.overrides` maps the peer to the workspace copy, so every in-repo typecheck is blind to what the range says.

🔴 The floor is **0.40.0, not the 0.39.0 that issue asked for.** `effectiveBrowsingCeiling` arrives in 0.39.0, but `BlockCreatePostRequest`, `BlockCreatePostResult`, `BlockCreatePostHostError` and `BlockPostSource` arrive in 0.40.0, and there is no 0.39.x between them — measured by installing each published version and typechecking a consumer that imports every symbol this package takes from the peer. A fix landing the issue's own number would have closed it and stayed broken.

Consumers on app-sdk below 0.40.0 will now see the peer mismatch their install should have reported all along — `npm install` fails `ERESOLVE` rather than warning. That is the correct outcome: those consumers are already broken at module evaluation. `^0.51.0` does not reach this version, so nobody is dragged into the break by a patch.

The method for re-deriving the floor is recorded in this package's `comment-peerDependencies`.
