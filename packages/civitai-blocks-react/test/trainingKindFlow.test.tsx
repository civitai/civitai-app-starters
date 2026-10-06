import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLOCK_TRAINING_CAPTION_MAX_CHARS,
  BLOCK_TRAINING_DATASET_MAX_ITEMS,
  BLOCK_TRAINING_MAX_BUZZ_PER_RUN,
  type BlockWorkflowSnapshot,
  type WorkflowBody,
  type WorkflowBodyTraining,
} from '@civitai/app-sdk/blocks';

import {
  TRAINING_BODY_SUBMIT_REFUSAL,
  useBuzzWorkflow,
  WorkflowEstimateError,
} from '../src/hooks/useBuzzWorkflow.js';
import {
  PrepareTrainingDatasetError,
  usePrepareTrainingDataset,
} from '../src/hooks/usePrepareTrainingDataset.js';
import { RunTrainingError, useRunTraining } from '../src/hooks/useRunTraining.js';
import {
  MOCK_TRAINING_DATASET_GONE_ERROR,
  MOCK_TRAINING_NONE_ELIGIBLE_ERROR,
  MOCK_TRAINING_NONE_IMPORTED_ERROR,
  MOCK_TRAINING_QUOTE_GONE_ERROR,
  MOCK_TRAINING_BOUNDS,
  MOCK_TRAINING_SCOPE_ERROR,
  type MockHostOptions,
} from '../src/internal/mockHost.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The App Blocks `kind: 'training'` flow — prepare → estimate → run → watch —
 * driven through the REAL hooks and the REAL iframe transport (so every reply
 * asserted here also passed the inbound validators) against `createMockHost`.
 *
 * 🔴 WHAT THIS CANNOT PROVE: the consent dialog is HOST chrome and the mock has
 * none — it settles `RUN_TRAINING` immediately where the real host waits on a
 * click and shows server-read numbers. `declined` is an outcome here, never a
 * wait. Image ownership, moderation, the flag and the page-only / dev-token
 * refusals are server-side and not modelled.
 */

const ORIGIN = window.location.origin;

const PARAMS: WorkflowBodyTraining['params'] = {
  engine: 'ai-toolkit',
  ecosystem: 'sdxl',
  resolution: 1024,
  lr: 0.0001,
  textEncoderLr: null,
  trainTextEncoder: false,
  lrScheduler: 'cosine',
  optimizerType: 'adamw8bit',
  networkDim: 32,
  networkAlpha: 16,
  noiseOffset: null,
  minSnrGamma: null,
  flipAugmentation: false,
  shuffleTokens: false,
  keepTokens: 0,
};

const bodyFor = (datasetId: string): WorkflowBodyTraining => ({
  kind: 'training',
  datasetId,
  engine: 'ai-toolkit',
  model: 'sdxl',
  params: PARAMS,
  triggerWord: 'tok',
  samplePrompts: ['a photo of tok'],
});

const ITEMS = [
  { imageId: 11, caption: 'one' },
  { imageId: 12, caption: 'two' },
  { imageId: 13, caption: 'three' },
];

type Outbound = { type: string; payload?: unknown };

function install(opts: MockHostOptions = {}) {
  const outbound: Outbound[] = [];
  const host = createMockHost({
    consentGranted: true,
    ...opts,
    onOutbound: (m) => outbound.push(m),
  });
  const uninstall = host.install();
  return { host, uninstall, outbound };
}

function hooks() {
  return renderHook(() => ({
    prep: usePrepareTrainingDataset(),
    wf: useBuzzWorkflow(),
    run: useRunTraining(),
  }));
}

type Hooks = ReturnType<typeof hooks>['result'];

async function settle<T>(p: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  let out: { value?: T; error?: unknown } = {};
  await act(async () => {
    try {
      out = { value: await p() };
    } catch (error) {
      out = { error };
    }
  });
  return out;
}

/** prepare → estimate, returning the dataset, the estimate and the body to run. */
async function prepareAndQuote(result: Hooks) {
  const prepared = await settle(() => result.current.prep.prepareDataset(ITEMS));
  expect(prepared.error).toBeUndefined();
  const body = bodyFor(prepared.value!.datasetId);
  const estimated = await settle(() => result.current.wf.estimate(body));
  expect(estimated.error).toBeUndefined();
  return { dataset: prepared.value!, estimate: estimated.value!, body };
}

describe('mock training bounds', () => {
  it('are the SDK constants (the mock copies them to keep the peer floor down)', () => {
    expect(MOCK_TRAINING_BOUNDS).toEqual({
      datasetMaxItems: BLOCK_TRAINING_DATASET_MAX_ITEMS,
      captionMaxChars: BLOCK_TRAINING_CAPTION_MAX_CHARS,
      maxBuzzPerRun: BLOCK_TRAINING_MAX_BUZZ_PER_RUN,
    });
  });
});

