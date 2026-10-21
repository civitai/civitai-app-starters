import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockWorkflowSnapshot, WorkflowBody } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { useImageUpload } from '../src/hooks/useImageUpload.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * Pass-through TRAINING coverage for `createMockHost`.
 *
 * The rest of the mock's money path is deliberately kind-agnostic; this part is
 * deliberately NOT. Only a `{ kind: 'step', $type: 'training' | 'imageResourceTraining' }`
 * body produces a checkpoint, so only that body gets `trainedEpochs` (and,
 * when configured, `publishedModel`). The mock also never fabricates a
 * checkpoint url — the block contract does not include one.
 *
 * Coverage note: the `1`/`n`/`publishedModel` cases were watched FAILING
 * against the pre-change mock; the default-omits case was watched failing
 * against this PR's earlier default of `1`; the `trainedEpochs: 0`, sample-image and
 * KIND-FAITHFUL cases pass there too (the old mock emitted neither field for
 * any body) and are INVARIANT guards — the KIND-FAITHFUL set was mutation-
 * checked against a `$type` match widened to any string.
 *
 * Driven through the REAL `useBuzzWorkflow` hook + transport, so every snapshot
 * asserted here has also passed the SDK's inbound validator.
 */

const ORIGIN = window.location.origin;

const TRAINING_BODY: WorkflowBody = {
  kind: 'step',
  $type: 'training',
  input: { engine: 'ai-toolkit' },
  maxBuzz: 250,
};

async function runToTerminal(
  result: { current: ReturnType<typeof useBuzzWorkflow> },
  body: WorkflowBody,
): Promise<BlockWorkflowSnapshot> {
  let snap!: BlockWorkflowSnapshot;
  await act(async () => {
    snap = await result.current.submit(body);
  });
  await act(async () => {
    snap = await result.current.poll(snap.workflowId);
  });
  return snap;
}

describe('createMockHost — pass-through training', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
    vi.restoreAllMocks();
  });

  async function mount(options: Parameters<typeof createMockHost>[0]) {
    const host = createMockHost({ pollsUntilDone: 1, ...options });
    uninstall = host.install();
    const hook = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    return { host, result: hook.result };
  }

  it('by default a training snapshot reports NO trained epochs — the mock does not promise a finished run', async () => {
    const { result } = await mount({});
    const snap = await runToTerminal(result, TRAINING_BODY);

    expect(snap.status).toBe('succeeded');
    expect(snap.publishedModel).toBeUndefined();
    // The full key set: no trainedEpochs, no checkpoint url field, no fabricated stepOutputs.
    expect(Object.keys(snap).sort()).toEqual(
      ['cost', 'imageUrls', 'spentAccountType', 'status', 'workflowId'].sort(),
    );
  });

  it('`trainedEpochs: 1` reports one epoch and nothing else new', async () => {
    const { result } = await mount({ generation: { trainedEpochs: 1 } });
    const snap = await runToTerminal(result, TRAINING_BODY);
    expect(snap.trainedEpochs).toEqual([{ $type: 'training', epochNumber: 1 }]);
    expect(Object.keys(snap).sort()).toEqual(
      ['cost', 'imageUrls', 'spentAccountType', 'status', 'trainedEpochs', 'workflowId'].sort(),
    );
  });

  it('imageUrls carry only the configured SAMPLE images — never a checkpoint url', async () => {
    const samples = ['https://example.test/sample-1.png', 'https://example.test/sample-2.png'];
    const { result } = await mount({ generation: { images: samples } });
    const snap = await runToTerminal(result, TRAINING_BODY);
    expect(snap.imageUrls).toEqual(samples);
  });

  it('`trainedEpochs: n` reports epochs 1…n tagged with the SUBMITTED $type', async () => {
    const { result } = await mount({ generation: { trainedEpochs: 3 } });
    const snap = await runToTerminal(result, { ...TRAINING_BODY, $type: 'imageResourceTraining' });
    expect(snap.trainedEpochs).toEqual([
      { $type: 'imageResourceTraining', epochNumber: 1 },
      { $type: 'imageResourceTraining', epochNumber: 2 },
      { $type: 'imageResourceTraining', epochNumber: 3 },
    ]);
  });

  it('`trainedEpochs: 0` omits the field — a run that produced no checkpoint', async () => {
    const { result } = await mount({ generation: { trainedEpochs: 0 } });
    const snap = await runToTerminal(result, TRAINING_BODY);
    expect(snap.status).toBe('succeeded');
    expect('trainedEpochs' in snap).toBe(false);
  });

  it('`trainingPublishedModel` is reported as publishedModel, and is toggled live by setScenario', async () => {
    const { host, result } = await mount({
      generation: { trainingPublishedModel: { modelId: 71, modelVersionId: 83, published: false } },
    });
    const draft = await runToTerminal(result, TRAINING_BODY);
    expect(draft.publishedModel).toEqual({ modelId: 71, modelVersionId: 83, published: false });

    host.setScenario({
      generation: { trainingPublishedModel: { modelId: 71, modelVersionId: 83, published: true } },
    });
    const done = await runToTerminal(result, TRAINING_BODY);
    expect(done.publishedModel).toEqual({ modelId: 71, modelVersionId: 83, published: true });
  });

  it.each<[string, WorkflowBody]>([
    ['textToImage', { kind: 'textToImage', modelId: 1, modelVersionId: 2, params: { prompt: 'p' } }],
    ['a non-training pass-through $type', { kind: 'step', $type: 'imageBackgroundRemoval', input: {}, maxBuzz: 5 }],
    ['a training $type in the wrong case', { kind: 'step', $type: 'Training', input: {}, maxBuzz: 5 }],
    ['a registered step', { kind: 'step', step: 'convert-image', params: {} }],
    ['customComfy', { kind: 'customComfy', recipe: 'r', params: { prompt: 'p' } }],
  ])('KIND-FAITHFUL: %s gets neither field, whatever the knobs say', async (_, body) => {
    const { result } = await mount({
      generation: {
        trainedEpochs: 2,
        trainingPublishedModel: { modelId: 1, modelVersionId: 2, published: true },
      },
    });
    const snap = await runToTerminal(result, body);
    expect(snap.status).toBe('succeeded');
    expect('trainedEpochs' in snap).toBe(false);
    expect('publishedModel' in snap).toBe(false);
  });
});

