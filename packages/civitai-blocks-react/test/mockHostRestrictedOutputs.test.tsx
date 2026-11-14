import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlockWorkflowSnapshot, WorkflowBody } from '@civitai/app-sdk/blocks';

import { useBuzzWorkflow } from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * `createMockHost({ generation: { restrictedOutputs } })`: the mock reports chosen
 * outputs of a succeeded snapshot as RESTRICTED, the way the host does — in
 * position in `outputs` with no url, and left out of `imageUrls` — so a block can
 * render its locked state locally. Without the option every output is `{ url }`.
 *
 * Driven through the REAL `useBuzzWorkflow` hook + transport, so every snapshot
 * asserted here has also passed the SDK's inbound validator.
 */

const ORIGIN = window.location.origin;

const TEXT: WorkflowBody = {
  kind: 'textToImage',
  modelId: 7,
  modelVersionId: 99,
  params: { prompt: 'a cat' },
};

const IMAGES = ['https://img.test/r-0.png', 'https://img.test/r-1.png', 'https://img.test/r-2.png'];

const WORKFLOW: WorkflowBody = {
  kind: 'workflow',
  steps: [
    { name: 'draw', $type: 'imageGen', input: { prompt: 'a lighthouse' } },
    { name: 'up', $type: 'imageGen', input: { image: { $ref: 'draw', path: 'output.images[0].url' } } },
  ],
};

describe('createMockHost — restricted outputs', () => {
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

  async function run(
    generation: NonNullable<Parameters<typeof createMockHost>[0]>['generation'],
    body: WorkflowBody = TEXT,
  ): Promise<BlockWorkflowSnapshot> {
    const host = createMockHost({ consentGranted: true, pollsUntilDone: 1, generation });
    uninstall = host.install();
    const { result } = renderHook(() => useBuzzWorkflow());
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    let snap!: BlockWorkflowSnapshot;
    await act(async () => {
      snap = await result.current.submit(body);
    });
    await act(async () => {
      snap = await result.current.poll(snap.workflowId);
    });
    expect(snap.status).toBe('succeeded');
    return snap;
  }

  it('without the option, every output is { url } and imageUrls is unchanged', async () => {
    const snap = await run({ images: IMAGES });
    expect(snap.imageUrls).toStrictEqual(IMAGES);
    expect(snap.outputs).toStrictEqual(IMAGES.map((url) => ({ url })));
  });

  it("a 'pool' position is restricted in place, with no url, and left out of imageUrls", async () => {
    const snap = await run({ images: IMAGES, restrictedOutputs: { 1: 'pool' } });
    expect(snap.outputs).toStrictEqual([
      { url: IMAGES[0] },
      { restricted: true, reason: 'pool' },
      { url: IMAGES[2] },
    ]);
    expect(snap.imageUrls).toStrictEqual([IMAGES[0], IMAGES[2]]);
    expect(JSON.stringify(snap)).not.toContain(IMAGES[1]);
  });

  it("a 'ceiling' position, and every output restricted: imageUrls is omitted", async () => {
    const snap = await run({
      images: IMAGES,
      restrictedOutputs: { 0: 'ceiling', 1: 'ceiling', 2: 'pool' },
    });
    expect(snap.outputs).toStrictEqual([
      { restricted: true, reason: 'ceiling' },
      { restricted: true, reason: 'ceiling' },
      { restricted: true, reason: 'pool' },
    ]);
    expect(snap).not.toHaveProperty('imageUrls');
    for (const url of IMAGES) expect(JSON.stringify(snap)).not.toContain(url);
  });

  it('kind:workflow: positions run across the steps, and each step mirrors the rule', async () => {
    // `draw` contributes one placeholder at position 0; `up` the three IMAGES at 1..3.
    const snap = await run({ images: IMAGES, restrictedOutputs: { 0: 'ceiling', 2: 'pool' } }, WORKFLOW);
    const [draw, up] = snap.steps!;
    expect(draw!.outputs).toStrictEqual([{ restricted: true, reason: 'ceiling' }]);
    expect(draw).not.toHaveProperty('imageUrls');
    expect(up!.outputs).toStrictEqual([
      { url: IMAGES[0] },
      { restricted: true, reason: 'pool' },
      { url: IMAGES[2] },
    ]);
    expect(up!.imageUrls).toStrictEqual([IMAGES[0], IMAGES[2]]);
    expect(snap.outputs).toStrictEqual([...draw!.outputs!, ...up!.outputs!]);
    expect(snap.imageUrls).toStrictEqual([IMAGES[0], IMAGES[2]]);
    expect(JSON.stringify(snap)).not.toContain(IMAGES[1]);
  });

  it('a restricted 3D model is withheld from model3dOutputs too', async () => {
    const models = [
      { url: 'https://img.test/m-0.glb', format: 'glb', variant: 'model' },
      { url: 'https://img.test/m-1.glb', format: 'glb', variant: 'riggedModel' },
    ];
    const snap = await run(
      { model3dOutputs: models, restrictedOutputs: { 0: 'pool' } },
      { kind: 'step', $type: 'polyGen', input: { prompt: 'a chair' }, maxBuzz: 250 },
    );
    expect(snap.outputs).toStrictEqual([
      { restricted: true, reason: 'pool' },
      { url: 'https://img.test/m-1.glb' },
    ]);
    expect(snap.imageUrls).toStrictEqual(['https://img.test/m-1.glb']);
    expect(snap.model3dOutputs).toStrictEqual([models[1]]);
    expect(JSON.stringify(snap)).not.toContain('https://img.test/m-0.glb');
  });
});
