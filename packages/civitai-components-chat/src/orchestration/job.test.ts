import type { Workflow } from '@civitai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { controllable, flush, imageStep, toolResult, workflow } from '../test-support/fakes.js';
import { decide } from '../ux/spending.js';
import { GenerationJob, type JobDeps, type JobToolInfo } from './job.js';

const MODERN: JobToolInfo = { name: 'run_step', whatif: true, submitOnly: true, tagging: true };

function setup(tool: JobToolInfo = MODERN, limit = 100) {
  const feed = controllable<Workflow>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const responses: Record<string, ReturnType<typeof toolResult>> = {};
  let releaseBlocking: () => void = () => undefined;
  const blockingDone = new Promise<void>((resolve) => (releaseBlocking = resolve));
  const deps: JobDeps = {
    api: {
      getWorkflow: vi.fn(async (id: string) => workflow({ id, status: 'succeeded', steps: [imageStep([{ id: 'b', url: 'https://x/b' }])] as never })),
      watchWorkflow: vi.fn(() => feed.iterate()),
      addTag: vi.fn(async () => undefined),
      updateWorkflow: vi.fn(async () => undefined),
    },
    cancelWorkflow: vi.fn(async () => undefined),
    mcp: {
      callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (args.whatif) return responses.whatif ?? toolResult({ workflowId: 'w0', cost: { total: 44, variable: false }, insufficientBuzz: false });
        if (args.waitForCompletion === false) return responses.submit ?? toolResult({ workflowId: '7-20260923120000000', status: 'submitted' });
        await blockingDone;
        return responses.blocking ?? toolResult(undefined, 'Generated 1 image(s). Workflow: 7-20260923120000000');
      }),
    },
    resolveArgs: vi.fn(async (args: Record<string, unknown>) => ({ ...args, images: args.images ? ['https://x/up'] : undefined })),
    decide: (price) => decide(price, limit),
    hideMatureContent: () => true,
    findWorkflows: vi.fn(async (): Promise<Workflow[]> => []),
  };
  const job = new GenerationJob(deps, {
    id: 'gen3-1',
    conversationId: 'C1',
    seq: 3,
    toolCallId: 'call_1',
    tool,
    args: { prompt: 'a red bike', images: ['up1-1'] },
  });
  return { job, deps, calls, feed, responses, releaseBlocking };
}

