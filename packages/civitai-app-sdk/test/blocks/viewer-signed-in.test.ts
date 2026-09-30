/**
 * `isSignedIn` — the one place the BLOCK_INIT sign-in gate is spelled.
 *
 * WHY A TEST AT ALL FOR A ONE-LINE PREDICATE
 * ==========================================
 * The line is trivial; WHICH line it is was the whole decision. Two spellings
 * were live in this repo at different times — `viewer !== null` and
 * `viewer?.signedIn === true` — and they disagree on exactly the inputs below.
 * Those inputs are not hypothetical:
 *
 *   - `{ id, username }` with NO `signedIn` is what every host that predates
 *     civitai/civitai#3707 sends, and `signedIn` is declared OPTIONAL
 *     (`signedIn?: true`) so that stays legal forever.
 *   - `{ id, username, signedIn: false }` is the shape
 *     `@civitai/blocks-react`'s `isValidBlockInitPayload` explicitly refuses to
 *     reject — it names `signedIn: !!user` as the host mistake it will not
 *     brick the fleet over. A payload in that shape reaches a block verbatim.
 *
 * On both, a gate that reads the flag renders the ANONYMOUS branch to a viewer
 * who is signed in. That is the failure these cases pin, in the direction that
 * actually costs a user something.
 *
 * The opposite direction — anonymous reading as signed-in — is pinned too, and
 * is what would make this predicate wrong if the contract ever grew a
 * present-but-anonymous viewer. `viewer: null` is the only anonymous value the
 * wire has today; the trust boundary rejects anything that is neither `null`
 * nor an object with a numeric `id`.
 *
 * The end-to-end half of this — the same divergences driven through the real
 * validator and the real snapshot projection rather than through literals — is
 * in `@civitai/blocks-react`'s `test/blockInitV2.test.ts`, section 4.
 */
import { describe, expect, it } from 'vitest';

import { isSignedIn } from '../../src/blocks/types.js';
import type { ViewerInfo } from '../../src/blocks/types.js';

/** What civitai/civitai `withSignedInFlag()` puts on the wire today. */
const CURRENT_HOST_VIEWER: ViewerInfo = { id: 8888, username: 'alice', signedIn: true };

describe('isSignedIn', () => {
  it('is false for the only anonymous value the wire has', () => {
    expect(isSignedIn(null)).toBe(false);
  });

  it('is false for a viewer that never arrived (pre-BLOCK_INIT / absent key)', () => {
    expect(isSignedIn(undefined)).toBe(false);
  });

  it('is true for the current host viewer', () => {
    expect(isSignedIn(CURRENT_HOST_VIEWER)).toBe(true);
  });

  it('🔴 is true for a host that omits `signedIn` — the field is OPTIONAL', () => {
    // A `viewer?.signedIn === true` gate reads FALSE here and shows the
    // anonymous branch to a signed-in viewer. That divergence is the first of
    // the three reasons this predicate does not read the flag.
    const preSignedInHost = { id: 8888, username: 'alice' } as ViewerInfo;
    expect(preSignedInHost.signedIn === true).toBe(false);
    expect(isSignedIn(preSignedInHost)).toBe(true);
  });

  it('🔴 is true for the `signedIn: !!user` hazard the init validator refuses to reject', () => {
    // `signedIn: false` on a non-null viewer is a contradiction the trust
    // boundary deliberately waves through (rejecting would cost the block its
    // token, context and settings over one advisory flag). So it reaches a
    // block verbatim, and a flag-reading gate is wrong on it.
    const hazard = { id: 8888, username: 'alice', signedIn: false } as unknown as ViewerInfo;
    expect((hazard as { signedIn?: unknown }).signedIn === true).toBe(false);
    expect(isSignedIn(hazard)).toBe(true);
  });

  it('reads neither `id` nor `username` — the two @deprecated fields', () => {
    // The stated reason to prefer `signedIn` was that it outlives `id`/
    // `username`. This is that property, asserted directly rather than assumed:
    // a viewer with both identity fields poisoned still gates correctly, so
    // nothing written through this predicate changes when they are removed.
    const identityRemoved = {
      username: null,
      get id(): number {
        throw new Error('isSignedIn read `id` — it must not');
      },
    } as unknown as ViewerInfo;
    expect(isSignedIn(identityRemoved)).toBe(true);
  });

  it('returns a real boolean, not a truthy object', () => {
    // Callers put this straight into JSX (`{isSignedIn(viewer) ? … : …}`) and
    // into `!`-negations; a non-boolean return would still "work" in those
    // positions and then surprise someone comparing with `===`.
    expect(isSignedIn(CURRENT_HOST_VIEWER)).toStrictEqual(true);
    expect(isSignedIn(null)).toStrictEqual(false);
  });
});
