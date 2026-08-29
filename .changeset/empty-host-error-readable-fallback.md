---
'@civitai/blocks-react': patch
---

Fall back to readable copy when a host reply carries an EMPTY `error` string.

Nine reply-error sites across eight hooks built their exception as
`new Error(result.error ?? '<fallback>')`. `??` replaces only `null`/`undefined`,
so it PRESERVES `''` — a host reply carrying `error: ''` produced an exception
with no message at all, which is the hardest possible failure to debug from a
block. `||` falls through to the fallback copy.

`error: ''` genuinely reaches these hooks: each reply's validator in
`internal/validate.ts` gates `error` on SHAPE only (`typeof p.error !== 'string'`
→ reject), so `''` is a VALID reply, and the hooks' `result.error || !result.result`
guard still enters the error branch via its second disjunct. Verified empirically —
all nine new regression tests fail at base with `expected '' to be '<fallback>'`.

Sites: `useViewer`, `useBuzzBalance`, `useBuzzAccounts`, `useBuzzTransactions`,
`useDailyCompensation`, `useAppWorkflows` (fetch + `cancel`), `useGatedImages`,
`usePublishGenerationOutputs`.

`useWildcardPack` is deliberately EXCLUDED and keeps its `??`:
`isValidWildcardPackResult` constrains `error` to the closed
`WILDCARD_PACK_ERROR_CODES` set, so `error: ''` is rejected upstream and the
fallback is unreachable. A comment now records that so a future sweep does not
"fix" it.

`patch`: no exported type, signature or subpath changes — the only observable
delta is the text of an exception that is empty today, and no caller can
meaningfully branch on `''`.
