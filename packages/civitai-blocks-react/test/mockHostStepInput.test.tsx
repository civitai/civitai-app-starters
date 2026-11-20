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
 * hooks and transport: a pass-through step `input`, and every step `input` and
 * the `arguments` of a `kind: 'workflow'` body, is refused for inline media, for
 * holding too many values, and (on the step arm) for its byte cap — on the
 * estimate, a batch-estimate cell and the submit.
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

/** The server's `inlineMediaMessage`, for a path already formatted by `formatInlineMediaPath`. */
const mediaError = (path: string) =>
  `${path} carries inline media (data URI/base64); pass a hosted url instead — upload the image, ` +
  "video or audio with useMediaUpload (an image also works with useImageUpload({ purpose: 'generationSource' }) " +
  'or useImagePicker) and pass the returned url';
const BYTES_ERROR = 'step input exceeds the 262144-byte limit';
const WORKFLOW_BYTES_ERROR = 'workflow step inputs and arguments exceed the 262144-byte limit';
/** A prose string (spaces keep it out of the raw-base64 clause) whose JSON alone is over the cap. */
const OVER_CAP_PROSE = 'a b '.repeat(65_536);
const STEP_TOO_MANY = 'step input holds more than 262144 values';
const WORKFLOW_TOO_MANY = 'step inputs and arguments hold more than 262144 values in total';

/** A PNG data URI of a realistic photo's size: about 5 MB once base64-encoded. */
const PHOTO_DATA_URI = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAA'.repeat(220_000)}`;
const HOSTED_URL = 'https://image.civitai.com/mock/original=true/source.png';

const stepBody = (input: Record<string, unknown>): WorkflowBody => ({
  kind: 'step',
  $type: 'imageGen',
  input,
  maxBuzz: 10,
});

const workflowBody = (inputs: Record<string, unknown>[], args?: Record<string, unknown>): WorkflowBody => ({
  kind: 'workflow',
  steps: inputs.map((input, i) => ({ name: `s${i}`, $type: 'imageGen', input })),
  ...(args ? { arguments: args } : {}),
});

/**
 * An object of `n` keys whose values are all `undefined`: `n` visits of the
 * value budget, but `{}` to `JSON.stringify` — far under the byte cap. That is
 * the padding the budget exists to refuse.
 */
