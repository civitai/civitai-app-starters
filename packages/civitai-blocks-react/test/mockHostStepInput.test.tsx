import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BlockWorkflowSnapshot, WorkflowBody } from '@civitai/app-sdk/blocks';

import { useBatchEstimate } from '../src/hooks/useBatchEstimate.js';
import {
  useBuzzWorkflow,
  WorkflowEstimateError,
  WorkflowSubmitError,
} from '../src/hooks/useBuzzWorkflow.js';
import { getTransport } from '../src/transport/singleton.js';
import { createMockHost, resetTransport } from '../src/testing.js';

/**
 * The step-input gate (`src/internal/mockHostStepInput.ts`) through the REAL
 * hooks and transport: a pass-through step `input`, and every step of a
 * `kind: 'workflow'` body, is refused for inline media and (on the step arm) for
 * its byte cap — on the estimate, a batch-estimate cell and the submit.
 *
 * 🔴 EVERY EXPECTATION HERE IS A LITERAL, and this file imports nothing the gate
 * added, so it RUNS against a mock without the gate and fails on its assertions
 * there — the regression proof — rather than failing to import.
 *
 * The literals are the real host's reply: the server's zod refusal, whose
 * message tRPC passes on as `err.message` (the issue list as JSON), caught by
 * the page host into `failureSnapshot(err)` — the `'failed'` sentinel id and no
 * `cost`.
 */

const ORIGIN = window.location.origin;
const BALANCE = 500;
const PRICE = 9;

const MEDIA_HINT =
  "carries inline media (data URI/base64); upload it with useImageUpload({ purpose: 'generationSource' }) " +
  'or pick it with useImagePicker and pass the returned url';
const mediaError = (path: string) => `step input ${path} ${MEDIA_HINT}`;
const BYTES_ERROR = 'step input exceeds the 262144-byte limit';

/** A PNG data URI of a realistic photo's size: about 5 MB once base64-encoded. */
const PHOTO_DATA_URI = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAA'.repeat(220_000)}`;
const HOSTED_URL = 'https://image.civitai.com/mock/original=true/source.png';

const stepBody = (input: Record<string, unknown>): WorkflowBody => ({
  kind: 'step',
  $type: 'imageGen',
  input,
  maxBuzz: 10,
});

const workflowBody = (inputs: Record<string, unknown>[]): WorkflowBody => ({
  kind: 'workflow',
  steps: inputs.map((input, i) => ({ name: `s${i}`, $type: 'imageGen', input })),
});

/** The one zod issue a refusal carries, parsed out of `snapshot.error`. */
function issueOf(snapshot: BlockWorkflowSnapshot): { code: string; path: unknown[]; message: string } {
  expect(snapshot).toMatchObject({ workflowId: 'failed', status: 'failed' });
  expect(snapshot.cost).toBeUndefined();
  const issues = JSON.parse(snapshot.error ?? 'null') as unknown;
  expect(Array.isArray(issues) && issues.length).toBe(1);
  return (issues as { code: string; path: unknown[]; message: string }[])[0]!;
}

