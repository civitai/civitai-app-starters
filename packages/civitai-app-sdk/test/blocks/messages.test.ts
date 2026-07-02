import { describe, expect, it } from 'vitest';

import { isMessage } from '../../src/blocks/messages.js';
import type {
  BlockToParentMessage,
  ParentToBlockMessage,
} from '../../src/blocks/messages.js';

describe('GET_BUZZ_BALANCE / BUZZ_BALANCE_RESULT message guards', () => {
  const request: BlockToParentMessage = {
    type: 'GET_BUZZ_BALANCE',
    payload: { requestId: 'r-1' },
  };
  const successResult: ParentToBlockMessage = {
    type: 'BUZZ_BALANCE_RESULT',
    payload: { requestId: 'r-1', balance: { blue: 1, green: 2, yellow: 3 } },
  };
  const errorResult: ParentToBlockMessage = {
    type: 'BUZZ_BALANCE_RESULT',
    payload: { requestId: 'r-1', error: 'RATE_LIMITED' },
  };

  it('isMessage accepts a GET_BUZZ_BALANCE request by discriminator', () => {
    expect(isMessage<BlockToParentMessage, 'GET_BUZZ_BALANCE'>(request, 'GET_BUZZ_BALANCE')).toBe(
      true,
    );
  });

  it('isMessage accepts a BUZZ_BALANCE_RESULT (success + error variants)', () => {
    expect(
      isMessage<ParentToBlockMessage, 'BUZZ_BALANCE_RESULT'>(successResult, 'BUZZ_BALANCE_RESULT'),
    ).toBe(true);
    expect(
      isMessage<ParentToBlockMessage, 'BUZZ_BALANCE_RESULT'>(errorResult, 'BUZZ_BALANCE_RESULT'),
    ).toBe(true);
  });

  it('isMessage rejects a mismatched discriminator', () => {
    expect(
      isMessage<ParentToBlockMessage, 'BUZZ_BALANCE_RESULT'>(request, 'BUZZ_BALANCE_RESULT'),
    ).toBe(false);
    expect(
      isMessage<BlockToParentMessage, 'GET_BUZZ_BALANCE'>(successResult, 'GET_BUZZ_BALANCE'),
    ).toBe(false);
  });

  it('isMessage rejects non-message values', () => {
    expect(isMessage(null, 'GET_BUZZ_BALANCE')).toBe(false);
    expect(isMessage(undefined, 'BUZZ_BALANCE_RESULT')).toBe(false);
    expect(isMessage('GET_BUZZ_BALANCE', 'GET_BUZZ_BALANCE')).toBe(false);
    expect(isMessage({ payload: { requestId: 'r' } }, 'GET_BUZZ_BALANCE')).toBe(false);
  });

  it('narrows the success payload to the { blue, green, yellow } balance shape', () => {
    if (isMessage<ParentToBlockMessage, 'BUZZ_BALANCE_RESULT'>(successResult, 'BUZZ_BALANCE_RESULT')) {
      // Type-narrowed access; runtime-asserts the exact three-pool shape.
      expect(successResult.payload.balance).toEqual({ blue: 1, green: 2, yellow: 3 });
      expect(successResult.payload.error).toBeUndefined();
    } else {
      expect.unreachable('successResult should narrow to BUZZ_BALANCE_RESULT');
    }
  });
});
