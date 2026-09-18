---
"@civitai/blocks-react": minor
---

Correct the `@civitai/app-sdk` peer floor: `>=0.29.0` → `>=0.40.0`, and add `pnpm check:peer-floor` so the number is derived rather than remembered.

The declared range was satisfied by app-sdk versions that do not export symbols this package imports, so installs warned about nothing and the failure surfaced at module evaluation in consumers — on one, as 27 of 43 test files collecting zero tests while the summary line reported no failures (#309).

🔴 The floor is **0.40.0, not the 0.39.0 that issue asked for.** `effectiveBrowsingCeiling` arrives in 0.39.0, but `BlockCreatePostRequest`, `BlockCreatePostResult`, `BlockCreatePostHostError` and `BlockPostSource` arrive in 0.40.0 — measured by installing each published version and typechecking a consumer that imports every symbol this package takes from the peer (60, across 2 subpaths, at the time of writing). A fix landing the issue's own number would have closed it and stayed broken.

Consumers on app-sdk below 0.40.0 will now see the peer mismatch their install should have reported all along. Move both pins in one commit.