const pad = (n: number, tag = 'k'): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < n; i++) out[`${tag}${i}`] = undefined;
  return out;
};

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

  /** Both calls succeed: priced, submitted, and charged. */
  async function expectAccepted(body: WorkflowBody, price: number) {
    const { host, estimate, submit } = await setup();
    expect(((await estimate(body)) as BlockWorkflowSnapshot).cost?.total).toBe(price);
    const sub = (await submit(body)) as BlockWorkflowSnapshot;
    expect(sub.workflowId).toMatch(/^wf_/);
    expect(host.buzz.getBalance()).toBe(BALANCE - price);
  }

  describe('inline media', () => {
    it('refuses a data URI in a nested field of a kind:step input, naming its path', async () => {
      await expectRefusedBoth(
        stepBody({
          prompt: 'make it a sticker',
          images: [HOSTED_URL, { label: 'ref', src: 'data:image/png;base64,iVBORw0KGgo=' }],
        }),
        ['body', 'input', 'images', 1, 'src'],
        mediaError('input.images[1].src'),
      );
    });

    it('refuses raw base64 of the threshold length in a kind:step input', async () => {
      await expectRefusedBoth(stepBody({ ImageUrl: 'A'.repeat(4096) }), ['body', 'input', 'ImageUrl'], mediaError('input.ImageUrl'));
    });

    it('refuses a data URI in one step of a kind:workflow body, naming the step and the path', async () => {
      await expectRefusedBoth(
        workflowBody([{ prompt: 'a cat' }, { source: { image: 'data:video/mp4;base64,AAAA' } }]),
        ['body', 'steps', 1, 'input', 'source', 'image'],
        mediaError('steps[1].input.source.image'),
      );
    });

    it('refuses a data URI in a kind:workflow body’s arguments', async () => {
      await expectRefusedBoth(
        workflowBody([{ prompt: { $ref: '$arguments', path: 'prompt' } }], {
          prompt: 'a cat',
          refs: ['https://x/a.png', 'data:image/webp;base64,UklGR'],
        }),
        ['body', 'arguments', 'refs', 1],
        mediaError('arguments.refs[1]'),
      );
    });

    it('reports a step input before arguments when both carry media', async () => {
      await expectRefusedBoth(
        workflowBody([{ image: 'data:image/png;base64,x' }], { image: 'data:image/png;base64,y' }),
        ['body', 'steps', 0, 'input', 'image'],
        mediaError('steps[0].input.image'),
      );
    });

    it('gives an over-cap input that IS media the inline-media error, not the byte cap', async () => {
      await expectRefusedBoth(stepBody({ image: PHOTO_DATA_URI }), ['body', 'input', 'image'], mediaError('input.image'));
    });

    it('refuses before the spend-scope check, as a zod refusal precedes the handler', async () => {
      const { estimate, submit } = await setup({ consentGranted: false });
      const body = stepBody({ image: 'data:image/jpeg;base64,/9j/4AAQ' });
      const est = (await estimate(body)) as WorkflowEstimateError;
      expect(issueOf(est.snapshot).message).toBe(mediaError('input.image'));
      const sub = (await submit(body)) as WorkflowSubmitError;
      expect(issueOf(sub.snapshot).message).toBe(mediaError('input.image'));
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
        path: ['input', 'image'],
        message: mediaError('input.image'),
      });
    });
  });

  describe('the byte cap', () => {
    it('refuses an over-cap kind:step input that holds no media with the byte-cap error', async () => {
      // Spaces keep it out of the raw-base64 clause; 262144 + the JSON wrapping is over the cap.
      await expectRefusedBoth(stepBody({ prompt: OVER_CAP_PROSE }), ['body', 'input'], BYTES_ERROR);
    });

    it('refuses an over-cap kind:workflow body with the summed byte-cap error', async () => {
      await expectRefusedBoth(
        workflowBody([{ prompt: 'a b '.repeat(40_000) }], { more: 'a b '.repeat(40_000) }),
        ['body', 'steps'],
        WORKFLOW_BYTES_ERROR,
      );
    });

    // Once the strings already searched are over the cap, no later string is
    // read, so the byte cap — not the inline-media rule — refuses the body.
    it('gives a photo AFTER a string that crossed the cap the byte-cap error', async () => {
      await expectRefusedBoth(
        stepBody({ prompt: OVER_CAP_PROSE, image: 'data:image/png;base64,iVBORw0KGgo=' }),
        ['body', 'input'],
        BYTES_ERROR,
      );
    });

    it('still searches the string that crosses the cap, and the next one while the count is AT the cap', async () => {
      // 262142 characters + 2 quotes = exactly 262144 counted: not past the cap, so the photo is read.
      const atCap = 'a '.repeat(131_071);
      expect(atCap.length + 2).toBe(262_144);
      await expectRefusedBoth(
        stepBody({ prompt: atCap, image: 'data:image/png;base64,x' }),
        ['body', 'input', 'image'],
        mediaError('input.image'),
      );
    });

    it('stops reading one character past the cap', async () => {
      const pastCap = `${'a '.repeat(131_071)}a`;
      await expectRefusedBoth(stepBody({ prompt: pastCap, image: 'data:image/png;base64,x' }), ['body', 'input'], BYTES_ERROR);
    });

    it('skips media in arguments once the step inputs crossed the cap (the count is shared)', async () => {
      await expectRefusedBoth(
        workflowBody([{ prompt: OVER_CAP_PROSE }], { image: 'data:image/png;base64,x' }),
        ['body', 'steps'],
        WORKFLOW_BYTES_ERROR,
      );
    });

    it('still reports the value budget after the cap is crossed (the walk finishes)', async () => {
      await expectRefusedBoth(
        stepBody({ prompt: OVER_CAP_PROSE, after: 'x', more: pad(262_144) }),
        ['body', 'input'],
        STEP_TOO_MANY,
      );
    });

    it('still walks LATER fields for the value budget after an earlier one crossed the cap', async () => {
      await expectRefusedBoth(
        // `after` is a string read once the count is past the cap, so this
        // field's search ends as over-byte-limit — and `arguments` is still walked.
        workflowBody([{ prompt: OVER_CAP_PROSE, after: 'x' }], pad(262_144)),
        ['body', 'steps'],
        WORKFLOW_TOO_MANY,
      );
    });
  });

  describe('the shared value budget (fail-closed)', () => {
    // A kind:step input costs one visit for itself plus one per key, so 262143
    // keys spend exactly the 262144 budget and one more key overflows it.
    it('accepts a kind:step input of exactly the budget', async () => {
      await expectAccepted(stepBody(pad(262_143)), PRICE);
    });

    it('refuses a kind:step input one value over the budget, though it is tiny in bytes', async () => {
      await expectRefusedBoth(stepBody(pad(262_144)), ['body', 'input'], STEP_TOO_MANY);
    });

    it('refuses an over-budget input even when media sits beyond the budget', async () => {
      await expectRefusedBoth(
        stepBody({ ...pad(300_000), photo: 'data:image/png;base64,iVBOR' }),
        ['body', 'input'],
        STEP_TOO_MANY,
      );
    });

    it('spends ONE budget across the workflow steps and its arguments', async () => {
      // Each half alone is well within the budget; together they overflow it.
      await expectRefusedBoth(
        workflowBody([{ prompt: 'a cat', ...pad(140_000, 's') }], { ...pad(140_000, 'a') }),
        ['body', 'steps'],
        WORKFLOW_TOO_MANY,
      );
    });

    it('accepts the steps half of that body on its own', async () => {
      await expectAccepted(workflowBody([{ prompt: 'a cat', ...pad(140_000, 's') }]), PRICE);
    });

    it('accepts the arguments half of that body on its own', async () => {
      await expectAccepted(workflowBody([{ prompt: 'a cat' }], { ...pad(140_000, 'a') }), PRICE);
    });
  });

  describe('still succeeds with a hosted URL', () => {
    it('on kind:step', async () => {
      await expectAccepted(stepBody({ prompt: 'a long prompt with spaces '.repeat(200), images: [HOSTED_URL] }), PRICE);
    });

    it('on kind:workflow, with arguments', async () => {
      await expectAccepted(
        workflowBody([{ prompt: { $ref: '$arguments', path: 'prompt' } }, { source: { image: HOSTED_URL } }], {
          prompt: 'a cat',
        }),
        2 * PRICE,
      );
    });

    it('with raw base64 one character under the threshold', async () => {
      await expectAccepted(stepBody({ seed: 'A'.repeat(4095) }), PRICE);
    });
  });
});