/**
 * The `kind: 'training'` UPLOAD knob (`OPEN_IMAGE_UPLOAD { purpose: 'trainingData' }`,
 * civitai/civitai#6461). The end-to-end flow — estimate, the "not uploaded here"
 * refusal, the run — is `trainingKindFlow.test.tsx`; this pins the knob's
 * isolation from the two single-image purposes beside it on the same message.
 */
describe('createMockHost — training-data upload', () => {
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    getTransport({ allowedParentOrigins: [ORIGIN] });
  });
  afterEach(() => {
    cleanup();
    uninstall?.();
    uninstall = undefined;
    resetTransport();
  });

  async function mount(options: Parameters<typeof createMockHost>[0]) {
    const host = createMockHost(options);
    uninstall = host.install();
    const hook = renderHook(() => ({
      training: useImageUpload({ purpose: 'trainingData' }),
      display: useImageUpload(),
      source: useImageUpload({ purpose: 'generationSource' }),
    }));
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    return { host, result: hook.result };
  }

  it('answers each purpose with its own shape — the training knob does not leak into display or source', async () => {
    const images = [{ url: 'https://example.test/v2/consumer/blobs/t1.png', air: 't1.png' }];
    const { result } = await mount({ cannedTrainingDataUpload: images });

    let training: unknown;
    let display: unknown;
    let source: unknown;
    await act(async () => {
      training = await result.current.training.open();
      display = await result.current.display.open();
      source = await result.current.source.open();
    });
    expect(training).toEqual(images);
    expect(display).toMatchObject({ contentRating: 'pg' });
    expect(display).not.toHaveProperty('images');
    expect(source).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    expect(source).not.toHaveProperty('images');
  });

  it('`cannedImageUpload: null` cancels display only; `cannedTrainingDataUpload: []` is a cancel too', async () => {
    const { host, result } = await mount({ cannedImageUpload: null });
    let training: unknown;
    let display: unknown;
    await act(async () => {
      training = await result.current.training.open();
      display = await result.current.display.open();
    });
    expect(display).toBeNull();
    expect(Array.isArray(training)).toBe(true);

    host.setScenario({ cannedTrainingDataUpload: [] });
    await act(async () => {
      training = await result.current.training.open();
    });
    expect(training).toBeNull();
  });
});
