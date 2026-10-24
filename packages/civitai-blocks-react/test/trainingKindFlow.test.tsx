import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BLOCK_TRAINING_CAPTION_MAX_CHARS,
  BLOCK_TRAINING_DATASET_MAX_ITEMS,
  BLOCK_TRAINING_MAX_BUZZ_PER_RUN,
  type BlockTrainingDataImage,
  type BlockTrainingDatasetItem,
  type BlockWorkflowSnapshot,
  type WorkflowBody,
  type WorkflowBodyTraining,
} from '@civitai/app-sdk/blocks';

import {
  TRAINING_BODY_SUBMIT_REFUSAL,
  useBuzzWorkflow,
  WorkflowEstimateError,
} from '../src/hooks/useBuzzWorkflow.js';
import { useImageUpload } from '../src/hooks/useImageUpload.js';
import { RunTrainingError, useRunTraining } from '../src/hooks/useRunTraining.js';
import {
  MOCK_TRAINING_AIR_ERROR,
  MOCK_TRAINING_DUPLICATE_ERROR,
  MOCK_TRAINING_ITEMS_ERROR,
  MOCK_TRAINING_QUOTE_GONE_ERROR,
  MOCK_TRAINING_BOUNDS,
  MOCK_SPEND_SCOPE_ERROR,
  type MockHostOptions,
} from '../src/internal/mockHost.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The App Blocks `kind: 'training'` flow — upload → estimate → run → watch
 * (civitai/civitai#6461) — driven through the REAL hooks and the REAL iframe
 * transport (so every reply asserted here also passed the inbound validators)
 * against `createMockHost`.
 *
 * 🔴 WHAT THIS CANNOT PROVE: the upload modal and the consent dialog are HOST
 * chrome and the mock has neither — it answers `OPEN_IMAGE_UPLOAD` and settles
 * `RUN_TRAINING` immediately where the real host waits on the viewer. Blob
 * storage, the flag and the page-only / dev-token refusals are server-side and
 * not modelled.
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

const bodyFor = (items: BlockTrainingDatasetItem[]): WorkflowBodyTraining => ({
  kind: 'training',
  items,
  engine: 'ai-toolkit',
  model: 'sdxl',
  params: PARAMS,
  triggerWord: 'tok',
  samplePrompts: ['a photo of tok'],
});

const captioned = (images: BlockTrainingDataImage[]): BlockTrainingDatasetItem[] =>
  images.map((img, i) => ({ air: img.air, caption: `caption ${i}` }));

/** A key the mock never handed out — a blob "not uploaded here". */
const FOREIGN_ITEMS: BlockTrainingDatasetItem[] = [{ air: 'foreignkey0001.png', caption: 'x' }];

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
    upload: useImageUpload({ purpose: 'trainingData' }),
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

/** upload → estimate, returning the uploaded images, the estimate and the body to run. */
async function uploadAndQuote(result: Hooks) {
  const uploaded = await settle(() => result.current.upload.open());
  expect(uploaded.error).toBeUndefined();
  const images = uploaded.value!;
  expect(images).not.toBeNull();
  const body = bodyFor(captioned(images!));
  const estimated = await settle(() => result.current.wf.estimate(body));
  expect(estimated.error).toBeUndefined();
  return { images: images!, estimate: estimated.value!, body };
}

describe('mock training bounds', () => {
  it('are the SDK constants (the mock copies them to keep the peer floor down)', () => {
    expect(MOCK_TRAINING_BOUNDS).toEqual({
      datasetMaxItems: BLOCK_TRAINING_DATASET_MAX_ITEMS,
      captionMaxChars: BLOCK_TRAINING_CAPTION_MAX_CHARS,
      maxBuzzPerRun: BLOCK_TRAINING_MAX_BUZZ_PER_RUN,
    });
    // The host's caption bound, not merely "whatever the SDK says" — a copy that
    // drifted together with the SDK constant would pass the equality above.
    expect(MOCK_TRAINING_BOUNDS.captionMaxChars).toBe(8192);
    expect(MOCK_TRAINING_BOUNDS.datasetMaxItems).toBe(50);
  });
});

describe('RunTrainingError — the "not uploaded here" refusal', () => {
  it('carries the host code and its own flag, and no money flag', () => {
    const e = new RunTrainingError('training data not uploaded here');
    expect(e.code).toBe('training data not uploaded here');
    expect(e.trainingDataNotUploaded).toBe(true);
    expect([e.declined, e.unconfirmed, e.signInRequired, e.timedOut, e.refused]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('is false for every other code and for a server message', () => {
    for (const msg of ['declined', 'submission-unconfirmed', 'training data not uploaded', 'x']) {
      expect(new RunTrainingError(msg).trainingDataNotUploaded, msg).toBe(false);
    }
  });
});

describe('kind:training — upload → estimate → run → watch', () => {
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

  it('runs end to end: uploaded blobs, a stored quote, a run, and trained epochs on watch', async () => {
    const m = install({ trainingQuoteTotal: 1234, generation: { trainedEpochs: 2 }, pollsUntilDone: 1 });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const { images, estimate, body } = await uploadAndQuote(result);
    // The default canned upload: three images, each a url and a distinct key.
    expect(images).toHaveLength(3);
    expect(new Set(images.map((i) => i.air)).size).toBe(3);
    for (const img of images) {
      expect(img.url.endsWith(`/v2/consumer/blobs/${img.air}`)).toBe(true);
    }
    const uploadMsg = m.outbound.find((o) => o.type === 'OPEN_IMAGE_UPLOAD');
    expect((uploadMsg!.payload as { purpose?: string }).purpose).toBe('trainingData');

    expect(estimate.cost?.total).toBe(1234);
    expect(estimate.trainingQuote).toMatchObject({ total: 1234, imageCount: 3 });
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

  it('each default upload hands out NEW keys — two uploads never collide', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const a = (await settle(() => result.current.upload.open())).value!;
    const b = (await settle(() => result.current.upload.open())).value!;
    const keys = [...a!, ...b!].map((i) => i.air);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('`cannedTrainingDataUpload` is returned verbatim; `null` is a cancel', async () => {
    const canned: BlockTrainingDataImage[] = [
      { url: 'https://example.test/v2/consumer/blobs/AbC123.png', air: 'AbC123.png' },
    ];
    const m = install({ cannedTrainingDataUpload: canned });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    expect((await settle(() => result.current.upload.open())).value).toEqual(canned);

    m.host.setScenario({ cannedTrainingDataUpload: null });
    const cancelled = await settle(() => result.current.upload.open());
    expect(cancelled.error).toBeUndefined();
    expect(cancelled.value).toBeNull();
  });

  it('a quote naming a blob NOT uploaded here is refused before any dialog, and the quote is kept', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    // The estimate does not check uploads (neither does the server's); the run does.
    const body = bodyFor(FOREIGN_ITEMS);
    const est = await settle(() => result.current.wf.estimate(body));
    expect(est.error).toBeUndefined();
    const quoted = { ...body, quoteId: est.value!.trainingQuote!.quoteId };

    const r = await settle(() => result.current.run.runTraining(quoted));
    const e = r.error as RunTrainingError;
    expect(e).toBeInstanceOf(RunTrainingError);
    expect(e.message).toBe('training data not uploaded here');
    expect(e.code).toBe('training data not uploaded here');
    expect(e.trainingDataNotUploaded).toBe(true);
    expect(e.unconfirmed).toBe(false);
    expect(e.declined).toBe(false);

    // Uploading that blob here makes the SAME quote runnable: the refusal settled
    // before the server claimed it.
    m.host.setScenario({
      cannedTrainingDataUpload: [
        { url: 'https://example.test/v2/consumer/blobs/foreignkey0001.png', air: 'foreignkey0001.png' },
      ],
    });
    await settle(() => result.current.upload.open());
    const ran = await settle(() => result.current.run.runTraining(quoted));
    expect(ran.error).toBeUndefined();
    expect(ran.value!.status).toBe('pending');
  });

  it('upload keys compare case-insensitively, and an item may name the blob by its url', async () => {
    const m = install({
      cannedTrainingDataUpload: [
        { url: 'https://example.test/v2/consumer/blobs/MiXeD01.png', air: 'MiXeD01.png' },
        { url: 'https://example.test/v2/consumer/blobs/plain02.webp', air: 'plain02.webp' },
      ],
    });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    await settle(() => result.current.upload.open());

    const body = bodyFor([
      { air: 'mixed01.PNG', caption: 'a' },
      { air: 'https://example.test/v2/consumer/blobs/plain02.webp?x=1', caption: 'b' },
    ]);
    const est = await settle(() => result.current.wf.estimate(body));
    expect(est.error).toBeUndefined();
    expect(est.value!.trainingQuote!.imageCount).toBe(2);
    const ran = await settle(() =>
      result.current.run.runTraining({ ...body, quoteId: est.value!.trainingQuote!.quoteId }),
    );
    expect(ran.error).toBeUndefined();
  });

  it('`trainingDataNotUploadedHere` refuses even uploaded blobs (the host forgot them), and clears', async () => {
    const m = install({ trainingDataNotUploadedHere: true });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await uploadAndQuote(result);
    const quoted = { ...body, quoteId: estimate.trainingQuote!.quoteId };

    const refused = await settle(() => result.current.run.runTraining(quoted));
    expect((refused.error as RunTrainingError).trainingDataNotUploaded).toBe(true);

    m.host.setScenario({ trainingDataNotUploadedHere: undefined });
    const ran = await settle(() => result.current.run.runTraining(quoted));
    expect(ran.error).toBeUndefined();
  });

  it('estimate refuses items outside the host schema; the boundary passes', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const key = (i: number) => `k${i}`;

    const cases: Array<[unknown, string]> = [
      [[], MOCK_TRAINING_ITEMS_ERROR],
      [Array.from({ length: 51 }, (_, i) => ({ air: key(i), caption: '' })), MOCK_TRAINING_ITEMS_ERROR],
      [[{ air: 'k1', caption: 'x'.repeat(8193) }], MOCK_TRAINING_ITEMS_ERROR],
      [[{ air: 'k1', caption: 'x', extra: true }], MOCK_TRAINING_ITEMS_ERROR],
      [[{ air: 'k1' }], MOCK_TRAINING_ITEMS_ERROR],
      [[{ imageId: 1, caption: 'x' }], MOCK_TRAINING_ITEMS_ERROR],
      [[{ air: 'not a key!', caption: 'x' }], MOCK_TRAINING_AIR_ERROR],
      [[{ air: 'https://example.test/some/other/path.png', caption: 'x' }], MOCK_TRAINING_AIR_ERROR],
      [
        [
          { air: 'Dup1.png', caption: 'a' },
          { air: 'dup1.PNG', caption: 'b' },
        ],
        MOCK_TRAINING_DUPLICATE_ERROR,
      ],
    ];
    for (const [items, message] of cases) {
      const r = await settle(() =>
        result.current.wf.estimate({ ...bodyFor([]), items } as unknown as WorkflowBody),
      );
      const e = r.error as WorkflowEstimateError;
      expect(e, JSON.stringify(items).slice(0, 60)).toBeInstanceOf(WorkflowEstimateError);
      expect(e.snapshot.error, JSON.stringify(items).slice(0, 60)).toBe(message);
    }

    // Boundary that must PASS: 50 items, an 8,192-char caption.
    const ok = await settle(() =>
      result.current.wf.estimate(
        bodyFor(Array.from({ length: 50 }, (_, i) => ({ air: key(i), caption: 'x'.repeat(8192) }))),
      ),
    );
    expect(ok.error).toBeUndefined();
    expect(ok.value?.trainingQuote?.imageCount).toBe(50);
  });

  it('a quote runs at most once — the second run is the server message, not a code', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await uploadAndQuote(result);
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
    const { estimate, body } = await uploadAndQuote(result);
    const quoted = { ...body, quoteId: estimate.trainingQuote!.quoteId };

    const r = await settle(() => result.current.run.runTraining(quoted));
    const e = r.error as RunTrainingError;
    expect(e).toBeInstanceOf(RunTrainingError);
    expect(e.code).toBe('declined');
    expect(e.declined).toBe(true);
    expect(e.unconfirmed).toBe(false);
    expect(e.signInRequired).toBe(false);
    expect(e.trainingDataNotUploaded).toBe(false);
    await waitFor(() => expect(result.current.run.error).toBe(e));
    expect(m.outbound.filter((o) => o.type === 'RUN_TRAINING')).toHaveLength(1);
  });

  it('`submission-unconfirmed` → .unconfirmed (a run may exist), never .declined', async () => {
    uninstall = install({ runTrainingError: 'submission-unconfirmed' }).uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await uploadAndQuote(result);

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
    const { estimate, body } = await uploadAndQuote(result);

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

  it('a cap refusal CONSUMES the quote: re-running it gets the quote-gone error; a fresh quote runs once the knob clears', async () => {
    const m = install({ runTrainingCapRefusal: 'app daily spend cap reached' });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await uploadAndQuote(result);
    const quoted = { ...body, quoteId: estimate.trainingQuote!.quoteId };

    const first = await settle(() => result.current.run.runTraining(quoted));
    expect((first.error as RunTrainingError).refused).toBe(true);

    m.host.setScenario({ runTrainingCapRefusal: undefined });
    const again = await settle(() => result.current.run.runTraining(quoted));
    const e = again.error as RunTrainingError;
    expect(e.message).toBe(MOCK_TRAINING_QUOTE_GONE_ERROR);
    expect(e.code).toBeUndefined();
    expect(e.refused).toBe(false);

    // The knob really cleared: a NEW quote starts a run.
    const fresh = await settle(() => result.current.wf.estimate(body));
    const ran = await settle(() =>
      result.current.run.runTraining({ ...body, quoteId: fresh.value!.trainingQuote!.quoteId }),
    );
    expect(ran.error).toBeUndefined();
    expect(ran.value!.status).toBe('pending');
  });

  it('`declined` does NOT consume the quote — the same quote runs once the viewer confirms', async () => {
    const m = install({ runTrainingError: 'declined' });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await uploadAndQuote(result);
    const quoted = { ...body, quoteId: estimate.trainingQuote!.quoteId };
    expect(((await settle(() => result.current.run.runTraining(quoted))).error as RunTrainingError).declined).toBe(true);
    m.host.setScenario({ runTrainingError: undefined });
    const ran = await settle(() => result.current.run.runTraining(quoted));
    expect(ran.error).toBeUndefined();
  });

  it('a forced SERVER outcome consumes the quote; a forced host gate/dialog code keeps it', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { body } = await uploadAndQuote(result);

    const runFresh = async (forced: string) => {
      const q = await settle(() => result.current.wf.estimate(body));
      const quoted = { ...body, quoteId: q.value!.trainingQuote!.quoteId };
      m.host.setScenario({ runTrainingError: forced });
      const first = await settle(() => result.current.run.runTraining(quoted));
      expect((first.error as RunTrainingError).message, forced).toBe(forced);
      m.host.setScenario({ runTrainingError: undefined });
      return settle(() => result.current.run.runTraining(quoted));
    };

    // After the server's claim → the quote is gone.
    for (const forced of ['Not enough Buzz for this training run.', 'submission-unconfirmed']) {
      const again = await runFresh(forced);
      expect((again.error as RunTrainingError | undefined)?.message, forced).toBe(
        MOCK_TRAINING_QUOTE_GONE_ERROR,
      );
    }
    // Before it → the same quote still runs. `training data not uploaded here` is
    // a host refusal made before any dialog, so it keeps the quote too.
    for (const forced of ['declined', 'no block token', 'training data not uploaded here']) {
      const again = await runFresh(forced);
      expect(again.error, forced).toBeUndefined();
      expect(again.value?.status, forced).toBe('pending');
    }
  });

  it('a body that differs from the quoted one is refused, and that consumes the quote', async () => {
    uninstall = install().uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await uploadAndQuote(result);
    const quoteId = estimate.trainingQuote!.quoteId;

    // Same blobs, one caption changed — the server hashes the whole body.
    const edited = {
      ...body,
      items: body.items.map((it, i) => (i === 0 ? { ...it, caption: 'edited' } : it)),
    };
    const mismatch = await settle(() => result.current.run.runTraining({ ...edited, quoteId }));
    expect((mismatch.error as RunTrainingError).message).toMatch(/differs from the one that was quoted/);
    const again = await settle(() => result.current.run.runTraining({ ...body, quoteId }));
    expect((again.error as RunTrainingError).message).toBe(MOCK_TRAINING_QUOTE_GONE_ERROR);
  });

  it('a free-text server message on RUN_TRAINING has no code and no money flag', async () => {
    uninstall = install({ runTrainingError: 'the training body differs' }).uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const { estimate, body } = await uploadAndQuote(result);
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

  it('a signed-out viewer gets `sign in to train` → .signInRequired', async () => {
    uninstall = install({ viewer: null }).uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const r = await settle(() =>
      result.current.run.runTraining({ ...bodyFor(FOREIGN_ITEMS), quoteId: `tq_${'0'.repeat(32)}` }),
    );
    const re = r.error as RunTrainingError;
    expect(re.code).toBe('sign in to train');
    expect(re.signInRequired).toBe(true);
    expect(re.unconfirmed).toBe(false);
  });

  it('runTraining NEVER prompts or re-sends, even on a token without the scope', async () => {
    const m = install({ consentGranted: false });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const r = await settle(() =>
      result.current.run.runTraining({ ...bodyFor(FOREIGN_ITEMS), quoteId: `tq_${'0'.repeat(32)}` }),
    );
    expect((r.error as RunTrainingError).message).toBe(MOCK_SPEND_SCOPE_ERROR);
    expect(m.outbound.filter((o) => o.type === 'RUN_TRAINING')).toHaveLength(1);
    expect(m.outbound.filter((o) => o.type === 'REQUEST_CONSENT')).toHaveLength(0);
  });

  it('estimate refuses a quote above the 5,000 per-run ceiling; exactly at it is allowed', async () => {
    const m = install({ trainingQuoteTotal: 5001 });
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));

    const over = await settle(() => result.current.wf.estimate(bodyFor(FOREIGN_ITEMS)));
    expect((over.error as WorkflowEstimateError).snapshot.error).toBe(
      'this training run costs 5001 Buzz, above the per-run limit of 5000 for apps',
    );

    m.host.setScenario({ trainingQuoteTotal: 5000 });
    const at = await settle(() => result.current.wf.estimate(bodyFor(FOREIGN_ITEMS)));
    expect(at.value?.trainingQuote?.total).toBe(5000);
  });

  it('useBuzzWorkflow().submit() refuses a training body without sending anything', async () => {
    const m = install();
    uninstall = m.uninstall;
    const { result } = hooks();
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const before = m.outbound.length;

    const r = await settle(() => result.current.wf.submit(bodyFor(FOREIGN_ITEMS) as WorkflowBody));
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
