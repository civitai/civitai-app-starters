---
"@civitai/blocks-react": minor
---

Add `useDomainMaturity()` and `<SfwGate>` for reading the surrounding
color-domain's maturity ceiling. `useDomainMaturity()` returns
`{ domain, maxBrowsingLevel, isSfw, isLevelAllowed(level) }` from the same init
state as `useBlockContext`, deriving `isSfw` from the `maxBrowsingLevel` bitmask
(host PR #2670) and **failing closed to SFW** before `BLOCK_INIT` / when the host
omits the field. `<SfwGate>` renders its children only when the domain is SFW (or
when a given `level` is allowed), else an optional `fallback`. `createMockHost`
now emits `domain`/`maxBrowsingLevel` on `BLOCK_INIT` (driven by `domain`,
`maxBrowsingLevel`, or a `maturity: 'sfw'|'mature'` convenience) so the hook and
gate are exercisable in tests and the dev harness. Additive only; forward-
compatible (works before #2670 deploys). Requires `@civitai/app-sdk` >=0.13.0
(for `isSfwCeiling`/`isLevelAllowed`/`ColorDomain` and the `browsingLevel`
constants); the peer-dependency constraint is bumped accordingly.