describe('kind:training — prepare → estimate → run → watch', () => {
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

  it('runs end to end: dataset handle, a stored quote, a run, and trained epochs on watch', async () => {
    const m = install({
      trainingQuoteTotal: 1234,
      trainingDatasetRejected: [
        { imageId: 12, reason: 'pending-scan' },
        // Not in the request — the server reports only images it was asked about.
        { imageId: 99, reason: 'unavailable' },
      ],
      generation: { trainedEpochs: 2 },
      pollsUntilDone: 1,
    });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const { dataset, estimate, body } = await prepareAndQuote(result);
    expect(dataset.datasetId).toMatch(/^tds_[0-9a-f]{32}$/);
    expect(dataset.count).toBe(2);
    expect(dataset.rejected).toEqual([{ imageId: 12, reason: 'pending-scan' }]);

    expect(estimate.cost?.total).toBe(1234);
    expect(estimate.trainingQuote).toMatchObject({ total: 1234, imageCount: 2 });
    expect(estimate.trainingQuote!.quoteId).toMatch(/^tq_[0-9a-f]{32}$/);
    expect(Date.parse(estimate.trainingQuote!.expiresAt)).toBeGreaterThan(Date.now());

    const started = await settle(() =>
      result.current.run.runTraining({ ...body, quoteId: estimate.trainingQuote!.quoteId }),
    );
    expect(started.error).toBeUndefined();
    expect(started.value!.status).toBe('pending');

    // The wire: the body went out on RUN_TRAINING verbatim, quoteId included.
    const runMsg = m.outbound.find((o) => o.type === 'RUN_TRAINING');
    expect((runMsg!.payload as { body: unknown }).body).toEqual({
      ...body,
      quoteId: estimate.trainingQuote!.quoteId,
    });

    const done = await settle(() => result.current.wf.watch(started.value!.workflowId));
    const snap = done.value as BlockWorkflowSnapshot;
    expect(snap.status).toBe('succeeded');
    expect(snap.cost?.total).toBe(1234);
    expect(snap.trainedEpochs).toEqual([
      { $type: 'training', epochNumber: 1 },
      { $type: 'training', epochNumber: 2 },
    ]);
  });

  it('a quote runs at most once — the second run is the server message, not a code', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await prepareAndQuote(result);
    const quoted = { ...body, quoteId: estimate.trainingQuote!.quoteId };

    expect((await settle(() => result.current.run.runTraining(quoted))).error).toBeUndefined();
    const again = await settle(() => result.current.run.runTraining(quoted));
    const e = again.error as RunTrainingError;
    expect(e).toBeInstanceOf(RunTrainingError);
    expect(e.message).toBe(MOCK_TRAINING_QUOTE_GONE_ERROR);
    expect(e.code).toBeUndefined();
    expect(e.declined).toBe(false);
    expect(e.unconfirmed).toBe(false);
  });

  it('`declined` → .declined, NOT unconfirmed', async () => {
    const m = install({ runTrainingError: 'declined' });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await prepareAndQuote(result);
    const quoted = { ...body, quoteId: estimate.trainingQuote!.quoteId };

    const r = await settle(() => result.current.run.runTraining(quoted));
    const e = r.error as RunTrainingError;
    expect(e).toBeInstanceOf(RunTrainingError);
    expect(e.code).toBe('declined');
    expect(e.declined).toBe(true);
    expect(e.unconfirmed).toBe(false);
    expect(e.signInRequired).toBe(false);
    await waitFor(() => expect(result.current.run.error).toBe(e));
    expect(m.outbound.filter((o) => o.type === 'RUN_TRAINING')).toHaveLength(1);
  });

  it('`submission-unconfirmed` → .unconfirmed (a run may exist), never .declined', async () => {
    uninstall = install({ runTrainingError: 'submission-unconfirmed' }).uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await prepareAndQuote(result);

    const r = await settle(() =>
      result.current.run.runTraining({ ...body, quoteId: estimate.trainingQuote!.quoteId }),
    );
    const e = r.error as RunTrainingError;
    expect(e.code).toBe('submission-unconfirmed');
    expect(e.unconfirmed).toBe(true);
    expect(e.declined).toBe(false);
    expect(e.timedOut).toBe(false);
  });

  it('a resolved spend-cap refusal REJECTS with .refused and the server reason, not a fake run', async () => {
    const reason =
      'daily Buzz cap reached: 900 already spent today across your installed apps, ' +
      'this training run costs 500, daily cap is 1000';
    uninstall = install({ runTrainingCapRefusal: reason, trainingQuoteTotal: 500 }).uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await prepareAndQuote(result);

    const r = await settle(() =>
      result.current.run.runTraining({ ...body, quoteId: estimate.trainingQuote!.quoteId }),
    );
    expect(r.value).toBeUndefined();
    const e = r.error as RunTrainingError;
    expect(e).toBeInstanceOf(RunTrainingError);
    expect(e.refused).toBe(true);
    expect(e.code).toBe('refused');
    expect(e.message).toBe(reason);
    expect(e.unconfirmed).toBe(false);
    expect(e.declined).toBe(false);
    expect(e.snapshot).toEqual({
      workflowId: 'failed',
      status: 'failed',
      cost: { total: 500 },
      error: reason,
    });
    await waitFor(() => expect(result.current.run.error).toBe(e));
  });

  it('a free-text server message on RUN_TRAINING has no code and no money flag', async () => {
    uninstall = install({ runTrainingError: 'the training body differs' }).uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await prepareAndQuote(result);
    const r = await settle(() =>
      result.current.run.runTraining({ ...body, quoteId: estimate.trainingQuote!.quoteId }),
    );
    const e = r.error as RunTrainingError;
    expect(e.message).toBe('the training body differs');
    expect(e.code).toBeUndefined();
    expect([e.declined, e.unconfirmed, e.signInRequired, e.timedOut, e.refused]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('a body whose dataset differs from the quoted one is refused', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate } = await prepareAndQuote(result);
    const other = await settle(() => result.current.prep.prepareDataset(ITEMS));
    const r = await settle(() =>
      result.current.run.runTraining({
        ...bodyFor(other.value!.datasetId),
        quoteId: estimate.trainingQuote!.quoteId,
      }),
    );
    expect((r.error as RunTrainingError).message).toMatch(/differs from the one that was quoted/);
  });

  it('a signed-out viewer gets `sign in to train` → .signInRequired on BOTH bridges', async () => {
    uninstall = install({ viewer: null }).uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const p = await settle(() => result.current.prep.prepareDataset(ITEMS));
    const pe = p.error as PrepareTrainingDatasetError;
    expect(pe).toBeInstanceOf(PrepareTrainingDatasetError);
    expect(pe.code).toBe('sign in to train');
    expect(pe.signInRequired).toBe(true);

    const r = await settle(() =>
      result.current.run.runTraining({
        ...bodyFor(`tds_${'0'.repeat(32)}`),
        quoteId: `tq_${'0'.repeat(32)}`,
      }),
    );
    const re = r.error as RunTrainingError;
    expect(re.code).toBe('sign in to train');
    expect(re.signInRequired).toBe(true);
    expect(re.unconfirmed).toBe(false);
  });

  it('`invalid training dataset` for items outside the host bounds, before any server step', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const cases: unknown[] = [
      [],
      Array.from({ length: 51 }, (_, i) => ({ imageId: i + 1, caption: '' })),
      [{ imageId: 0, caption: 'x' }],
      [{ imageId: 1.5, caption: 'x' }],
      [{ imageId: 1, caption: 'x'.repeat(1001) }],
      [{ imageId: 1, caption: 'x', extra: true }],
      [{ imageId: 1 }],
    ];
    for (const items of cases) {
      const r = await settle(() =>
        result.current.prep.prepareDataset(items as Parameters<typeof result.current.prep.prepareDataset>[0]),
      );
      expect((r.error as PrepareTrainingDatasetError).code, JSON.stringify(items).slice(0, 60)).toBe(
        'invalid training dataset',
      );
    }
    // Boundary that must PASS: 50 items, a 1000-char caption.
    const ok = await settle(() =>
      result.current.prep.prepareDataset(
        Array.from({ length: 50 }, (_, i) => ({ imageId: i + 1, caption: 'x'.repeat(1000) })),
      ),
    );
    expect(ok.value?.count).toBe(50);
  });

  it('nothing admitted → the server\'s refusal, never a resolved count of 0', async () => {
    const m = install({
      trainingDatasetRejected: ITEMS.map((i) => ({ imageId: i.imageId, reason: 'not-eligible' as const })),
    });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const a = await settle(() => result.current.prep.prepareDataset(ITEMS));
    expect(a.value).toBeUndefined();
    const ae = a.error as PrepareTrainingDatasetError;
    expect(ae).toBeInstanceOf(PrepareTrainingDatasetError);
    expect(ae.message).toBe(MOCK_TRAINING_NONE_ELIGIBLE_ERROR);
    expect(ae.code).toBeUndefined();

    // Some passed eligibility and then failed the import → the import refusal.
    m.host.setScenario({
      trainingDatasetRejected: [
        { imageId: 11, reason: 'not-eligible' },
        { imageId: 12, reason: 'import-failed' },
        { imageId: 13, reason: 'import-unavailable' },
      ],
    });
    const b = await settle(() => result.current.prep.prepareDataset(ITEMS));
    expect((b.error as PrepareTrainingDatasetError).message).toBe(
      MOCK_TRAINING_NONE_IMPORTED_ERROR,
    );

    // One admitted → resolves, count 1.
    m.host.setScenario({ trainingDatasetRejected: [{ imageId: 11, reason: 'pending-scan' }, { imageId: 12, reason: 'import-failed' }] });
    const c = await settle(() => result.current.prep.prepareDataset(ITEMS));
    expect(c.value?.count).toBe(1);
  });

  it('`trainingDatasetError` surfaces a code as .code and a server message without one', async () => {
    const m = install({ trainingDatasetError: 'no block token' });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const a = await settle(() => result.current.prep.prepareDataset(ITEMS));
    expect((a.error as PrepareTrainingDatasetError).code).toBe('no block token');

    m.host.setScenario({ trainingDatasetError: 'training from apps is not enabled' });
    const b = await settle(() => result.current.prep.prepareDataset(ITEMS));
    const be = b.error as PrepareTrainingDatasetError;
    expect(be.message).toBe('training from apps is not enabled');
    expect(be.code).toBeUndefined();
    expect(be.signInRequired).toBe(false);
  });

  it('prepare prompts for ai:write:budgeted and retries ONCE on the grant', async () => {
    const m = install({ consentGranted: false });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const r = await settle(() => result.current.prep.prepareDataset(ITEMS));
    expect(r.error).toBeUndefined();
    expect(r.value!.count).toBe(3);
    expect(m.outbound.filter((o) => o.type === 'PREPARE_TRAINING_DATASET')).toHaveLength(2);
    const consent = m.outbound.filter((o) => o.type === 'REQUEST_CONSENT');
    expect(consent).toHaveLength(1);
    expect(consent[0]!.payload).toEqual({ scopes: ['ai:write:budgeted'] });
  });

  it('runTraining NEVER prompts or re-sends, even on a token without the scope', async () => {
    const m = install({ consentGranted: false });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const r = await settle(() =>
      result.current.run.runTraining({
        ...bodyFor(`tds_${'0'.repeat(32)}`),
        quoteId: `tq_${'0'.repeat(32)}`,
      }),
    );
    expect((r.error as RunTrainingError).message).toBe(MOCK_TRAINING_SCOPE_ERROR);
    expect(m.outbound.filter((o) => o.type === 'RUN_TRAINING')).toHaveLength(1);
    expect(m.outbound.filter((o) => o.type === 'REQUEST_CONSENT')).toHaveLength(0);
  });

  it('estimate refuses an unknown dataset, and a quote above the 5,000 per-run ceiling', async () => {
    const m = install({ trainingQuoteTotal: 5001 });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const unknown = await settle(() => result.current.wf.estimate(bodyFor(`tds_${'f'.repeat(32)}`)));
    const ue = unknown.error as WorkflowEstimateError;
    expect(ue).toBeInstanceOf(WorkflowEstimateError);
    expect(ue.code).toBe('failed');
    expect(ue.snapshot.error).toBe(MOCK_TRAINING_DATASET_GONE_ERROR);

    const prepared = await settle(() => result.current.prep.prepareDataset(ITEMS));
    const over = await settle(() =>
      result.current.wf.estimate(bodyFor(prepared.value!.datasetId)),
    );
    expect((over.error as WorkflowEstimateError).snapshot.error).toBe(
      'this training run costs 5001 Buzz, above the per-run limit of 5000 for apps',
    );

    // Exactly AT the ceiling is allowed.
    m.host.setScenario({ trainingQuoteTotal: 5000 });
    const at = await settle(() => result.current.wf.estimate(bodyFor(prepared.value!.datasetId)));
    expect(at.value?.trainingQuote?.total).toBe(5000);
  });

  it('useBuzzWorkflow().submit() refuses a training body without sending anything', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const before = m.outbound.length;

    const r = await settle(() =>
      result.current.wf.submit(bodyFor(`tds_${'0'.repeat(32)}`) as WorkflowBody),
    );
    expect((r.error as Error).message).toBe(TRAINING_BODY_SUBMIT_REFUSAL);
    expect(m.outbound.slice(before)).toEqual([]);
    await waitFor(() => expect(result.current.wf.status).toBe('error'));
  });

  it('a non-training body still submits (the refusal is keyed on kind, not on submit)', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const r = await settle(() =>
      result.current.wf.submit({
        kind: 'textToImage',
        modelId: 1,
        modelVersionId: 2,
        params: { prompt: 'a cat' },
      }),
    );
    expect(r.error).toBeUndefined();
    expect(r.value!.status).toBe('pending');
  });
});