describe('createMockHost — the step-input gate', () => {
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

  async function setup(options: Parameters<typeof createMockHost>[0] = {}) {
    const host = createMockHost({
      consentGranted: true,
      buzz: { balance: BALANCE },
      generation: { costPerGen: PRICE },
      ...options,
    });
    uninstall = host.install();
    const { result } = renderHook(() => ({ flow: useBuzzWorkflow(), batch: useBatchEstimate() }));
    await waitFor(() => expect(getTransport().getSnapshot().ready).toBe(true));
    const estimate = async (body: WorkflowBody) => {
      let out: BlockWorkflowSnapshot | Error | undefined;
      await act(async () => {
        out = await result.current.flow.estimate(body).catch((e: Error) => e);
      });
      return out!;
    };
    const submit = async (body: WorkflowBody) => {
      let out: BlockWorkflowSnapshot | Error | undefined;
      await act(async () => {
        out = await result.current.flow.submit(body).catch((e: Error) => e);
      });
      return out!;
    };
    return { host, result, estimate, submit };
  }

  /** The estimate rejects as `'failed'` and the submit as `'exception'`, debiting nothing. */
  async function expectRefusedBoth(body: WorkflowBody, path: unknown[], message: string) {
    const { host, estimate, submit } = await setup();
    const est = await estimate(body);
    expect(est).toBeInstanceOf(WorkflowEstimateError);
    expect((est as WorkflowEstimateError).code).toBe('failed');
    expect(issueOf((est as WorkflowEstimateError).snapshot)).toEqual({ code: 'custom', path, message });

    const sub = await submit(body);
    expect(sub).toBeInstanceOf(WorkflowSubmitError);
    expect((sub as WorkflowSubmitError).code).toBe('exception');
    expect(issueOf((sub as WorkflowSubmitError).snapshot)).toEqual({ code: 'custom', path, message });
    expect(host.buzz.getBalance()).toBe(BALANCE);
  }

  it('refuses a data URI in a nested field of a kind:step input, naming its path', async () => {
    await expectRefusedBoth(
      stepBody({
        prompt: 'make it a sticker',
        images: [HOSTED_URL, { label: 'ref', src: 'data:image/png;base64,iVBORw0KGgo=' }],
      }),
      ['body', 'input'],
      mediaError('images[1].src'),
    );
  });

  it('refuses raw base64 of the threshold length in a kind:step input', async () => {
    await expectRefusedBoth(
      stepBody({ image: 'A'.repeat(4096) }),
      ['body', 'input'],
      mediaError('image'),
    );
  });

  it('refuses a data URI in one step of a kind:workflow body, naming the step and the path', async () => {
    await expectRefusedBoth(
      workflowBody([{ prompt: 'a cat' }, { source: { image: 'data:video/mp4;base64,AAAA' } }]),
      ['body', 'steps', 1, 'input'],
      mediaError('source.image'),
    );
  });

  it('refuses an over-cap kind:step input that holds no media with the byte-cap error', async () => {
    // Spaces keep it out of clause (b); 262144 + the JSON wrapping is over the cap.
    await expectRefusedBoth(stepBody({ prompt: 'a b '.repeat(65_536) }), ['body', 'input'], BYTES_ERROR);
  });

  it('gives an over-cap input that IS media the inline-media error, not the byte cap', async () => {
    await expectRefusedBoth(stepBody({ image: PHOTO_DATA_URI }), ['body', 'input'], mediaError('image'));
  });

  it('refuses before the spend-scope check, as a zod refusal precedes the handler', async () => {
    const { estimate, submit } = await setup({ consentGranted: false });
    const body = stepBody({ image: 'data:image/jpeg;base64,/9j/4AAQ' });
    const est = (await estimate(body)) as WorkflowEstimateError;
    expect(issueOf(est.snapshot).message).toBe(mediaError('image'));
    const sub = (await submit(body)) as WorkflowSubmitError;
    expect(issueOf(sub.snapshot).message).toBe(mediaError('image'));
  });

  it('refuses a batch-estimate cell with the issue path relative to the cell', async () => {
    const { result } = await setup();
    let batch: Awaited<ReturnType<typeof result.current.batch.estimateBatch>> | undefined;
    await act(async () => {
      batch = await result.current.batch.estimateBatch([
        stepBody({ image: HOSTED_URL }),
        stepBody({ image: 'data:audio/wav;base64,UklGR' }),
      ]);
    });
    const [ok, refused] = batch!.cells;
    expect(ok!.ok).toBe(true);
    expect(refused!.ok).toBe(false);
    expect(issueOf(!refused!.ok ? refused!.error.snapshot : ({} as BlockWorkflowSnapshot))).toEqual({
      code: 'custom',
      path: ['input'],
      message: mediaError('image'),
    });
  });

  describe('still succeeds with a hosted URL', () => {
    it('on kind:step', async () => {
      const { host, estimate, submit } = await setup();
      const body = stepBody({ prompt: 'a long prompt with spaces '.repeat(200), images: [HOSTED_URL] });
      expect((await estimate(body)) as BlockWorkflowSnapshot).toMatchObject({ cost: { total: PRICE } });
      const sub = (await submit(body)) as BlockWorkflowSnapshot;
      expect(sub.status).not.toBe('failed');
      expect(sub.workflowId).toMatch(/^wf_/);
      expect(host.buzz.getBalance()).toBe(BALANCE - PRICE);
    });

    it('on kind:workflow', async () => {
      const { estimate, submit } = await setup();
      const body = workflowBody([{ prompt: 'a cat' }, { source: { image: HOSTED_URL } }]);
      expect(((await estimate(body)) as BlockWorkflowSnapshot).cost?.total).toBe(2 * PRICE);
      const sub = (await submit(body)) as BlockWorkflowSnapshot;
      expect(sub.workflowId).toMatch(/^wf_/);
    });

    it('with raw base64 one character under the threshold', async () => {
      const { estimate } = await setup();
      expect(((await estimate(stepBody({ seed: 'A'.repeat(4095) }))) as BlockWorkflowSnapshot).cost?.total).toBe(
        PRICE,
      );
    });
  });
});
