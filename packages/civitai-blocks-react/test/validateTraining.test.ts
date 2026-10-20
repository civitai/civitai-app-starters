import { describe, expect, it } from 'vitest';

import {
  isValidImageUploadResult,
  isValidTrainingResult,
  isValidWorkflowSnapshot,
  payloadValidatorFor,
} from '../src/transport/validate.js';

/**
 * Inbound validators for the App Blocks `kind: 'training'` replies —
 * `IMAGE_UPLOAD_RESULT` for a `trainingData` upload, `TRAINING_RESULT`, and
 * `trainingQuote` on a workflow snapshot.
 *
 * The cases reach the two reply validators THROUGH `payloadValidatorFor`, i.e. the
 * lookup the transport itself uses, so a case passes only when the type is
 * mapped AND the mapped guard decides correctly. (At origin/main the lookup
 * returned `null` for both types and every case here threw.)
 *
 * Every REJECT fixture differs from an ACCEPT fixture in ONE field, so a reject
 * cannot pass because something else about it was wrong.
 */

const viaTransport = (type: string) => (payload: unknown) => {
  const v = payloadValidatorFor(type);
  if (v === null) throw new Error(`${type} has no validator`);
  return v(payload);
};
const trainingReply = viaTransport('TRAINING_RESULT');
const uploadReply = viaTransport('IMAGE_UPLOAD_RESULT');

/**
 * `IMAGE_UPLOAD_RESULT` for `OPEN_IMAGE_UPLOAD { purpose: 'trainingData' }`
 * (civitai/civitai#6461): `selected: { images: [{ url, air }] }`, or no
 * `selected` when the viewer cancelled. A guard that dropped this shape would
 * leave `useImageUpload({ purpose: 'trainingData' }).open()` waiting out the
 * ten-minute human bound on an upload the host already finished.
 */
const IMAGE = { url: 'https://example.test/v2/consumer/blobs/k1a2b3.png', air: 'k1a2b3.png' };
const UPLOAD_OK = { requestId: 'r1', selected: { images: [IMAGE] } };

describe('IMAGE_UPLOAD_RESULT — the trainingData multi-image shape', () => {
  it('accepts one image, several images, and a cancel (no selected)', () => {
    expect(uploadReply(UPLOAD_OK)).toBe(true);
    expect(
      uploadReply({
        requestId: 'r1',
        selected: { images: [IMAGE, { url: 'https://example.test/b/2.webp', air: 'k2.webp' }] },
      }),
    ).toBe(true);
    expect(uploadReply({ requestId: 'r1' })).toBe(true);
  });

  it('rejects a malformed images list, one field at a time', () => {
    const bad = (images: unknown) => uploadReply({ requestId: 'r1', selected: { images } });
    expect(bad('k1')).toBe(false);
    expect(bad([null])).toBe(false);
    expect(bad([{ ...IMAGE, url: '' }])).toBe(false);
    expect(bad([{ ...IMAGE, url: 7 }])).toBe(false);
    expect(bad([{ ...IMAGE, air: '' }])).toBe(false);
    expect(bad([{ url: IMAGE.url }])).toBe(false);
    expect(bad([IMAGE, { ...IMAGE, air: 3 }])).toBe(false);
  });

  it('still accepts the single-image shapes beside it (no purpose discriminator on the wire)', () => {
    expect(
      uploadReply({
        requestId: 'r1',
        selected: { imageId: 5, nsfwLevel: 1, contentRating: 'pg', url: IMAGE.url },
      }),
    ).toBe(true);
    expect(uploadReply({ requestId: 'r1', selected: { url: IMAGE.url, width: 8, height: 8 } })).toBe(
      true,
    );
  });
});

const SNAP_OK = { workflowId: 'wf_1', status: 'pending' };

