import { describe, expect, it } from 'vitest';

import {
  isValidOutputUnlockResult,
  payloadValidatorFor,
  projectInboundPayload,
} from '../src/transport/validate.js';

/**
 * `OUTPUT_UNLOCK_RESULT`, the reply to REQUEST_OUTPUT_UNLOCK: an `error` string OR a
 * `result` with a string `outcome`. `result.snapshot` is validated and projected like
 * every other snapshot reply, so a restricted entry carrying a url cannot reach block
 * code through the unlock reply either.
 */

const SNAPSHOT = {
  workflowId: 'wf_u',
  status: 'succeeded',
  outputs: [{ url: 'https://img.test/a.png', nsfwLevel: 'r' }],
};

describe('OUTPUT_UNLOCK_RESULT', () => {
  it('is mapped to its own validator', () => {
    expect(payloadValidatorFor('OUTPUT_UNLOCK_RESULT')).toBe(isValidOutputUnlockResult);
  });

  it('accepts each outcome shape the host sends', () => {
    for (const result of [
      { outcome: 'unlocked', snapshot: SNAPSHOT },
      { outcome: 'refused', snapshot: SNAPSHOT, message: 'app Buzz limit reached' },
      { outcome: 'not-restricted' },
      { outcome: 'linked-out' },
      { outcome: 'dismissed' },
      { outcome: 'unavailable', message: 'above your browsing level' },
      { outcome: 'a-future-outcome' },
    ]) {
      expect(isValidOutputUnlockResult({ requestId: 'r', result }), JSON.stringify(result)).toBe(true);
    }
    expect(isValidOutputUnlockResult({ requestId: 'r', error: 'unsupported on this host' })).toBe(true);
  });

  it('rejects a reply with neither, a non-string outcome, a bad snapshot or message', () => {
    expect(isValidOutputUnlockResult({ requestId: 'r' })).toBe(false);
    expect(isValidOutputUnlockResult({ requestId: 'r', result: { outcome: 1 } })).toBe(false);
    expect(
      isValidOutputUnlockResult({ requestId: 'r', result: { outcome: 'unlocked', snapshot: 'x' } }),
    ).toBe(false);
    expect(
      isValidOutputUnlockResult({ requestId: 'r', result: { outcome: 'unavailable', message: 3 } }),
    ).toBe(false);
    expect(
      isValidOutputUnlockResult({ requestId: 'r', error: 'x', result: { outcome: 'unlocked' } }),
    ).toBe(false);
  });

  it('🔴 projects result.snapshot: a restricted entry carrying a url becomes the placeholder', () => {
    const leaky = {
      requestId: 'r',
      result: {
        outcome: 'not-released',
        snapshot: {
          ...SNAPSHOT,
          outputs: [{ restricted: true, reason: 'ceiling', url: 'https://img.test/leak.png' }],
        },
      },
    };
    const projected = projectInboundPayload('OUTPUT_UNLOCK_RESULT', leaky) as typeof leaky;
    expect(projected.result.snapshot.outputs).toStrictEqual([{ restricted: true, reason: 'ceiling' }]);
    expect(JSON.stringify(projected)).not.toContain('leak.png');
  });

  it('a well-formed reply passes through by identity', () => {
    const ok = { requestId: 'r', result: { outcome: 'unlocked', snapshot: SNAPSHOT } };
    expect(projectInboundPayload('OUTPUT_UNLOCK_RESULT', ok)).toBe(ok);
  });
});
