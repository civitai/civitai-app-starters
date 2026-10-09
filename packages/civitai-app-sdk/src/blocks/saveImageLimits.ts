/**
 * The ceiling the host enforces on the `bytes` variant of `SAVE_IMAGE` — the
 * host-mediated download of a file the block produced in its own tab.
 *
 * Mirrors the host's constant the same way `appStorageLimits.ts` mirrors the
 * App Storage ceilings: this is the one place in this repository that spells
 * the number. `useSaveImage()` refuses an over-cap buffer before sending it,
 * and the mock host refuses it with the same error string, so a block sees the
 * refusal in tests exactly as in production.
 *
 * ## Provenance
 *
 * The contract for the `bytes` variant (civitai/civitai-app-starters#583) fixes
 * the cap at `50 * 1024 * 1024` bytes, with the over-cap reply
 * `{ ok: false, error: 'file exceeds the maximum save size' }`. The host side
 * is implemented in civitai/civitai against that contract. 🔴 If the host's
 * number moves, this constant must move with it — nothing in this repository
 * can read the host's value, so a drift is invisible here until a block hits
 * the host's refusal on a buffer this SDK let through (or vice versa).
 *
 * The cap is measured in raw BYTES (`ArrayBuffer.byteLength`), not characters:
 * a JSON or text payload is counted after UTF-8 encoding.
 */
export const SAVE_BYTES_MAX_BYTES = 50 * 1024 * 1024;
