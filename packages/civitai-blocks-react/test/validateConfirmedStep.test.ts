import { describe, expect, it } from 'vitest';

import {
  isValidAppWorkflowsResult,
  isValidConfirmedStepResult,
  isValidWorkflowSnapshot,
  payloadValidatorFor,
} from '../src/transport/validate.js';

/**
 * Inbound validators for the confirmed-step reply (`CONFIRMED_STEP_RESULT`),
 * `stepQuote` on a workflow snapshot, and `model3dOutputs` on a snapshot and on
 * an app-queue row.
 *
 * The reply cases reach the validator THROUGH `payloadValidatorFor`, i.e. the
 * lookup the transport itself uses, so a case passes only when the type is
 * mapped AND the mapped guard decides correctly. (Before the mapping existed the
 * lookup returned `null` and every case here threw.)
 *
 * Every REJECT fixture differs from an ACCEPT fixture in ONE field, so a reject
 * cannot pass because something else about it was wrong.
 */

const viaTransport = (type: string) => (payload: unknown) => {
  const v = payloadValidatorFor(type);
  if (v === null) throw new Error(`${type} has no validator`);
  return v(payload);
};
const stepReply = viaTransport('CONFIRMED_STEP_RESULT');

const SNAP_OK = { workflowId: 'wf_1', status: 'pending' };

describe('CONFIRMED_STEP_RESULT', () => {
  it('is mapped to its own guard', () => {
    expect(payloadValidatorFor('CONFIRMED_STEP_RESULT')).toBe(isValidConfirmedStepResult);
  });

  it('accepts a snapshot reply, each host code, and a free-text server message', () => {
    expect(stepReply({ requestId: 'r1', snapshot: SNAP_OK })).toBe(true);
    for (const error of [
      'declined',
      'daily-limit-exceeded',
      'submission-unconfirmed',
      'sign in to run',
      'invalid confirmed step request',
      'step quote not found or expired',
      'confirmed steps from apps are not enabled',
      '',
    ]) {
      expect(stepReply({ requestId: 'r1', error }), error).toBe(true);
    }
  });

  it('accepts the resolved cap-refusal snapshot, with and without an errorCode', () => {
    const refusal = { workflowId: 'failed', status: 'failed', cost: { total: 800 }, error: 'cap' };
    expect(stepReply({ requestId: 'r1', snapshot: refusal })).toBe(true);
    expect(
      stepReply({ requestId: 'r1', snapshot: { ...refusal, errorCode: 'daily-limit-exceeded' } }),
    ).toBe(true);
  });

  it('rejects neither, a non-string error, a bad requestId, and a snapshot that is not one', () => {
    expect(stepReply({ requestId: 'r1' })).toBe(false);
    expect(stepReply({ requestId: 'r1', error: 1 })).toBe(false);
    expect(stepReply({ requestId: 7, snapshot: SNAP_OK })).toBe(false);
    expect(stepReply({ requestId: 'r1', snapshot: { ...SNAP_OK, workflowId: '' } })).toBe(false);
    expect(stepReply({ requestId: 'r1', snapshot: { ...SNAP_OK, status: 'running' } })).toBe(false);
    expect(stepReply({ requestId: 'r1', snapshot: 'wf_1' })).toBe(false);
    expect(stepReply(null)).toBe(false);
  });
});

const QUOTE_OK = {
  quoteId: `sq_${'0'.repeat(31)}1`,
  total: 800,
  stepType: 'polyGen',
  expiresAt: '2026-10-12T12:00:00.000Z',
};
const ESTIMATE_OK = {
  workflowId: 'wf_estimate',
  status: 'pending',
  cost: { total: 800 },
  stepQuote: QUOTE_OK,
};

