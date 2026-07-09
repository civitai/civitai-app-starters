import { describe, expect, it } from 'vitest';

import { isMessage } from '../../src/blocks/messages.js';
import type {
  BlockToParentMessage,
  ParentToBlockMessage,
  SharedStorageItemWire,
  SharedStorageValue,
} from '../../src/blocks/messages.js';

describe('SHARED_* message discriminators (App Blocks shared storage)', () => {
  const value: SharedStorageValue = { title: 'Add dark mode', body: 'please' };
  const item: SharedStorageItemWire = {
    key: 'shared_1',
    authorUserId: 7,
    value,
    count: 3,
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-02T00:00:00.000Z',
  };

  const requests: BlockToParentMessage[] = [
    { type: 'SHARED_LIST', payload: { requestId: 'r', prefix: 'p', limit: 10, cursor: 'c' } },
    { type: 'SHARED_GET_COUNT', payload: { requestId: 'r', key: 'k' } },
    { type: 'SHARED_GET_COUNTS', payload: { requestId: 'r', keys: ['a', 'b'] } },
    { type: 'SHARED_APPEND', payload: { requestId: 'r', value } },
    { type: 'SHARED_VOTE', payload: { requestId: 'r', key: 'k' } },
    { type: 'SHARED_UNVOTE', payload: { requestId: 'r', key: 'k' } },
    { type: 'SHARED_WITHDRAW', payload: { requestId: 'r', key: 'k' } },
  ];

  const results: ParentToBlockMessage[] = [
    { type: 'SHARED_LIST_RESULT', payload: { requestId: 'r', items: [item], nextCursor: 'n' } },
    { type: 'SHARED_GET_COUNT_RESULT', payload: { requestId: 'r', count: 3 } },
    { type: 'SHARED_GET_COUNTS_RESULT', payload: { requestId: 'r', counts: { a: 1, b: 0 } } },
    { type: 'SHARED_APPEND_RESULT', payload: { requestId: 'r', key: 'shared_1' } },
    { type: 'SHARED_VOTE_RESULT', payload: { requestId: 'r', count: 4 } },
    { type: 'SHARED_UNVOTE_RESULT', payload: { requestId: 'r', count: 2 } },
    { type: 'SHARED_WITHDRAW_RESULT', payload: { requestId: 'r', ok: true, deleted: true } },
  ];

  it('isMessage accepts each SHARED request by discriminator', () => {
    for (const req of requests) {
      expect(isMessage<BlockToParentMessage, typeof req.type>(req, req.type)).toBe(true);
    }
  });

  it('isMessage accepts each SHARED result by discriminator', () => {
    for (const res of results) {
      expect(isMessage<ParentToBlockMessage, typeof res.type>(res, res.type)).toBe(true);
    }
  });

  it('isMessage rejects a mismatched discriminator', () => {
    expect(isMessage<ParentToBlockMessage, 'SHARED_LIST_RESULT'>(requests[0]!, 'SHARED_LIST_RESULT')).toBe(
      false,
    );
    expect(isMessage<BlockToParentMessage, 'SHARED_VOTE'>(results[4]!, 'SHARED_VOTE')).toBe(false);
  });

  it('narrows a SHARED_LIST_RESULT payload to the wire item shape', () => {
    const msg = results[0]!;
    if (isMessage<ParentToBlockMessage, 'SHARED_LIST_RESULT'>(msg, 'SHARED_LIST_RESULT')) {
      expect(msg.payload.items[0]!.value).toEqual(value);
      expect(msg.payload.items[0]!.count).toBe(3);
      expect(msg.payload.items[0]!.authorUserId).toBe(7);
      expect(typeof msg.payload.items[0]!.createdAt).toBe('string');
      expect(msg.payload.nextCursor).toBe('n');
    } else {
      expect.unreachable('should narrow to SHARED_LIST_RESULT');
    }
  });

  it('a WITHDRAW result carries the ok/deleted idempotence fields', () => {
    const gone: ParentToBlockMessage = {
      type: 'SHARED_WITHDRAW_RESULT',
      payload: { requestId: 'r', ok: true, deleted: false },
    };
    if (isMessage<ParentToBlockMessage, 'SHARED_WITHDRAW_RESULT'>(gone, 'SHARED_WITHDRAW_RESULT')) {
      expect(gone.payload.ok).toBe(true);
      expect(gone.payload.deleted).toBe(false);
    } else {
      expect.unreachable('should narrow to SHARED_WITHDRAW_RESULT');
    }
  });
});
