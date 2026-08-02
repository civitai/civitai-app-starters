import { describe, expect, it } from 'vitest';

import { isMessage } from '../../src/blocks/messages.js';
import type {
  BlockToParentMessage,
  ParentToBlockMessage,
  SharedStorageValue,
} from '../../src/blocks/messages.js';
import type {
  BlockGenerationSourceImageInfo,
  BlockImageScanResult,
  BlockPendingImageInfo,
  BlockUploadedImageInfo,
  WorkflowBody,
} from '../../src/blocks/types.js';

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
      // display variant of the `selected` union — structurally has `imageId`.
      const info = successResult.payload.selected as BlockUploadedImageInfo | undefined;
      expect(info?.imageId).toBe(12345);
      expect(typeof info?.imageId).toBe('number');
      expect(info?.contentRating).toBe('pg');
    } else {
      expect.unreachable('successResult should narrow to IMAGE_UPLOAD_RESULT');
    }
  });

  it('OPEN_IMAGE_UPLOAD carries an optional purpose (display | generationSource)', () => {
    // type-level: both are assignable to the request payload.
    const display: BlockToParentMessage = {
      type: 'OPEN_IMAGE_UPLOAD',
      payload: { requestId: 'u-2', purpose: 'display' },
    };
    const genSource: BlockToParentMessage = {
      type: 'OPEN_IMAGE_UPLOAD',
      payload: { requestId: 'u-3', purpose: 'generationSource' },
    };
    // absent purpose stays valid (byte-compatible with older hosts).
    expect(request.payload).not.toHaveProperty('purpose');
    if (
      isMessage<BlockToParentMessage, 'OPEN_IMAGE_UPLOAD'>(display, 'OPEN_IMAGE_UPLOAD') &&
      isMessage<BlockToParentMessage, 'OPEN_IMAGE_UPLOAD'>(genSource, 'OPEN_IMAGE_UPLOAD')
    ) {
      expect(display.payload.purpose).toBe('display');
      expect(genSource.payload.purpose).toBe('generationSource');
    } else {
      expect.unreachable('both should narrow to OPEN_IMAGE_UPLOAD');
    }
  });

  it('IMAGE_UPLOAD_RESULT.selected accepts the generationSource { url, width, height } variant', () => {
    const source: BlockGenerationSourceImageInfo = {
      url: 'https://image.civitai.com/x/original=true/source.jpeg',
      width: 768,
      height: 1024,
    };
    const sourceResult: ParentToBlockMessage = {
      type: 'IMAGE_UPLOAD_RESULT',
      payload: { requestId: 'u-3', selected: source },
    };
    if (
      isMessage<ParentToBlockMessage, 'IMAGE_UPLOAD_RESULT'>(sourceResult, 'IMAGE_UPLOAD_RESULT')
    ) {
      const sel = sourceResult.payload.selected;
      expect(sel).toBeDefined();
      // structural narrowing: the source variant has width/height, no imageId.
      expect(sel && 'imageId' in sel).toBe(false);
      expect(sel && 'width' in sel && sel.width).toBe(768);
    } else {
      expect.unreachable('sourceResult should narrow to IMAGE_UPLOAD_RESULT');
    }
  });
});

