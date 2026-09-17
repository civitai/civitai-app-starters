---
'@civitai/app-sdk': minor
'@civitai/blocks-react': minor
---

`BlockGatedImage`: an image nothing has rated yet is no longer reported as a maturity claim.

`GET_IMAGES_BY_IDS` returned a two-member union, and `hidden` carried six different meanings — including *"the scan has not run yet"*. A block holding `{ status: 'hidden' }` could not tell "a rating exists and it is not for you" from "nothing has been decided", so it guessed, and it guessed maturity: a user generated images in a full-page block, published them into the shared grid, and the grid rendered their own lighthouse as **"Hidden — rated mature"**. A full page reload showed it normally, because by then the scan had finished. Nothing had rated it.

**The type change.** `nsfwLevel` and `contentRating` are now OPTIONAL on a `visible` entry, and a new `ratingPending?: true` marks the case they are absent for. The host returns that shape for the image's OWN AUTHOR only: the url, and no rating claim. 🔴 **A missing `nsfwLevel` is not "rated G".** Branch on `ratingPending` and render a "still processing" affordance; substituting a default rating is the bug this exists to stop. Breaking for any block that dereferenced those fields on a `visible` entry — `minor` because these packages are 0.x.

**`status` is still exactly `'visible' | 'hidden'`, and the host deliberately will not tell you why something is hidden.** The server's per-row verdict does distinguish "unrated" from "above your ceiling", and it consumes that distinction on the author's path alone. Reporting it for someone ELSE's image would turn every remaining `hidden` cell into a positive assertion that a rating exists and is above your ceiling — letting a SFW viewer of a shared grid enumerate which cells are mature-or-flagged rather than merely unscanned. There is no third status and no way to ask.

🔴 **`@civitai/blocks-react`'s transport validator is the load-bearing half of this release, not a follow-on.** `isValidGatedImage` REQUIRED `nsfwLevel` + `contentRating` on every `visible` entry, so the host's new owner projection failed the shape check and `isValidImagesResult` **dropped the whole reply** — every image in the batch, not just the pending one — leaving `getImages()` unresolved until the transport timeout. A block would hang rather than render. That is strictly worse than the bug the host change fixes, so shipping the host change without this one is not an option. Reproduced as a mutation: reverting `validate.ts` alone turns the new mock-host seam test into a 5-second timeout.

The validator now accepts the pending shape and enforces that the two `visible` shapes are MUTUALLY EXCLUSIVE — a `ratingPending` entry that also claims a rating is rejected (a host asserting a rating it just said does not exist), and so is a `visible` entry with neither a rating nor the marker (a host that dropped the field, leaving a block unable to tell "unrated" from "missing"). Presence is tested with `in`, not truthiness, because `nsfwLevel` is a bitmask whose unrated value is `0`; there is a positive control for that.

**`createMockHost`'s default gated projection now emits all three shapes**, including the author's own not-yet-rated entry. The previous default only ever produced rated `visible` cells, which is precisely the fidelity gap that teaches a block author to read `nsfwLevel` unconditionally, test green locally, and break in production. A new test in `mockHost.test.tsx` drives the real hook against the real mock and asserts the reply survives the real validator — a seam neither file's own tests could see, since `mockHost.test.tsx` never drove this bridge and `useGatedImages.test.tsx` only ever fed the validator hand-written fixtures.

Co-requisite of civitai/civitai#4895, which vendors this exact declaration in `src/server/services/blocks/blockGatedImageSdkParity.ts` and fails its typecheck when the two disagree — so this type and that file now have to move together.