describe('stepQuote on a workflow snapshot', () => {
  it('accepts a quoted estimate, and a snapshot without the field', () => {
    expect(isValidWorkflowSnapshot(ESTIMATE_OK)).toBe(true);
    expect(isValidWorkflowSnapshot(SNAP_OK)).toBe(true);
  });

  it('does not pin the quoteId format inbound (opaque handle) or an empty stepType', () => {
    expect(isValidWorkflowSnapshot({ ...ESTIMATE_OK, stepQuote: { ...QUOTE_OK, quoteId: 'q2' } })).toBe(
      true,
    );
    expect(isValidWorkflowSnapshot({ ...ESTIMATE_OK, stepQuote: { ...QUOTE_OK, stepType: '' } })).toBe(
      true,
    );
  });

  it('rejects a malformed quote, one field at a time', () => {
    const bad = (patch: Record<string, unknown>) =>
      isValidWorkflowSnapshot({ ...ESTIMATE_OK, stepQuote: { ...QUOTE_OK, ...patch } });
    expect(bad({ quoteId: '' })).toBe(false);
    expect(bad({ quoteId: 7 })).toBe(false);
    expect(bad({ total: '800' })).toBe(false);
    expect(bad({ total: Number.NaN })).toBe(false);
    expect(bad({ total: undefined })).toBe(false);
    expect(bad({ stepType: 3 })).toBe(false);
    expect(bad({ stepType: undefined })).toBe(false);
    expect(bad({ expiresAt: 1760270400000 })).toBe(false);
    expect(bad({ expiresAt: undefined })).toBe(false);
    expect(isValidWorkflowSnapshot({ ...ESTIMATE_OK, stepQuote: 'sq_x' })).toBe(false);
    expect(isValidWorkflowSnapshot({ ...ESTIMATE_OK, stepQuote: null })).toBe(false);
  });
});

const MODEL_OK = { url: 'https://example.test/chair.glb', format: 'glb', variant: 'model' };
const SNAP_3D = {
  workflowId: 'wf_3d',
  status: 'succeeded',
  imageUrls: [MODEL_OK.url],
  model3dOutputs: [MODEL_OK],
};
const ROW_OK = {
  workflowId: 'wf_app_1',
  status: 'succeeded',
  images: [{ url: MODEL_OK.url, width: null, height: null, nsfwLevel: null }],
  cost: 800,
  createdAt: '2026-10-12T10:00:00.000Z',
};
const rows = (row: unknown) =>
  isValidAppWorkflowsResult({ requestId: 'r1', result: { workflows: [row], cursor: null } });

describe('model3dOutputs', () => {
  it('accepts labels on a snapshot, an empty list, and formats/variants the SDK has never seen', () => {
    expect(isValidWorkflowSnapshot(SNAP_3D)).toBe(true);
    expect(isValidWorkflowSnapshot({ ...SNAP_3D, model3dOutputs: [] })).toBe(true);
    expect(
      isValidWorkflowSnapshot({
        ...SNAP_3D,
        model3dOutputs: [
          { ...MODEL_OK, format: 'usdz', variant: 'basicAnimations.walkingModel' },
          // The whole output was the model: an empty variant is legitimate.
          { ...MODEL_OK, variant: '' },
        ],
      }),
    ).toBe(true);
  });

  it('rejects a malformed label on a snapshot, one field at a time', () => {
    const bad = (patch: Record<string, unknown>) =>
      isValidWorkflowSnapshot({ ...SNAP_3D, model3dOutputs: [{ ...MODEL_OK, ...patch }] });
    expect(bad({ url: '' })).toBe(false);
    expect(bad({ url: 7 })).toBe(false);
    expect(bad({ url: undefined })).toBe(false);
    expect(bad({ format: 3 })).toBe(false);
    expect(bad({ format: undefined })).toBe(false);
    expect(bad({ variant: null })).toBe(false);
    expect(bad({ variant: undefined })).toBe(false);
    expect(isValidWorkflowSnapshot({ ...SNAP_3D, model3dOutputs: 'chair.glb' })).toBe(false);
    expect(isValidWorkflowSnapshot({ ...SNAP_3D, model3dOutputs: [null] })).toBe(false);
    expect(isValidWorkflowSnapshot({ ...SNAP_3D, model3dOutputs: [MODEL_OK.url] })).toBe(false);
  });

  it('applies the same rule to an app-queue row', () => {
    expect(rows(ROW_OK)).toBe(true);
    expect(rows({ ...ROW_OK, model3dOutputs: [MODEL_OK] })).toBe(true);
    expect(rows({ ...ROW_OK, model3dOutputs: [{ ...MODEL_OK, url: '' }] })).toBe(false);
    expect(rows({ ...ROW_OK, model3dOutputs: [{ ...MODEL_OK, format: 3 }] })).toBe(false);
    expect(rows({ ...ROW_OK, model3dOutputs: {} })).toBe(false);
  });
});