describe('async-scan display upload: pending handle + IMAGE_SCAN_RESOLVED', () => {
  const moderated: BlockUploadedImageInfo = {
    imageId: 4242,
    nsfwLevel: 1,
    contentRating: 'pg',
    url: 'https://image.civitai.com/x/original=true/clean.jpeg',
  };

  it('OPEN_IMAGE_UPLOAD carries an optional asyncScan flag (opt-in, byte-compat)', () => {
    const async: BlockToParentMessage = {
      type: 'OPEN_IMAGE_UPLOAD',
      payload: { requestId: 'a-1', asyncScan: true },
    };
    // absent asyncScan stays valid (byte-compatible blocking path).
    const blocking: BlockToParentMessage = {
      type: 'OPEN_IMAGE_UPLOAD',
      payload: { requestId: 'a-2' },
    };
    expect(blocking.payload).not.toHaveProperty('asyncScan');
    if (isMessage<BlockToParentMessage, 'OPEN_IMAGE_UPLOAD'>(async, 'OPEN_IMAGE_UPLOAD')) {
      expect(async.payload.asyncScan).toBe(true);
    } else {
      expect.unreachable('async should narrow to OPEN_IMAGE_UPLOAD');
    }
  });

  it('IMAGE_UPLOAD_RESULT.selected accepts the pending handle (status:pending)', () => {
    const pending: BlockPendingImageInfo = { status: 'pending', imageId: 4242, url: moderated.url };
    const result: ParentToBlockMessage = {
      type: 'IMAGE_UPLOAD_RESULT',
      payload: { requestId: 'a-1', selected: pending },
    };
    if (isMessage<ParentToBlockMessage, 'IMAGE_UPLOAD_RESULT'>(result, 'IMAGE_UPLOAD_RESULT')) {
      const sel = result.payload.selected;
      // structural narrowing: the pending variant is the only one with `status`.
      expect(sel && 'status' in sel && sel.status).toBe('pending');
      expect(sel && 'imageId' in sel && sel.imageId).toBe(4242);
    } else {
      expect.unreachable('result should narrow to IMAGE_UPLOAD_RESULT');
    }
  });

  it('IMAGE_SCAN_RESOLVED carries a discriminated verdict correlated by requestId + imageId', () => {
    const scanned: BlockImageScanResult = { status: 'scanned', image: moderated };
    const blocked: BlockImageScanResult = { status: 'blocked', reason: 'over the SFW ceiling' };
    const errored: BlockImageScanResult = { status: 'error', message: 'poll timed out' };

    for (const result of [scanned, blocked, errored]) {
      const msg: ParentToBlockMessage = {
        type: 'IMAGE_SCAN_RESOLVED',
        payload: { requestId: 'a-1', imageId: 4242, result },
      };
      expect(
        isMessage<ParentToBlockMessage, 'IMAGE_SCAN_RESOLVED'>(msg, 'IMAGE_SCAN_RESOLVED'),
      ).toBe(true);
      if (isMessage<ParentToBlockMessage, 'IMAGE_SCAN_RESOLVED'>(msg, 'IMAGE_SCAN_RESOLVED')) {
        expect(msg.payload.requestId).toBe('a-1');
        expect(msg.payload.imageId).toBe(4242);
        expect(msg.payload.result.status).toBe(result.status);
      }
    }
  });

  it('only the scanned verdict carries a usable moderated image', () => {
    const scanned: BlockImageScanResult = { status: 'scanned', image: moderated };
    if (scanned.status === 'scanned') {
      expect(scanned.image.imageId).toBe(4242);
    }
    const blocked: BlockImageScanResult = { status: 'blocked' };
    const errored: BlockImageScanResult = { status: 'error' };
    // type-level: neither blocked nor error exposes an `image` field.
    expect('image' in blocked).toBe(false);
    expect('image' in errored).toBe(false);
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

  it('WorkflowBody carries optional sourceImages[] (multi-image conditioning)', () => {
    // Mirrors civitai's `blockTextToImageBodySchema.sourceImages`:
    // z.array(blockSourceImageSchema).min(1).max(BLOCK_SOURCE_IMAGES_WIRE_MAX).
    // Every element is the SAME `{ url, width, height }` shape as the deprecated
    // singular field — the array form has no reduced per-element contract.
    const body: WorkflowBody = {
      kind: 'textToImage',
      modelId: 1,
      modelVersionId: 2,
      sourceImages: [
        { url: 'https://civitai.com/a.jpeg', width: 1024, height: 1024 },
        { url: 'https://image.civitai.com/b.jpeg', width: 512, height: 768 },
        { url: 'https://civitai.green/c.jpeg', width: 64, height: 2048 },
      ],
      params: { prompt: 'a cat' },
    };
    if (body.kind !== 'textToImage') throw new Error('narrowing failed');
    // ORDER is preserved into the graph's `images` input — assert the whole
    // array, not just [0] (a "first element only" bug reads as passing if you
    // only check the head).
    expect(body.sourceImages).toEqual([
      { url: 'https://civitai.com/a.jpeg', width: 1024, height: 1024 },
      { url: 'https://image.civitai.com/b.jpeg', width: 512, height: 768 },
      { url: 'https://civitai.green/c.jpeg', width: 64, height: 2048 },
    ]);
    // The deprecated singular alias is NOT set when the array form is used —
    // sending both is rejected server-side as ambiguous.
    expect(body.sourceImage).toBeUndefined();

    // A 1-element array is the direct replacement for the singular field.
    const single: WorkflowBody = {
      kind: 'textToImage',
      modelId: 1,
      modelVersionId: 2,
      sourceImages: [{ url: 'https://civitai.com/x.jpeg', width: 1024, height: 1024 }],
      params: { prompt: 'a cat' },
    };
    if (single.kind !== 'textToImage') throw new Error('narrowing failed');
    expect(single.sourceImages).toHaveLength(1);

    // Both fields remain OPTIONAL: a txt2img body omitting both still satisfies
    // WorkflowBody (backward compatible).
    const plain: WorkflowBody = { kind: 'textToImage', modelId: 1, modelVersionId: 2, params: { prompt: 'x' } };
    if (plain.kind !== 'textToImage') throw new Error('narrowing failed');
    expect(plain.sourceImages).toBeUndefined();
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