describe('TRAINING_RESULT', () => {
  it('accepts a snapshot reply and an error reply', () => {
    expect(trainingReply({ requestId: 'r1', snapshot: SNAP_OK })).toBe(true);
    expect(trainingReply({ requestId: 'r1', error: 'declined' })).toBe(true);
    expect(trainingReply({ requestId: 'r1', error: 'submission-unconfirmed' })).toBe(true);
    expect(trainingReply({ requestId: 'r1', error: 'training data not uploaded here' })).toBe(true);
    expect(
      trainingReply({
        requestId: 'r1',
        error: 'training quote not found, expired or already used — estimate again',
      }),
    ).toBe(true);
  });

  it('rejects neither, a non-string error, and a snapshot that is not one', () => {
    expect(trainingReply({ requestId: 'r1' })).toBe(false);
    expect(trainingReply({ requestId: 'r1', error: 1 })).toBe(false);
    expect(trainingReply({ requestId: 'r1', snapshot: { ...SNAP_OK, workflowId: '' } })).toBe(
      false,
    );
    expect(trainingReply({ requestId: 'r1', snapshot: { ...SNAP_OK, status: 'running' } })).toBe(
      false,
    );
    expect(trainingReply({ requestId: 'r1', snapshot: 'wf_1' })).toBe(false);
  });
});

const QUOTE_OK = {
  quoteId: `tq_${'0'.repeat(31)}1`,
  total: 1200,
  imageCount: 12,
  expiresAt: '2026-10-06T12:00:00.000Z',
};
const ESTIMATE_OK = {
  workflowId: 'wf_estimate',
  status: 'pending',
  cost: { total: 1200 },
  trainingQuote: QUOTE_OK,
};

describe('trainingQuote on a workflow snapshot', () => {
  it('accepts a training estimate, and a snapshot without the field', () => {
    expect(isValidWorkflowSnapshot(ESTIMATE_OK)).toBe(true);
    expect(isValidWorkflowSnapshot(SNAP_OK)).toBe(true);
  });

  it('does not pin the quoteId format (opaque handle)', () => {
    expect(
      isValidWorkflowSnapshot({ ...ESTIMATE_OK, trainingQuote: { ...QUOTE_OK, quoteId: 'q2' } }),
    ).toBe(true);
  });

  it('rejects a malformed quote, one field at a time', () => {
    const bad = (patch: Record<string, unknown>) =>
      isValidWorkflowSnapshot({ ...ESTIMATE_OK, trainingQuote: { ...QUOTE_OK, ...patch } });
    expect(bad({ quoteId: '' })).toBe(false);
    expect(bad({ quoteId: 7 })).toBe(false);
    expect(bad({ total: '1200' })).toBe(false);
    expect(bad({ total: Number.NaN })).toBe(false);
    expect(bad({ imageCount: -1 })).toBe(false);
    expect(bad({ imageCount: 2.5 })).toBe(false);
    expect(bad({ expiresAt: 0 })).toBe(false);
    expect(isValidWorkflowSnapshot({ ...ESTIMATE_OK, trainingQuote: 'tq' })).toBe(false);
  });

  it('applies through the ESTIMATE_RESULT reply the transport validates', () => {
    const estimateReply = viaTransport('ESTIMATE_RESULT');
    expect(estimateReply({ requestId: 'r1', snapshot: ESTIMATE_OK })).toBe(true);
    expect(
      estimateReply({
        requestId: 'r1',
        snapshot: { ...ESTIMATE_OK, trainingQuote: { ...QUOTE_OK, total: '1200' } },
      }),
    ).toBe(false);
  });
});

describe('payloadValidatorFor — training reply identity', () => {
  it('maps each training reply to ITS validator, not merely to one', () => {
    // 🔴 Identity: TRAINING_RESULT settles a CHARGED run. A reply routed to the
    // wrong guard would resolve `runTraining()` against an unchecked shape.
    expect(payloadValidatorFor('TRAINING_RESULT')).toBe(isValidTrainingResult);
    expect(payloadValidatorFor('IMAGE_UPLOAD_RESULT')).toBe(isValidImageUploadResult);
  });

  it('has no validator for the removed TRAINING_DATASET_RESULT (no longer a protocol type)', () => {
    expect(payloadValidatorFor('TRAINING_DATASET_RESULT')).toBeNull();
  });
});
