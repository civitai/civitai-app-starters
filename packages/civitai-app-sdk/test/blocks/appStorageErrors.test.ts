import { describe, expect, it } from 'vitest';

import {
  APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED,
  APP_STORAGE_ERROR_APP_ROW_LIMIT,
  APP_STORAGE_ERROR_REQUEST_FAILED,
  APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED,
  APP_STORAGE_ERROR_USER_ROW_LIMIT,
  APP_STORAGE_ERROR_VALUE_TOO_LARGE,
  APP_STORAGE_HOST_ERROR_MESSAGES,
  appStorageValueTooLargeMessage,
  classifyAppStorageError,
  isAppStorageHostErrorMessage,
} from '../../src/blocks/appStorageErrors.js';
import { APP_STORAGE_MAX_VALUE_BYTES } from '../../src/blocks/appStorageLimits.js';

/**
 * The App Storage rejection strings, and the classifier a block branches on.
 *
 * Why this file exists: `createMockHost` emitted `'PAYLOAD_TOO_LARGE'` for
 * three releases. That is the TRPC **code**; the host's bridge forwards the
 * TRPCError's **message**, so the code is a string no block can receive — and
 * a block branching on it took the actionable arm locally and the generic arm
 * in production, with nothing able to tell. civitai/civitai-app-starters#343.
 */
