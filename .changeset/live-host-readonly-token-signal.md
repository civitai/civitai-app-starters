---
'@civitai/blocks-react': patch
---

fix(live host): surface read-only dev tokens instead of silently dead-ending

A dev token minted from an OAuth login carries no `ai:write:budgeted` scope, so
the block's `granted` is false and clicking Generate posts `REQUEST_CONSENT` —
which `createLiveHost` previously swallowed as a silent no-op (live mode can't
grant a scope the token lacks). Result: Generate did nothing, with no network,
no console output, no error.

Now the live host (1) logs a prominent, actionable warning at install when the
token lacks the budgeted scope ("READ-ONLY … re-mint with `civitai login
--token <key>`"), and (2) logs a clear error on `REQUEST_CONSENT` instead of
swallowing it. No protocol/API change — it can't grant the missing scope, but
it no longer fails silently.
