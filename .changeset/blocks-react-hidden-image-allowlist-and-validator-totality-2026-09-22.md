---
'@civitai/blocks-react': minor
---

Make two `src/internal/validate.ts` guards do what their comments claimed (#384, #394).

**`hidden` gated images are now narrowed structurally, not by banning one spelling (#384).**
`isValidGatedImage`'s docblock said a `hidden` entry is "ONLY `imageId` + `status`"; the
code rejected exactly one key, the literal `url`. A host attaching `previewUrl`, `src`,
`imageUrl` or any other field to a WITHHELD image forwarded it straight to
`useGatedImages().getImages()` — measured, not inferred: each of those four spellings
reached the consumer on the previous release.

The fix is PROJECTION, not rejection. `projectInboundPayload` runs on every
`IMAGES_RESULT` at the transport boundary — before `pending.resolve`, so a consumer using
the public `getTransport()` + `sendTypedRequest()` is covered as well as one using the
hook — and narrows each `hidden` entry to exactly `{ imageId, status }`. A `url` on a
`hidden` entry stays fatal, because the contract explicitly forbids that key and its
presence is a live moderation breach worth surfacing loudly.

**Consumer-visible behaviour change, and the reason this is a `minor`:** a block that was
reading an extra field off a `hidden` entry stops seeing it. That is the point of the
change, but it is a change. Nothing in the documented `BlockGatedImage` contract ever
promised those fields, and `visible` entries are untouched (returned by identity).

Rejection was the literal ask in #384; projection was chosen instead because rejection
fails the WHOLE batch — `isValidImagesResult` returns false for one bad entry,
`handleMessage` drops the reply before correlation, and `getImages()` then hangs to its
transport timeout rather than rejecting. The host is a separate repo on a separate release
cadence, so an allowlist-by-rejection would turn any future host-side field addition into a
block-wide hang. Dropping the key gives the same guarantee at no forward-compat cost.

**`payloadValidatorFor` is now exhaustive over `ParentToBlockMessage` at compile time (#394).**
Adding a member to the union without a validator entry previously type-checked, built, and
shipped an unvalidated path that reached `pending.resolve` and push handlers. The
`default:` arm now binds the switch subject to `never`, so the omission fails `tsc`:

```
error TS2322: Type '"SYNTHETIC_MUTANT_RESULT"' is not assignable to type 'never'.
```

The runtime `default:` still returns `null` for a type the union does not declare, which is
now a documented choice rather than an accident: such a type cannot reach `pending.resolve`
or a push listener (both keyed to the union) and matches none of the `isMessage` branches,
so failing closed would protect nothing while making every older block in the fleet warn
and emit a rejection beacon the first time a newer host ships a new message type.
