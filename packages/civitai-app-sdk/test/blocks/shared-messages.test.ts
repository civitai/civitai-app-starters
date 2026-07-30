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
    { type: 'SHARED_UPDATE', payload: { requestId: 'r', key: 'k', value } },
    { type: 'SHARED_GET', payload: { requestId: 'r', key: 'k' } },
    { type: 'SHARED_REPORT', payload: { requestId: 'r', key: 'k', reason: 'spam' } },
    { type: 'SAVE_IMAGE', payload: { requestId: 'r', url: 'https://image.civitai.com/x.jpeg' } },
    { type: 'SAVE_IMAGE', payload: { requestId: 'r', imageId: 55 } },
  ];

  const results: ParentToBlockMessage[] = [
    { type: 'SHARED_LIST_RESULT', payload: { requestId: 'r', items: [item], nextCursor: 'n' } },
    { type: 'SHARED_GET_COUNT_RESULT', payload: { requestId: 'r', count: 3 } },
    { type: 'SHARED_GET_COUNTS_RESULT', payload: { requestId: 'r', counts: { a: 1, b: 0 } } },
    { type: 'SHARED_APPEND_RESULT', payload: { requestId: 'r', key: 'shared_1' } },
    { type: 'SHARED_VOTE_RESULT', payload: { requestId: 'r', count: 4 } },
    { type: 'SHARED_UNVOTE_RESULT', payload: { requestId: 'r', count: 2 } },
    { type: 'SHARED_WITHDRAW_RESULT', payload: { requestId: 'r', ok: true, deleted: true } },
    { type: 'SHARED_UPDATE_RESULT', payload: { requestId: 'r', ok: true } },
    { type: 'SHARED_GET_RESULT', payload: { requestId: 'r', item } },
    { type: 'SHARED_GET_RESULT', payload: { requestId: 'r', item: null } },
    { type: 'SHARED_REPORT_RESULT', payload: { requestId: 'r', ok: true } },
    { type: 'SAVE_IMAGE_RESULT', payload: { requestId: 'r', ok: true } },
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

  it('narrows a SHARED_UPDATE request to key + value, and its result to ok/error', () => {
    const req: BlockToParentMessage = {
      type: 'SHARED_UPDATE',
      payload: { requestId: 'r', key: 'shared_1', value },
    };
    if (isMessage<BlockToParentMessage, 'SHARED_UPDATE'>(req, 'SHARED_UPDATE')) {
      expect(req.payload.key).toBe('shared_1');
      expect(req.payload.value).toEqual(value);
    } else {
      expect.unreachable('should narrow to SHARED_UPDATE');
    }

    const forbidden: ParentToBlockMessage = {
      type: 'SHARED_UPDATE_RESULT',
      payload: { requestId: 'r', ok: false, error: 'FORBIDDEN' },
    };
    if (isMessage<ParentToBlockMessage, 'SHARED_UPDATE_RESULT'>(forbidden, 'SHARED_UPDATE_RESULT')) {
      expect(forbidden.payload.ok).toBe(false);
      expect(forbidden.payload.error).toBe('FORBIDDEN');
    } else {
      expect.unreachable('should narrow to SHARED_UPDATE_RESULT');
    }
  });

  // ── Batch-D additions: SHARED_GET / SHARED_REPORT / SAVE_IMAGE + viewerVoted ──
  it('narrows SHARED_GET request + result (item | null), and SHARED_GET_RESULT carries viewerVoted', () => {
    const req: BlockToParentMessage = { type: 'SHARED_GET', payload: { requestId: 'r', key: 'k' } };
    if (isMessage<BlockToParentMessage, 'SHARED_GET'>(req, 'SHARED_GET')) {
      expect(req.payload.key).toBe('k');
    } else {
      expect.unreachable('should narrow to SHARED_GET');
    }

    const votedItem: SharedStorageItemWire = { ...item, viewerVoted: true };
    const found: ParentToBlockMessage = {
      type: 'SHARED_GET_RESULT',
      payload: { requestId: 'r', item: votedItem },
    };
    if (isMessage<ParentToBlockMessage, 'SHARED_GET_RESULT'>(found, 'SHARED_GET_RESULT')) {
      expect(found.payload.item?.viewerVoted).toBe(true);
      expect(found.payload.item?.key).toBe('shared_1');
    } else {
      expect.unreachable('should narrow to SHARED_GET_RESULT');
    }

    // A missing/hidden row resolves to a null item (not an error).
    const missing: ParentToBlockMessage = {
      type: 'SHARED_GET_RESULT',
      payload: { requestId: 'r', item: null },
    };
    if (isMessage<ParentToBlockMessage, 'SHARED_GET_RESULT'>(missing, 'SHARED_GET_RESULT')) {
      expect(missing.payload.item).toBeNull();
    } else {
      expect.unreachable('should narrow to SHARED_GET_RESULT');
    }
  });

  it('narrows SHARED_REPORT request (key + optional reason) and its ok/error result', () => {
    const req: BlockToParentMessage = {
      type: 'SHARED_REPORT',
      payload: { requestId: 'r', key: 'k', reason: 'spam' },
    };
    if (isMessage<BlockToParentMessage, 'SHARED_REPORT'>(req, 'SHARED_REPORT')) {
      expect(req.payload.key).toBe('k');
      expect(req.payload.reason).toBe('spam');
    } else {
      expect.unreachable('should narrow to SHARED_REPORT');
    }
    const res: ParentToBlockMessage = {
      type: 'SHARED_REPORT_RESULT',
      payload: { requestId: 'r', ok: false, error: 'NOT_FOUND' },
    };
    if (isMessage<ParentToBlockMessage, 'SHARED_REPORT_RESULT'>(res, 'SHARED_REPORT_RESULT')) {
      expect(res.payload.ok).toBe(false);
      expect(res.payload.error).toBe('NOT_FOUND');
    } else {
      expect.unreachable('should narrow to SHARED_REPORT_RESULT');
    }
  });

  it('narrows SAVE_IMAGE request (url XOR imageId) and its ok/error result', () => {
    const urlReq: BlockToParentMessage = {
      type: 'SAVE_IMAGE',
      payload: { requestId: 'r', url: 'https://image.civitai.com/x/original.jpeg', filename: 'a.jpeg' },
    };
    if (isMessage<BlockToParentMessage, 'SAVE_IMAGE'>(urlReq, 'SAVE_IMAGE')) {
      expect(urlReq.payload.url).toContain('image.civitai.com');
      expect(urlReq.payload.filename).toBe('a.jpeg');
    } else {
      expect.unreachable('should narrow to SAVE_IMAGE');
    }
    const idReq: BlockToParentMessage = { type: 'SAVE_IMAGE', payload: { requestId: 'r', imageId: 55 } };
    if (isMessage<BlockToParentMessage, 'SAVE_IMAGE'>(idReq, 'SAVE_IMAGE')) {
      expect(idReq.payload.imageId).toBe(55);
    } else {
      expect.unreachable('should narrow to SAVE_IMAGE');
    }
    const res: ParentToBlockMessage = {
      type: 'SAVE_IMAGE_RESULT',
      payload: { requestId: 'r', ok: true },
    };
    if (isMessage<ParentToBlockMessage, 'SAVE_IMAGE_RESULT'>(res, 'SAVE_IMAGE_RESULT')) {
      expect(res.payload.ok).toBe(true);
    } else {
      expect.unreachable('should narrow to SAVE_IMAGE_RESULT');
    }
  });

  it('a list item exposes an optional viewerVoted (additive, absent-safe)', () => {
    // The wire type keeps viewerVoted OPTIONAL so an old host that omits it still
    // typechecks; a new host sets it per viewer.
    const withFlag: SharedStorageItemWire = { ...item, viewerVoted: false };
    expect(withFlag.viewerVoted).toBe(false);
    const withoutFlag: SharedStorageItemWire = { ...item };
    expect(withoutFlag.viewerVoted).toBeUndefined();
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
