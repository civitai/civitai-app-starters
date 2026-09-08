---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

Surface the viewer's own browsing level to blocks as `effectiveBrowsingLevel`.

`BLOCK_INIT`'s `maxBrowsingLevel` is a property of the DOMAIN — every viewer on
`civitai.red` receives the same maximally-wide ceiling, including one whose own
NSFW setting is off — so it cannot answer "may I show THIS viewer mature
content". The host now also projects `effectiveBrowsingLevel`: that ceiling
intersected with the viewer's own browsing level.

- `BlockInitPayload.effectiveBrowsingLevel` (optional, additive) + a validator
  shape check that rejects non-finite and NEGATIVE values.
- `effectiveBrowsingCeiling(maxBrowsingLevel, effectiveBrowsingLevel)` exported
  from `@civitai/app-sdk/blocks` — resolves the pair, and can only ever narrow.
- `useDomainMaturity()` now returns `effectiveBrowsingLevel`, and `isSfw` /
  `isLevelAllowed` (and therefore `<SfwGate>`) gate on it. A red-domain viewer
  who turned NSFW off now closes the gate.
- `createMockHost({ viewerBrowsingLevel })` drives the new field, clamped to the
  resolved ceiling exactly as the real host clamps it.

Upgrading is safe: against a host that does not send the field the gates read
exactly what they read before, and against one that does the ceiling is an
intersection — so an existing caller can only ever end up with the same or a
NARROWER permission, never a wider one. The viewer's raw level is deliberately
never sent (on `blue` it is wider than the domain permits).

Requires the platform side to ship first; until it does the field is simply
absent and every consumer falls back to `maxBrowsingLevel`.
