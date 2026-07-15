import { describe, expect, it } from 'vitest';

import { isMessage } from '../../src/blocks/messages.js';
import type {
  BlockToParentMessage,
  ParentToBlockMessage,
  SharedStorageValue,
} from '../../src/blocks/messages.js';
import type { BlockUploadedImageInfo, WorkflowBody } from '../../src/blocks/types.js';

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

describe('OPEN_IMAGE_UPLOAD / IMAGE_UPLOAD_RESULT message guards', () => {
  const request: BlockToParentMessage = {
    type: 'OPEN_IMAGE_UPLOAD',
    payload: { requestId: 'u-1' },
  };
  const moderated: BlockUploadedImageInfo = {
    imageId: 12345,
    nsfwLevel: 1,
    contentRating: 'pg',
    url: 'https://image.civitai.com/x/original=true/a.jpeg',
  };
  const successResult: ParentToBlockMessage = {
    type: 'IMAGE_UPLOAD_RESULT',
    payload: { requestId: 'u-1', selected: moderated },
  };
  const cancelledResult: ParentToBlockMessage = {
    type: 'IMAGE_UPLOAD_RESULT',
    payload: { requestId: 'u-1' },
  };

  it('isMessage accepts OPEN_IMAGE_UPLOAD + IMAGE_UPLOAD_RESULT by discriminator', () => {
    expect(isMessage<BlockToParentMessage, 'OPEN_IMAGE_UPLOAD'>(request, 'OPEN_IMAGE_UPLOAD')).toBe(
      true,
    );
    expect(
      isMessage<ParentToBlockMessage, 'IMAGE_UPLOAD_RESULT'>(successResult, 'IMAGE_UPLOAD_RESULT'),
    ).toBe(true);
    expect(
      isMessage<ParentToBlockMessage, 'IMAGE_UPLOAD_RESULT'>(cancelledResult, 'IMAGE_UPLOAD_RESULT'),
    ).toBe(true);
  });

  it('narrows the success payload to the BlockUploadedImageInfo shape (imageId is a number)', () => {
    if (
      isMessage<ParentToBlockMessage, 'IMAGE_UPLOAD_RESULT'>(successResult, 'IMAGE_UPLOAD_RESULT')
    ) {
      const info: BlockUploadedImageInfo | undefined = successResult.payload.selected;
      expect(info?.imageId).toBe(12345);
      expect(typeof info?.imageId).toBe('number');
      expect(info?.contentRating).toBe('pg');
    } else {
      expect.unreachable('successResult should narrow to IMAGE_UPLOAD_RESULT');
    }
  });
});

describe('WorkflowBody + SharedStorageValue widened fields (type-level)', () => {
  it('WorkflowBody carries optional sourceImage + sharedContentKey (img2img / attribution)', () => {
    const body: WorkflowBody = {
      kind: 'textToImage',
      modelId: 1,
      modelVersionId: 2,
      sourceImage: { url: 'https://civitai.com/x.jpeg', width: 1024, height: 1024 },
      sharedContentKey: 'shared_42',
      params: { prompt: 'a cat' },
    };
    expect(body.sourceImage).toEqual({
      url: 'https://civitai.com/x.jpeg',
      width: 1024,
      height: 1024,
    });
    expect(body.sharedContentKey).toBe('shared_42');
    // txt2img body without the new fields still typechecks (backward compatible).
    const plain: WorkflowBody = { kind: 'textToImage', modelId: 1, modelVersionId: 2, params: { prompt: 'x' } };
    expect(plain.sourceImage).toBeUndefined();
  });

  it('SharedStorageValue carries an optional opaque `data` payload', () => {
    const value: SharedStorageValue = {
      title: 'My generator',
      body: 'notes',
      data: { spec: { steps: 20 }, version: 1 },
    };
    expect(value.data).toEqual({ spec: { steps: 20 }, version: 1 });
    const minimal: SharedStorageValue = { title: 'no data' };
    expect(minimal.data).toBeUndefined();
  });
});
