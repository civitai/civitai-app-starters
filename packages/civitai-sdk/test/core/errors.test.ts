import { describe, expect, it } from 'vitest';

import { classifyHostError } from '../../src/core/errors.js';

describe('classifyHostError', () => {
  it('reads a bare tRPC UNAUTHORIZED as unauthenticated', () => {
    expect(classifyHostError('UNAUTHORIZED')).toBe('unauthenticated');
  });

  it('matches UNAUTHORIZED only as the whole message', () => {
    // Anchored: the code embedded in other text is not the bare refusal.
    expect(classifyHostError('upstream said UNAUTHORIZED once')).toBe('unavailable');
    expect(classifyHostError('UNAUTHORIZED_CLIENT')).toBe('unavailable');
    expect(classifyHostError('proxy replied UNAUTHORIZED')).toBe('unavailable');
    // tRPC's code is upper-case; the match is exact.
    expect(classifyHostError('unauthorized')).toBe('unavailable');
  });

  it('reads a session that belongs to another account as forbidden', () => {
    expect(
      classifyHostError(
        'this app session belongs to a different account; reload the page to continue',
      ),
    ).toBe('forbidden');
  });

  it('keeps every mapping it already had', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['storage requires an authenticated viewer', 'unauthenticated'],
      ['no block token', 'unauthenticated'],
      ['sign-in-required', 'unauthenticated'],
      ['block token lacks the required scope', 'forbidden'],
      ['storage set requires the apps:storage:write scope', 'forbidden'],
      ['app block is not approved', 'forbidden'],
      ['block instance revoked', 'forbidden'],
      ['invalid block token', 'forbidden'],
      ['Apps authoring is not enabled for this account', 'forbidden'],
      ['review preview is no longer active for this request', 'forbidden'],
      ['banned', 'forbidden'],
      ['forbidden', 'forbidden'],
      ['review-mode', 'forbidden'],
      ['declined', 'forbidden'],
      ['rate limit exceeded', 'rate-limited'],
      ['busy', 'rate-limited'],
      ['too-large', 'insufficient'],
      ['not-found', 'invalid'],
      ['parse-failed', 'invalid'],
      ['invalid-request', 'invalid'],
      ['collection-unavailable', 'invalid'],
      ['something the host never said before', 'unavailable'],
    ];
    for (const [message, code] of cases) expect(classifyHostError(message), message).toBe(code);
  });
});
