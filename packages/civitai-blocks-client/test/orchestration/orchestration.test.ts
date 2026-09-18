import { describe, expect, it, vi } from 'vitest';
import type {
  TextToImageStepTemplate,
  Workflow,
  WorkflowStatus,
  WorkflowTemplate,
} from '@civitai/orchestration-client/dist/generated/types.gen.js';

import { orchestration } from '../../src/index.js';
import { createFakeTransport } from '../../src/testing.js';

// The orchestrator's own template: nothing in the package names `textToImage`,
// so a step it gains needs no change here.
const STEP = { $type: 'textToImage', input: { prompt: 'a cat' } } as TextToImageStepTemplate;
const TEMPLATE = { steps: [STEP], currencies: [] } as unknown as WorkflowTemplate;
const SPEND = { maxBuzz: 100 };

const workflow = (status: WorkflowStatus, extra: Partial<Workflow> = {}): Workflow =>
  ({ id: 'wf-1', createdAt: '2026-09-18T00:00:00Z', metadata: {}, status, ...extra }) as Workflow;

const reads = (t: ReturnType<typeof createFakeTransport>) =>
  t.sent.filter((m) => m.type === 'ORCHESTRATION_GET_WORKFLOW');

/** `watchWorkflow` sleeps between reads; drive that clock rather than waiting on it. */
const withFakeClock = async (body: () => Promise<void>) => {
  vi.useFakeTimers();
  try {
    await body();
  } finally {
    vi.useRealTimers();
  }
};

describe('orchestration.submitWorkflow', () => {
  it('sends the template with the spend ceiling beside it', async () => {
    const t = createFakeTransport();
    t.reply('ORCHESTRATION_SUBMIT_WORKFLOW', workflow('scheduled'));

    await expect(
      orchestration.submitWorkflow(TEMPLATE, { transport: t, ...SPEND }),
    ).resolves.toMatchObject({ id: 'wf-1', status: 'scheduled' });
    expect(t.sent.at(-1)?.payload).toEqual({ workflow: TEMPLATE, maxBuzz: 100 });
  });

  it('carries the orchestrator’s own idempotency key', async () => {
    const t = createFakeTransport();
    t.reply('ORCHESTRATION_SUBMIT_WORKFLOW', workflow('scheduled'));

    const once = { ...TEMPLATE, externalId: 'once-only' } as WorkflowTemplate;
    await orchestration.submitWorkflow(once, { transport: t, ...SPEND });

    expect(t.sent.at(-1)?.payload).toMatchObject({ workflow: { externalId: 'once-only' } });
  });

  it('reports a failed run as a workflow, not a rejection', async () => {
    const t = createFakeTransport();
    t.reply('ORCHESTRATION_SUBMIT_WORKFLOW', workflow('failed'));

    await expect(
      orchestration.submitWorkflow(TEMPLATE, { transport: t, ...SPEND }),
    ).resolves.toMatchObject({ status: 'failed' });
  });

  it('raises the code the host classified a bad request with', async () => {
    const t = createFakeTransport();
    t.fail('ORCHESTRATION_SUBMIT_WORKFLOW', { code: 'insufficient', message: 'not enough Buzz' });

    await expect(
      orchestration.submitWorkflow(TEMPLATE, { transport: t, ...SPEND }),
    ).rejects.toMatchObject({ code: 'insufficient' });
  });
});

describe('orchestration.estimateWorkflow', () => {
  it('previews the cost without submitting', async () => {
    const t = createFakeTransport();
    t.reply('ORCHESTRATION_ESTIMATE_WORKFLOW', workflow('preparing', { cost: { base: 120, total: 120 } as Workflow['cost'] }));

    const preview = await orchestration.estimateWorkflow(TEMPLATE, { transport: t, ...SPEND });

    expect(preview.cost).toMatchObject({ total: 120 });
    expect(t.sent.map((m) => m.type)).toEqual(['ORCHESTRATION_ESTIMATE_WORKFLOW']);
  });
});