describe('GenerationJob', () => {
  it('prices, starts on its own under the limit, returns before the work finishes, then reports results', async () => {
    const { job, calls, feed } = setup();
    await job.start();

    expect(job.state).toBe('running');
    expect(calls.map((c) => [c.args.whatif ?? false, c.args.waitForCompletion ?? true])).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(calls[1]!.args).toMatchObject({ images: ['https://x/up'], tags: ['chat-cvt', 'cvt:job', 'cvt:conv:C1'] });
    expect(JSON.parse(calls[1]!.args.metadataJson as string)).toMatchObject({ job: 'gen3-1', seq: 3, toolCallId: 'call_1', tool: 'run_step' });
    expect(job.summary()).toMatchObject({ job: 'gen3-1', status: 'running', estimatedBuzz: 44 });

    feed.push(workflow({ id: '7-20260923120000000', status: 'processing', steps: [{ $type: 'imageGen', name: '$0', status: 'processing', estimatedProgressRate: 0.5 }] as never }));
    await flush();
    expect(job.progress).toBe(0.5);

    feed.push(workflow({ id: '7-20260923120000000', status: 'succeeded', steps: [imageStep([{ id: 'a', url: 'https://x/a', width: 1024, height: 1024 }])] as never }));
    feed.end();
    await flush();
    expect(job.state).toBe('succeeded');
    expect(job.results).toEqual([
      expect.objectContaining({ id: 'gen3-1-1', kind: 'image', url: 'https://x/a', source: { type: 'result', workflowId: '7-20260923120000000', job: 'gen3-1', path: 'output.images[0]' } }),
    ]);
    expect(job.summary().results).toEqual([{ id: 'gen3-1-1', kind: 'image', width: 1024, height: 1024, seconds: undefined }]);
  });

  it('waits for the user above the limit, tells the assistant nothing started, and submits only when they confirm', async () => {
    const { job, calls } = setup(MODERN, 10);
    await job.start();
    expect(job.state).toBe('awaiting_confirmation');
    expect(calls).toHaveLength(1);
    expect(job.summary().note).toMatch(/^Not started: .*about 44 Buzz.*Nothing is being made yet.*starts once you OK it/);

    await job.confirm();
    expect(job.state).toBe('running');
    expect(calls).toHaveLength(2);
  });

  it('refuses before spending anything when the user lacks the Buzz', async () => {
    const { job, calls, responses } = setup();
    responses.whatif = toolResult({ cost: { total: 500, variable: false }, insufficientBuzz: true });
    await job.start();
    expect(job.state).toBe('rejected');
    expect(job.error?.kind).toBe('insufficient_buzz');
    expect(calls).toHaveLength(1);
  });

  it('finds and watches its workflow when the submit reply is lost but the orchestrator ran it', async () => {
    vi.useFakeTimers();
    try {
      const { job, deps, responses, feed } = setup();
      responses.submit = toolResult(undefined, "An error occurred invoking 'generate_image'.", true);
      vi.mocked(deps.findWorkflows)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          workflow({ id: '9-other', metadata: { job: 'gen2-1' } }),
          workflow({ id: '9-mine', metadata: { job: 'gen3-1' } }),
        ]);
      const started = job.start();
      await vi.advanceTimersByTimeAsync(5_000);
      await started;
      expect(deps.findWorkflows).toHaveBeenCalledWith(['chat-cvt', 'cvt:job', 'cvt:conv:C1']);
      expect(job.workflowId).toBe('9-mine');
      expect(job.state).toBe('running');
      feed.push(workflow({ id: '9-mine', status: 'succeeded', steps: [imageStep([{ id: 'b', url: 'https://x/b' }])] as never }));
      await vi.waitFor(() => expect(job.state).toBe('succeeded'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports the lost submit as failed when no workflow turns up', async () => {
    vi.useFakeTimers();
    try {
      const { job, responses } = setup();
      responses.submit = toolResult(undefined, "An error occurred invoking 'generate_image'.", true);
      const started = job.start();
      await vi.advanceTimersByTimeAsync(120_000);
      await started;
      expect(job.state).toBe('failed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns a tool error into a failed job in plain words', async () => {
    const { job, responses } = setup();
    responses.submit = toolResult(undefined, 'Prompt was blocked by moderation', true);
    await job.start();
    expect(job.state).toBe('failed');
    expect(job.error?.kind).toBe('blocked');
  });

  it('tells the assistant what the service said when a job fails', async () => {
    const { job, responses } = setup();
    responses.whatif = toolResult(undefined, "No service for type 'IMediaProcessorService' has been registered.", true);
    await job.start();
    expect(job.state).toBe('failed');
    expect(job.summary()).toMatchObject({ status: 'failed', reason: expect.stringContaining('IMediaProcessorService') });
  });

  it('stops a running job through the orchestrator', async () => {
    const { job, deps } = setup();
    await job.start();
    expect(job.cancelable).toBe(true);
    await job.cancel();
    expect(deps.cancelWorkflow).toHaveBeenCalledWith('7-20260923120000000');
    expect(job.state).toBe('canceled');
  });

  it('runs a tool without submit-only in the background and tags its workflow afterwards', async () => {
    const legacy: JobToolInfo = { name: 'generate_image', whatif: false, submitOnly: false, tagging: false };
    const { job, deps, calls, releaseBlocking } = setup(legacy, 100);
    await job.start();
    expect(job.state).toBe('running');
    expect(job.cancelable).toBe(false);
    releaseBlocking();
    await flush();
    await flush();
    expect(calls[0]!.args).not.toHaveProperty('tags');
    expect(deps.api.addTag).toHaveBeenCalledTimes(3);
    expect(deps.api.updateWorkflow).toHaveBeenCalledWith('7-20260923120000000', { metadata: expect.objectContaining({ job: 'gen3-1' }) });
    expect(job.state).toBe('succeeded');
    expect(job.results[0]?.url).toBe('https://x/b');
  });

  it('asks first when the price is unknown and the user wants to be asked every time', async () => {
    const legacy: JobToolInfo = { name: 'generate_image', whatif: false, submitOnly: true, tagging: false };
    const { job, calls } = setup(legacy, 0);
    await job.start();
    expect(job.state).toBe('awaiting_confirmation');
    expect(calls).toHaveLength(0);
  });

  it('comes back from its workflow after a reload and keeps watching one still running', async () => {
    const { job, deps, feed } = setup();
    job.resume(workflow({ id: '7-1', status: 'processing', steps: [] }));
    expect(job.state).toBe('running');
    expect(deps.api.watchWorkflow).toHaveBeenCalledWith('7-1', expect.objectContaining({ hideMatureContent: true }));
    feed.push(workflow({ id: '7-1', status: 'failed', steps: [{ $type: 'imageGen', name: '$0', status: 'failed', metadata: { error: 'timed out' } }] as never }));
    feed.end();
    await flush();
    expect(job.state).toBe('failed');
    expect(job.error?.kind).toBe('timeout');
  });
});