describe('APP_STORAGE host error messages', () => {
  it('the per-value message is DERIVED from the cap, not a hardcoded string', () => {
    // 🔴 THE MECHANICAL CONTROL. The host writes this message as a template
    // literal over `PER_VALUE_BYTE_CAP`, so `'value exceeds 64KB cap'` is true
    // only while the cap is 64KB. Feed the builder a cap the SDK constant
    // CANNOT equal and watch the output move: a literal wearing a function
    // returns the same string for both and dies here.
    const other = APP_STORAGE_MAX_VALUE_BYTES * 2;
    expect(other).not.toBe(APP_STORAGE_MAX_VALUE_BYTES);
    expect(appStorageValueTooLargeMessage(other)).not.toBe(APP_STORAGE_ERROR_VALUE_TOO_LARGE);

    // And it is the HOST's spelling: `${cap / 1024}KB cap`, so 128KB, not
    // 131072 bytes and not "128 KB".
    expect(appStorageValueTooLargeMessage(128 * 1024)).toBe('value exceeds 128KB cap');
    expect(appStorageValueTooLargeMessage(32 * 1024)).toBe('value exceeds 32KB cap');

    // The exported constant IS the builder applied to the SDK's cap.
    expect(APP_STORAGE_ERROR_VALUE_TOO_LARGE).toBe(
      appStorageValueTooLargeMessage(APP_STORAGE_MAX_VALUE_BYTES),
    );
  });

  // 🔴 "the six CEILING strings", NOT "the six a block can receive". The host's
  // bridge catches every `apps.storage.*` rejection with a blanket `catch` and
  // forwards its message on the same field, so every non-ceiling rejection the
  // host raises reaches a block too and all of them classify `null` —
  // `invalid block token`, `block instance revoked` and `Apps are not enabled`
  // are ILLUSTRATIONS of that, not a bound on it (no list in this repository
  // is; see the header of `src/blocks/appStorageErrors.ts`). This array is the
  // `PAYLOAD_TOO_LARGE` family plus the bridge fallback, which IS a closed set
  // because a `code` defines it.
  it('the exported set is the six ceiling strings, all distinct', () => {
    expect([...APP_STORAGE_HOST_ERROR_MESSAGES]).toEqual([
      APP_STORAGE_ERROR_VALUE_TOO_LARGE,
      APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED,
      APP_STORAGE_ERROR_APP_ROW_LIMIT,
      APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED,
      APP_STORAGE_ERROR_USER_ROW_LIMIT,
      APP_STORAGE_ERROR_REQUEST_FAILED,
    ]);
    // Distinctness is load-bearing, not hygiene: a block picks its copy by
    // which string it got, and the mock picks its rejection the same way. Two
    // that collapse to one value make both indistinguishable with no error.
    expect(new Set(APP_STORAGE_HOST_ERROR_MESSAGES).size).toBe(6);

    // 🔴 And none may be a SUBSTRING of another — `classifyAppStorageError`
    // matches by containment and returns on the first hit, so an overlap
    // silently routes one rejection site to another's reason.
    for (const a of APP_STORAGE_HOST_ERROR_MESSAGES) {
      for (const b of APP_STORAGE_HOST_ERROR_MESSAGES) {
        if (a === b) continue;
        expect(a.includes(b), `"${b}" is a substring of "${a}"`).toBe(false);
      }
    }
  });

  it('every message classifies to its OWN reason', () => {
    expect(classifyAppStorageError(APP_STORAGE_ERROR_VALUE_TOO_LARGE)).toBe('value-too-large');
    expect(classifyAppStorageError(APP_STORAGE_ERROR_APP_QUOTA_EXCEEDED)).toBe('app-quota-exceeded');
    expect(classifyAppStorageError(APP_STORAGE_ERROR_APP_ROW_LIMIT)).toBe('app-row-limit');
    expect(classifyAppStorageError(APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED)).toBe(
      'user-quota-exceeded',
    );
    expect(classifyAppStorageError(APP_STORAGE_ERROR_USER_ROW_LIMIT)).toBe('user-row-limit');
    expect(classifyAppStorageError(APP_STORAGE_ERROR_REQUEST_FAILED)).toBe('request-failed');

    // Six inputs, six DISTINCT answers — without this a classifier that
    // returned one reason for everything would satisfy nothing above but could
    // satisfy a weaker set of assertions.
    expect(new Set(APP_STORAGE_HOST_ERROR_MESSAGES.map(classifyAppStorageError)).size).toBe(6);
  });

  it('reads the message off an Error, which is what a block catches', () => {
    // `useAppStorage().set()` rejects with `new Error(result.error)`.
    expect(classifyAppStorageError(new Error(APP_STORAGE_ERROR_USER_ROW_LIMIT))).toBe(
      'user-row-limit',
    );
    // A block that re-wraps the cause still classifies — containment, not
    // equality.
    expect(
      classifyAppStorageError(new Error(`could not save: ${APP_STORAGE_ERROR_USER_QUOTA_EXCEEDED}`)),
    ).toBe('user-quota-exceeded');
    // And a bare `{ message }` object, which is what the host's own bridge
    // inspects.
    expect(classifyAppStorageError({ message: APP_STORAGE_ERROR_APP_ROW_LIMIT })).toBe(
      'app-row-limit',
    );
  });

  it('a host that MOVED its per-value cap still classifies', () => {
    // The SDK carries a snapshot of the cap; the host owns it, and they can
    // disagree across a release. Equality against the compiled constant would
    // stop recognising the rejection the day the host re-measures — which is
    // the whole failure this module exists to end.
    expect(classifyAppStorageError('value exceeds 32KB cap')).toBe('value-too-large');
    expect(classifyAppStorageError('value exceeds 0.5KB cap')).toBe('value-too-large');
  });

  it('NEGATIVE CONTROL — it can say no, including to the code the mock used to send', () => {
    // A classifier that answered a reason for everything would pass every
    // assertion above.
    expect(classifyAppStorageError('PAYLOAD_TOO_LARGE')).toBeNull();
    expect(classifyAppStorageError('STORAGE_UNAVAILABLE')).toBeNull();
    expect(classifyAppStorageError('something else entirely')).toBeNull();
    expect(classifyAppStorageError('')).toBeNull();
    expect(classifyAppStorageError(undefined)).toBeNull();
    expect(classifyAppStorageError(null)).toBeNull();
    expect(classifyAppStorageError(42)).toBeNull();
    // Near-misses of the per-value FAMILY pattern.
    expect(classifyAppStorageError('value exceeds cap')).toBeNull();
    expect(classifyAppStorageError('value exceeds KB cap')).toBeNull();
    expect(classifyAppStorageError('value exceeds 64MB cap')).toBeNull();
  });

  it('a SAMPLE of known non-ceiling host messages classifies null (#366)', () => {
    // 🔴 THIS IS A SAMPLE, NOT A LEDGER — and the distinction is the whole
    // point of #366's third round. The list below is hand-typed and nothing
    // enforces its completeness, so read it as "these known strings classify
    // `null`", never as "these are the strings a block can receive". Two
    // earlier drafts made exactly that completeness claim in prose and both
    // were short; see the header of `src/blocks/appStorageErrors.ts` for what
    // they missed and why no list in this repository is authoritative.
    //
    // 🔴 THE CLAIM THIS PINS is the structural one, which needs no complete
    // list: the classifier owns the PAYLOAD_TOO_LARGE family plus the bridge
    // fallback, and EVERYTHING ELSE the host raises classifies `null`. The
    // host's bridge wraps each `apps.storage.*` call in a blanket `catch` and
    // forwards `err.message` on the same `error` field (IframeHost.tsx :2395,
    // :2427, :2458, :2508, :2535), so all of these arrive at a block
    // identically to a ceiling message. Read from `civitai/civitai` `main`,
    // 2026-09-21.
    //
    // Why assert it at all: `null` is therefore a BUSY bucket whose dominant
    // production occupant is an expired or revoked token, so a `default:` arm
    // must not read "please try again". If someone teaches the classifier any
    // of these strings, this test goes red and the docs saying `null` is not
    // "transient" get revisited with it.
    for (const hostMessage of [
      'invalid block token', // apps.router.ts:289  UNAUTHORIZED
      'block id is not a valid storage slug', // :294  INTERNAL_SERVER_ERROR
      'block instance revoked', // :321  FORBIDDEN
      'storage set requires the apps:storage:write scope', // :344/:422  FORBIDDEN
      'review preview is no longer active for this request', // :372  FORBIDDEN
      'app block not found', // :406  NOT_FOUND
      'app block is not approved', // :410  FORBIDDEN
      'storage requires an authenticated viewer', // :528/:949  UNAUTHORIZED
      // 🔴 The four a previous draft's "measured in the same read" table
      // missed — added here as evidence that the enumeration kept coming up
      // short, not to make the sample complete.
      'Apps are not enabled', // :153/:255/:257  UNAUTHORIZED — the feature-flag
      //                         kill switch, thrown by the enforceAppBlocksFlag
      //                         middleware `.use()`d on all five storage
      //                         procedures (:470, :509, :938, :1022, :1106), so
      //                         it fires before anything else on every call
      'block token subject could not be resolved', // :148, from resolveStorageContext
      'review token subject could not be resolved', // :82
      'Apps authoring is not enabled for this account', // :89
    ]) {
      expect(classifyAppStorageError(hostMessage), hostMessage).toBeNull();
      expect(classifyAppStorageError(new Error(hostMessage)), hostMessage).toBeNull();
      expect(isAppStorageHostErrorMessage(hostMessage), hostMessage).toBe(false);
    }
  });

  it('isAppStorageHostErrorMessage agrees with the classifier and rejects non-strings', () => {
    for (const message of APP_STORAGE_HOST_ERROR_MESSAGES) {
      expect(isAppStorageHostErrorMessage(message)).toBe(true);
    }
    expect(isAppStorageHostErrorMessage('value exceeds 32KB cap')).toBe(true);
    expect(isAppStorageHostErrorMessage('PAYLOAD_TOO_LARGE')).toBe(false);
    expect(isAppStorageHostErrorMessage(undefined)).toBe(false);
    // An `Error` is NOT a message — the predicate is about the wire string.
    expect(isAppStorageHostErrorMessage(new Error(APP_STORAGE_ERROR_USER_ROW_LIMIT))).toBe(false);
  });
});