describe('orchestration.watchWorkflow', () => {
  it('reads until a terminal status and yields every state', async () => {
    await withFakeClock(async () => {
      const t = createFakeTransport();
      const seen: string[] = [];

      const done = (async () => {
        for await (const w of orchestration.watchWorkflow('wf-1', { transport: t })) {
          seen.push(w.status);
        }
      })();

      for (const status of ['preparing', 'processing', 'succeeded'] as const) {
        t.reply('ORCHESTRATION_GET_WORKFLOW', workflow(status));
        await vi.advanceTimersByTimeAsync(2_000);
      }
      await done;

      expect(seen).toEqual(['preparing', 'processing', 'succeeded']);
      expect(reads(t).at(0)?.payload).toEqual({ workflowId: 'wf-1', wait: true });
    });
  });

  it('reads straight back out while images are landing', async () => {
    const t = createFakeTransport();
    const seen: number[] = [];

    const withImages = (count: number) =>
      workflow('processing', {
        steps: [{ $type: 'textToImage', output: { images: Array(count).fill({ url: 'u' }) } }],
      } as unknown as Partial<Workflow>);

    t.reply('ORCHESTRATION_GET_WORKFLOW', withImages(1));
    t.reply('ORCHESTRATION_GET_WORKFLOW', withImages(2));
    t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('succeeded'));

    for await (const w of orchestration.watchWorkflow('wf-1', { transport: t })) {
      const step = w.steps?.[0] as { output?: { images: unknown[] } } | undefined;
      seen.push(step?.output?.images.length ?? 0);
    }

    // No clock involved: the held read is the only thing setting the pace.
    expect(seen).toEqual([1, 2, 0]);
    expect(reads(t)).toHaveLength(3);
  });

  it('says nothing when a read changed nothing', async () => {
    const t = createFakeTransport();
    const seen: string[] = [];

    t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('processing'));
    t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('processing'));
    t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('succeeded'));

    for await (const w of orchestration.watchWorkflow('wf-1', { transport: t })) {
      seen.push(w.status);
    }

    expect(seen).toEqual(['processing', 'succeeded']);
    expect(reads(t)).toHaveLength(3);
  });

  it('stops reading when the consumer breaks out', async () => {
    await withFakeClock(async () => {
      const t = createFakeTransport();
      t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('processing'));

      for await (const _ of orchestration.watchWorkflow('wf-1', { transport: t })) break;
      await vi.advanceTimersByTimeAsync(10_000);

      expect(reads(t)).toHaveLength(1);
    });
  });

  it('survives repeated bursts of failures while progress is being made', async () => {
    await withFakeClock(async () => {
      const t = createFakeTransport();
      const seen: string[] = [];

      const done = (async () => {
        for await (const w of orchestration.watchWorkflow('wf-1', { transport: t })) {
          seen.push(w.status);
        }
      })();

      for (const status of ['processing', 'succeeded'] as const) {
        for (let i = 0; i < 3; i += 1) {
          t.fail('ORCHESTRATION_GET_WORKFLOW', { code: 'unavailable', message: 'blip' });
          await vi.advanceTimersByTimeAsync(5_000);
        }
        t.reply('ORCHESTRATION_GET_WORKFLOW', workflow(status));
        await vi.advanceTimersByTimeAsync(0);
      }
      await done;

      expect(seen).toEqual(['processing', 'succeeded']);
    });
  });

  it('waits longer after each consecutive failure', async () => {
    await withFakeClock(async () => {
      const t = createFakeTransport();
      const watching = (async () => {
        for await (const _ of orchestration.watchWorkflow('wf-1', { transport: t }));
      })().catch(() => {});

      const blip = () =>
        t.fail('ORCHESTRATION_GET_WORKFLOW', { code: 'unavailable', message: 'blip' });

      blip();
      await vi.advanceTimersByTimeAsync(0);
      expect(reads(t)).toHaveLength(1);

      // 250ms for the first retry, then 1s — a fixed gap would have re-read twice by now.
      await vi.advanceTimersByTimeAsync(250);
      blip();
      await vi.advanceTimersByTimeAsync(0);
      expect(reads(t)).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(250);
      expect(reads(t)).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(750);
      expect(reads(t)).toHaveLength(3);

      t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('succeeded'));
      await vi.advanceTimersByTimeAsync(0);
      await watching;
    });
  });

  it('gives up once the failures never stop', async () => {
    await withFakeClock(async () => {
      const t = createFakeTransport();
      // Handled from the start: the rejection lands mid-clock-advance, long
      // before an `await` further down could attach to it.
      const failure = (async () => {
        for await (const _ of orchestration.watchWorkflow('wf-1', { transport: t }));
      })().catch((err: unknown) => err);

      for (let i = 0; i < 4; i += 1) {
        t.fail('ORCHESTRATION_GET_WORKFLOW', { code: 'unavailable', message: 'bridge down' });
        await vi.advanceTimersByTimeAsync(5_000);
      }

      expect(await failure).toMatchObject({ code: 'unavailable' });
      expect(reads(t)).toHaveLength(4);
    });
  });

  it('ends without waiting out the read gap when the consumer aborts mid-run', async () => {
    await withFakeClock(async () => {
      const t = createFakeTransport();
      const ac = new AbortController();

      const failure = (async () => {
        for await (const _ of orchestration.watchWorkflow('wf-1', {
          transport: t,
          signal: ac.signal,
        })) {
          ac.abort();
        }
      })().catch((err: unknown) => err);

      t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('processing'));
      await vi.advanceTimersByTimeAsync(0);

      expect(await failure).toMatchObject({ name: 'AbortError' });
    });
  });

  it('gives up immediately when the caller aborts', async () => {
    await withFakeClock(async () => {
      const t = createFakeTransport();
      const ac = new AbortController();
      t.stall('ORCHESTRATION_GET_WORKFLOW');

      const failure = (async () => {
        for await (const _ of orchestration.watchWorkflow('wf-1', {
          transport: t,
          signal: ac.signal,
        }));
      })().catch((err: unknown) => err);

      await Promise.resolve();
      ac.abort();

      expect(await failure).toMatchObject({ name: 'AbortError' });
      expect(reads(t)).toHaveLength(1);
    });
  });
});

