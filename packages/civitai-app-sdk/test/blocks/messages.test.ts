import { describe, expect, it } from 'vitest';

import { BLOCK_TO_PARENT_MESSAGE_TYPES, isMessage } from '../../src/blocks/messages.js';
import type {
  BlockInitPayload,
  BlockToParentMessage,
  ConsentUnavailablePayload,
  ParentToBlockMessage,
  SharedStorageValue,
} from '../../src/blocks/messages.js';
import type {
  BlockGenerationSourceImageInfo,
  BlockImagePickerSource,
  BlockImageScanResult,
  BlockMediaKind,
  BlockMediaUploadInfo,
  BlockPendingImageInfo,
  BlockPickedImageInfo,
  BlockUploadedImageInfo,
  PageSlotContext,
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

describe('OPEN_IMAGE_PICKER / IMAGE_PICKER_RESULT message guards', () => {
  const posted: BlockPickedImageInfo = {
    source: 'posted',
    url: 'https://image.civitai.com/x/original=true/posted.jpeg',
    width: 832,
    height: 1216,
    nsfwLevel: 1,
    imageId: 4242,
  };
  // A generator output that was never posted has no Image row, so no imageId.
  const generated: BlockPickedImageInfo = {
    source: 'generated',
    url: 'https://image.civitai.com/x/original=true/generated.jpeg',
    width: 1024,
    height: 768,
    nsfwLevel: 2,
  };
  const request: BlockToParentMessage = {
    type: 'OPEN_IMAGE_PICKER',
    payload: { requestId: 'p-1' },
  };

  it('isMessage accepts OPEN_IMAGE_PICKER + IMAGE_PICKER_RESULT by discriminator', () => {
    const picked: ParentToBlockMessage = {
      type: 'IMAGE_PICKER_RESULT',
      payload: { requestId: 'p-1', selected: posted },
    };
    const dismissed: ParentToBlockMessage = {
      type: 'IMAGE_PICKER_RESULT',
      payload: { requestId: 'p-1' },
    };
    expect(isMessage<BlockToParentMessage, 'OPEN_IMAGE_PICKER'>(request, 'OPEN_IMAGE_PICKER')).toBe(
      true,
    );
    expect(
      isMessage<ParentToBlockMessage, 'IMAGE_PICKER_RESULT'>(picked, 'IMAGE_PICKER_RESULT'),
    ).toBe(true);
    expect(
      isMessage<ParentToBlockMessage, 'IMAGE_PICKER_RESULT'>(dismissed, 'IMAGE_PICKER_RESULT'),
    ).toBe(true);
    // The upload reply is a different message, not an alias of this one.
    expect(
      isMessage<ParentToBlockMessage, 'IMAGE_UPLOAD_RESULT'>(picked, 'IMAGE_UPLOAD_RESULT'),
    ).toBe(false);
  });

  it('the request carries only a requestId by default; sources and multiple are optional', () => {
    expect(request.payload).not.toHaveProperty('sources');
    expect(request.payload).not.toHaveProperty('multiple');

    const sources: BlockImagePickerSource[] = ['generated'];
    const narrowed: BlockToParentMessage = {
      type: 'OPEN_IMAGE_PICKER',
      payload: { requestId: 'p-2', sources, multiple: { max: 5 } },
    };
    if (isMessage<BlockToParentMessage, 'OPEN_IMAGE_PICKER'>(narrowed, 'OPEN_IMAGE_PICKER')) {
      expect(narrowed.payload.sources).toEqual(['generated']);
      expect(narrowed.payload.multiple).toEqual({ max: 5 });
    } else {
      expect.unreachable('narrowed should narrow to OPEN_IMAGE_PICKER');
    }
  });

  it('a posted pick carries a numeric imageId and a generated pick carries none', () => {
    expect(typeof posted.imageId).toBe('number');
    expect(generated).not.toHaveProperty('imageId');
    // Both are a valid generation source image as they stand.
    const asSource: BlockGenerationSourceImageInfo = generated;
    expect(asSource).toMatchObject({ width: 1024, height: 768 });
  });

  it('IMAGE_PICKER_RESULT carries a list for a multi pick and an error for a refusal', () => {
    const many: ParentToBlockMessage = {
      type: 'IMAGE_PICKER_RESULT',
      payload: { requestId: 'p-3', selectedImages: [posted, generated] },
    };
    const refused: ParentToBlockMessage = {
      type: 'IMAGE_PICKER_RESULT',
      payload: { requestId: 'p-4', error: 'unsupported on this host' },
    };
    if (
      isMessage<ParentToBlockMessage, 'IMAGE_PICKER_RESULT'>(many, 'IMAGE_PICKER_RESULT') &&
      isMessage<ParentToBlockMessage, 'IMAGE_PICKER_RESULT'>(refused, 'IMAGE_PICKER_RESULT')
    ) {
      expect(many.payload.selectedImages?.map((image) => image.source)).toEqual([
        'posted',
        'generated',
      ]);
      expect(many.payload.selected).toBeUndefined();
      expect(refused.payload.error).toBe('unsupported on this host');
      expect(refused.payload.selected).toBeUndefined();
    } else {
      expect.unreachable('both should narrow to IMAGE_PICKER_RESULT');
    }
  });
});

describe('OPEN_MEDIA_UPLOAD / MEDIA_UPLOAD_RESULT message guards', () => {
  const video: BlockMediaUploadInfo = {
    url: 'https://media.example/generation-input/clip.mp4',
    kind: 'video',
    mimeType: 'video/mp4',
    sizeBytes: 4_812_330,
    width: 1280,
    height: 720,
    durationMs: 5_000,
  };
  // Audio has no dimensions.
  const audio: BlockMediaUploadInfo = {
    url: 'https://media.example/generation-input/voice.webm',
    kind: 'audio',
    mimeType: 'audio/webm',
    sizeBytes: 96_000,
  };

  it('OPEN_MEDIA_UPLOAD is a declared block-to-parent message type', () => {
    expect(BLOCK_TO_PARENT_MESSAGE_TYPES as readonly string[]).toContain('OPEN_MEDIA_UPLOAD');
  });

  it('a picker request carries kind + purpose and no bytes; a bytes request carries both', () => {
    const kinds: BlockMediaKind[] = ['image', 'video', 'audio'];
    for (const kind of kinds) {
      const picker: BlockToParentMessage = {
        type: 'OPEN_MEDIA_UPLOAD',
        payload: { requestId: `m-${kind}`, kind, purpose: 'generationSource' },
      };
      expect(isMessage<BlockToParentMessage, 'OPEN_MEDIA_UPLOAD'>(picker, 'OPEN_MEDIA_UPLOAD')).toBe(true);
      expect(picker.payload).not.toHaveProperty('bytes');
    }
    const bytes = new ArrayBuffer(4);
    const upload: BlockToParentMessage = {
      type: 'OPEN_MEDIA_UPLOAD',
      payload: { requestId: 'm-b', kind: 'audio', purpose: 'generationSource', bytes, mimeType: 'audio/webm' },
    };
    if (isMessage<BlockToParentMessage, 'OPEN_MEDIA_UPLOAD'>(upload, 'OPEN_MEDIA_UPLOAD')) {
      expect(upload.payload.bytes).toBe(bytes);
      expect(upload.payload.mimeType).toBe('audio/webm');
    } else {
      expect.unreachable('upload should narrow to OPEN_MEDIA_UPLOAD');
    }
  });

  it('MEDIA_UPLOAD_RESULT carries a selected file, an error, or nothing', () => {
    const uploaded: ParentToBlockMessage = {
      type: 'MEDIA_UPLOAD_RESULT',
      payload: { requestId: 'm-1', selected: video },
    };
    const refused: ParentToBlockMessage = {
      type: 'MEDIA_UPLOAD_RESULT',
      payload: { requestId: 'm-2', error: 'busy' },
    };
    const dismissed: ParentToBlockMessage = { type: 'MEDIA_UPLOAD_RESULT', payload: { requestId: 'm-3' } };
    for (const m of [uploaded, refused, dismissed]) {
      expect(isMessage<ParentToBlockMessage, 'MEDIA_UPLOAD_RESULT'>(m, 'MEDIA_UPLOAD_RESULT')).toBe(true);
      // A different message from the image upload reply, not an alias.
      expect(isMessage<ParentToBlockMessage, 'IMAGE_UPLOAD_RESULT'>(m, 'IMAGE_UPLOAD_RESULT')).toBe(false);
    }
    expect(audio).not.toHaveProperty('width');
    expect(audio).not.toHaveProperty('height');
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

describe('THEME_CHANGE (host-pushed live site theme)', () => {
  it('is a parent→block message carrying only the new theme, with NO requestId', () => {
    const msg: ParentToBlockMessage = { type: 'THEME_CHANGE', payload: { theme: 'dark' } };
    expect(isMessage<ParentToBlockMessage, 'THEME_CHANGE'>(msg, 'THEME_CHANGE')).toBe(true);
    if (isMessage<ParentToBlockMessage, 'THEME_CHANGE'>(msg, 'THEME_CHANGE')) {
      expect(msg.payload.theme).toBe('dark');
      // Host-INITIATED, like TOKEN_REFRESH: there is no correlation id, so a
      // block must never try to match it to a pending request.
      expect('requestId' in msg.payload).toBe(false);
    } else {
      expect.unreachable('msg should narrow to THEME_CHANGE');
    }
  });

  it('carries both theme values', () => {
    for (const theme of ['light', 'dark'] as const) {
      const msg: ParentToBlockMessage = { type: 'THEME_CHANGE', payload: { theme } };
      if (!isMessage<ParentToBlockMessage, 'THEME_CHANGE'>(msg, 'THEME_CHANGE')) {
        expect.unreachable('msg should narrow to THEME_CHANGE');
      }
      expect(msg.payload.theme).toBe(theme);
    }
  });

  it('is NOT a block→parent message (it never appears in the outbound union)', () => {
    const msg = { type: 'THEME_CHANGE', payload: { theme: 'light' } };
    // Discriminator-only guard: asking for any BlockToParentMessage type says no.
    expect(isMessage<BlockToParentMessage, 'BLOCK_READY'>(msg, 'BLOCK_READY')).toBe(false);
    expect(isMessage<BlockToParentMessage, 'REQUEST_TOKEN'>(msg, 'REQUEST_TOKEN')).toBe(false);
  });

  it('mirrors the theme union BLOCK_INIT already carries (same values, same field)', () => {
    // The push must be assignable from the SAME `Theme` a BlockInitPayload
    // carries — if the two ever diverge, a host could push a theme a block's
    // init-seeded state can never hold.
    const fromInit: BlockInitPayload['theme'] = 'dark';
    const msg: ParentToBlockMessage = { type: 'THEME_CHANGE', payload: { theme: fromInit } };
    if (!isMessage<ParentToBlockMessage, 'THEME_CHANGE'>(msg, 'THEME_CHANGE')) {
      expect.unreachable('msg should narrow to THEME_CHANGE');
    }
    expect(msg.payload.theme).toBe(fromInit);
  });
});

/**
 * 🔴 [invariant guard — green at base] EVERY CASE IN THIS BLOCK PASSED BEFORE
 * `ROUTE_CHANGED` EXISTED, and that is not a defect in them — it is what a
 * runtime test of a TYPE change can be. Measured: all four were copied onto the
 * pre-change branch and the file ran 28/28 green against an SDK that modelled
 * the message nowhere. Two reasons, both structural: `isMessage` is a
 * DISCRIMINATOR-ONLY guard (it compares `.type` and knows nothing of the union),
 * and `tsconfig.json` EXCLUDES `test/`, so the `: ParentToBlockMessage`
 * annotations here are never compiled.
 *
 * They are kept because they document the RUNTIME contract a consumer relies on
 * — narrowing works, there is no `requestId`, `''` is a value — in the same
 * shape as the sibling `THEME_CHANGE` block. The instrument that actually goes
 * red on the union is `route-changed.test-d.ts`, compiled by `test:types`.
 * Do not read this block as the union's coverage.
 */
describe('ROUTE_CHANGED (host-pushed page sub-path)', () => {
  it('is a parent→block message carrying only the new subPath, with NO requestId', () => {
    const msg: ParentToBlockMessage = { type: 'ROUTE_CHANGED', payload: { subPath: 'compare/42' } };
    expect(isMessage<ParentToBlockMessage, 'ROUTE_CHANGED'>(msg, 'ROUTE_CHANGED')).toBe(true);
    if (isMessage<ParentToBlockMessage, 'ROUTE_CHANGED'>(msg, 'ROUTE_CHANGED')) {
      expect(msg.payload.subPath).toBe('compare/42');
      // Host-INITIATED, like TOKEN_REFRESH / THEME_CHANGE: no correlation id, so
      // a block must never try to match it to a pending request.
      expect('requestId' in msg.payload).toBe(false);
    } else {
      expect.unreachable('msg should narrow to ROUTE_CHANGED');
    }
  });

  it('carries the EMPTY sub-path — the app index is a route, not an absence', () => {
    // 🔴 The one value a "non-empty string" payload rule would have broken, and
    // the one a block reaches by navigating back to its own root. `''` is what
    // `PageBlockHost.buildContext()` sends there, so it must be expressible here.
    const msg: ParentToBlockMessage = { type: 'ROUTE_CHANGED', payload: { subPath: '' } };
    if (!isMessage<ParentToBlockMessage, 'ROUTE_CHANGED'>(msg, 'ROUTE_CHANGED')) {
      expect.unreachable('msg should narrow to ROUTE_CHANGED');
    }
    expect(msg.payload.subPath).toBe('');
  });

  it('is NOT a block→parent message (it never appears in the outbound union)', () => {
    const msg = { type: 'ROUTE_CHANGED', payload: { subPath: 'x' } };
    expect(isMessage<BlockToParentMessage, 'BLOCK_READY'>(msg, 'BLOCK_READY')).toBe(false);
    expect(isMessage<BlockToParentMessage, 'NAVIGATE'>(msg, 'NAVIGATE')).toBe(false);
  });

  it('is assignable from the SAME field `BLOCK_INIT` seeds (one value, two carriers)', () => {
    // The push updates `BLOCK_INIT.context.subPath`. If the two types ever
    // diverge, a host could push a sub-path the init-seeded context cannot hold
    // — which is the divergence `useCivitaiRoute` would then render.
    const pageContext: PageSlotContext = {
      slotId: 'app.page',
      slug: 'seed-explorer',
      subPath: 'compare/42',
      viewerUserId: null,
    };
    const msg: ParentToBlockMessage = {
      type: 'ROUTE_CHANGED',
      payload: { subPath: pageContext.subPath },
    };
    if (!isMessage<ParentToBlockMessage, 'ROUTE_CHANGED'>(msg, 'ROUTE_CHANGED')) {
      expect.unreachable('msg should narrow to ROUTE_CHANGED');
    }
    expect(msg.payload.subPath).toBe('compare/42');
  });
});

describe('CONSENT_UNAVAILABLE (host-pushed un-grantable consent refusal)', () => {
  it('is a parent→block message with { reason, scopes } and NO requestId', () => {
    const msg: ParentToBlockMessage = {
      type: 'CONSENT_UNAVAILABLE',
      payload: { reason: 'ungrantable', scopes: ['ai:write:budgeted'] },
    };
    expect(isMessage<ParentToBlockMessage, 'CONSENT_UNAVAILABLE'>(msg, 'CONSENT_UNAVAILABLE')).toBe(
      true,
    );
    if (isMessage<ParentToBlockMessage, 'CONSENT_UNAVAILABLE'>(msg, 'CONSENT_UNAVAILABLE')) {
      expect(msg.payload.reason).toBe('ungrantable');
      expect(msg.payload.scopes).toEqual(['ai:write:budgeted']);
      // 🔴 An uncorrelated PUSH, not a `*_RESULT` reply. `REQUEST_CONSENT`
      // carries no `requestId`, so there is nothing for a reply to correlate
      // against — shaped like TOKEN_REFRESH / THEME_CHANGE, not like
      // BUZZ_BALANCE_RESULT. A block must never try to match it to a pending
      // request.
      expect('requestId' in msg.payload).toBe(false);
    } else {
      expect.unreachable('msg should narrow to CONSENT_UNAVAILABLE');
    }
  });

  it('🔴 accepts an EMPTY `scopes` array — a refusal naming nothing is a real refusal', () => {
    // The host decides to refuse on its UNFILTERED un-grantable set, then puts
    // only KNOWN block-scope names on the wire. A block that requested scopes
    // outside the vocabulary therefore gets a genuine refusal carrying
    // `scopes: []`. This is the shape a consumer is most likely to mishandle:
    // `if (scopes.length) show(...)` silently drops the very message it
    // subscribed for. Pinned at the TYPE level so `scopes: []` can never be
    // narrowed to a non-empty tuple.
    const msg: ParentToBlockMessage = {
      type: 'CONSENT_UNAVAILABLE',
      payload: { reason: 'ungrantable', scopes: [] },
    };
    if (!isMessage<ParentToBlockMessage, 'CONSENT_UNAVAILABLE'>(msg, 'CONSENT_UNAVAILABLE')) {
      expect.unreachable('msg should narrow to CONSENT_UNAVAILABLE');
    }
    expect(msg.payload.scopes).toEqual([]);
    expect(msg.payload.reason).toBe('ungrantable');
  });

  it('carries the payload type exported for consumers', () => {
    // A block branching on this message needs a NAME for the payload, not an
    // inline structural type — `ConsentUnavailablePayload` is exported from
    // `@civitai/app-sdk/blocks` for exactly that. Assignability in BOTH
    // directions pins that the union member and the exported alias are the same
    // shape, so the export cannot drift into a wider/narrower type.
    const payload: ConsentUnavailablePayload = { reason: 'ungrantable', scopes: [] };
    const msg: ParentToBlockMessage = { type: 'CONSENT_UNAVAILABLE', payload };
    if (!isMessage<ParentToBlockMessage, 'CONSENT_UNAVAILABLE'>(msg, 'CONSENT_UNAVAILABLE')) {
      expect.unreachable('msg should narrow to CONSENT_UNAVAILABLE');
    }
    const roundTrip: ConsentUnavailablePayload = msg.payload;
    expect(roundTrip).toBe(payload);
  });

  it('is NOT a block→parent message (it never appears in the outbound union)', () => {
    const msg = { type: 'CONSENT_UNAVAILABLE', payload: { reason: 'ungrantable', scopes: [] } };
    expect(isMessage<BlockToParentMessage, 'REQUEST_CONSENT'>(msg, 'REQUEST_CONSENT')).toBe(false);
    expect(isMessage<BlockToParentMessage, 'BLOCK_READY'>(msg, 'BLOCK_READY')).toBe(false);
  });
});
