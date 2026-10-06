import { describe, expect, it } from 'vitest';

import {
  isValidTrainingDatasetResult,
  isValidTrainingResult,
  isValidWorkflowSnapshot,
  payloadValidatorFor,
} from '../src/transport/validate.js';

/**
 * Inbound validators for the App Blocks `kind: 'training'` replies —
 * `TRAINING_DATASET_RESULT`, `TRAINING_RESULT`, and `trainingQuote` on a workflow
 * snapshot.
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
const datasetReply = viaTransport('TRAINING_DATASET_RESULT');
const trainingReply = viaTransport('TRAINING_RESULT');

const DATASET_OK = {
  requestId: 'r1',
  result: {
    datasetId: `tds_${'0'.repeat(31)}1`,
    count: 2,
    rejected: [{ imageId: 9, reason: 'pending-scan' }],
  },
};

describe('TRAINING_DATASET_RESULT', () => {
  it('accepts a result, an empty rejected list, and a zero count', () => {
    expect(datasetReply(DATASET_OK)).toBe(true);
    expect(datasetReply({ ...DATASET_OK, result: { ...DATASET_OK.result, rejected: [] } })).toBe(
      true,
    );
    expect(datasetReply({ ...DATASET_OK, result: { ...DATASET_OK.result, count: 0 } })).toBe(true);
  });

  it('accepts a rejection reason the SDK does not list (forward-compatible)', () => {
    const r = { ...DATASET_OK.result, rejected: [{ imageId: 9, reason: 'some-future-reason' }] };
    expect(datasetReply({ ...DATASET_OK, result: r })).toBe(true);
  });

  it('accepts a host code AND a free-text server message on `error` (shape-only)', () => {
    expect(datasetReply({ requestId: 'r1', error: 'invalid training dataset' })).toBe(true);
    expect(datasetReply({ requestId: 'r1', error: 'training from apps is not enabled' })).toBe(true);
    expect(datasetReply({ requestId: 'r1', error: '' })).toBe(true);
  });

  it('rejects a reply with neither result nor error, or a non-string error', () => {
    expect(datasetReply({ requestId: 'r1' })).toBe(false);
    expect(datasetReply({ requestId: 'r1', error: 500 })).toBe(false);
    expect(datasetReply({ ...DATASET_OK, requestId: 7 })).toBe(false);
  });

  it('rejects a malformed result, one field at a time', () => {
    const bad = (patch: Record<string, unknown>) =>
      datasetReply({ ...DATASET_OK, result: { ...DATASET_OK.result, ...patch } });
    expect(bad({ datasetId: '' })).toBe(false);
    expect(bad({ datasetId: 42 })).toBe(false);
    expect(bad({ count: -1 })).toBe(false);
    expect(bad({ count: 1.5 })).toBe(false);
    expect(bad({ count: '2' })).toBe(false);
    expect(bad({ rejected: 'none' })).toBe(false);
    expect(bad({ rejected: [{ imageId: '9', reason: 'pending-scan' }] })).toBe(false);
    expect(bad({ rejected: [{ imageId: 9, reason: 3 }] })).toBe(false);
    expect(bad({ rejected: [null] })).toBe(false);
    expect(datasetReply({ requestId: 'r1', result: 'nope' })).toBe(false);
  });
});

const SNAP_OK = { workflowId: 'wf_1', status: 'pending' };

describe('TRAINING_RESULT', () => {
  it('accepts a snapshot reply and an error reply', () => {
    expect(trainingReply({ requestId: 'r1', snapshot: SNAP_OK })).toBe(true);
    expect(trainingReply({ requestId: 'r1', error: 'declined' })).toBe(true);
    expect(trainingReply({ requestId: 'r1', error: 'submission-unconfirmed' })).toBe(true);
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
    expect(payloadValidatorFor('TRAINING_DATASET_RESULT')).toBe(isValidTrainingDatasetResult);
  });
});