describe('orchestration.runWorkflow', () => {
  it('resolves with the finished workflow', async () => {
    await withFakeClock(async () => {
      const t = createFakeTransport();
      const done = orchestration.runWorkflow(TEMPLATE, { transport: t, ...SPEND });

      t.reply('ORCHESTRATION_SUBMIT_WORKFLOW', workflow('scheduled'));
      await vi.advanceTimersByTimeAsync(2_000);
      t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('processing'));
      await vi.advanceTimersByTimeAsync(2_000);
      t.reply('ORCHESTRATION_GET_WORKFLOW', workflow('succeeded'));
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(done).resolves.toMatchObject({ status: 'succeeded' });
    });
  });

  it('resolves rather than throwing when the run fails', async () => {
    const t = createFakeTransport();
    t.reply('ORCHESTRATION_SUBMIT_WORKFLOW', workflow('failed'));

    await expect(
      orchestration.runWorkflow(TEMPLATE, { transport: t, ...SPEND }),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(reads(t)).toHaveLength(0);
  });

  it('never reads a submission that already finished', async () => {
    const t = createFakeTransport();
    t.reply('ORCHESTRATION_SUBMIT_WORKFLOW', workflow('succeeded'));

    await orchestration.runWorkflow(TEMPLATE, { transport: t, ...SPEND });

    expect(reads(t)).toHaveLength(0);
  });
});

describe('orchestration reads', () => {
  it('returns the workflow with its steps and their typed output', async () => {
    const t = createFakeTransport();
    t.reply(
      'ORCHESTRATION_GET_WORKFLOW',
      workflow('succeeded', {
        steps: [{ $type: 'textToImage', name: 'a', output: { images: [{ url: 'u' }] } }],
      } as unknown as Partial<Workflow>),
    );

    const current = await orchestration.getWorkflow('wf-1', { transport: t });

    expect(current.steps?.[0]).toMatchObject({ $type: 'textToImage' });
    expect(t.sent.at(-1)?.payload).toEqual({ workflowId: 'wf-1' });
  });

  it('returns the canceled workflow', async () => {
    const t = createFakeTransport();
    t.reply('ORCHESTRATION_CANCEL_WORKFLOW', workflow('canceled'));

    await expect(orchestration.cancelWorkflow('wf-1', { transport: t })).resolves.toMatchObject({
      status: 'canceled',
    });
    expect(t.sent.at(-1)?.payload).toEqual({ workflowId: 'wf-1' });
  });
});
