import { describe, expect, it } from 'vitest';

import { createHttp } from '../../src/http/index.js';
import { createOrchestrationClient } from '../../src/orchestration/index.js';
import { createTokenSession } from '../../src/session/index.js';
import { fakeFetch, json } from '../support/fake-fetch.js';

const BASE = 'https://orchestration.civitai.com';
const TEMPLATE = {
  currencies: [],
  steps: [{ $type: 'textToImage', input: { model: 'urn:air:sdxl:checkpoint:civitai:1@2', prompt: 'a lighthouse' } }],
} as never;

const workflow = (status: string) => ({ id: 'wf_1', status, steps: [] });

function client(responses: Parameters<typeof fakeFetch>[0]) {
  const { fetch, calls } = fakeFetch(responses);
  const http = createHttp({ session: createTokenSession({ token: 't' }), baseUrl: BASE, fetch });
  return { orchestration: createOrchestrationClient(http), calls };
}

describe('orchestration', () => {
  it('submits the template as it is', async () => {
    const { orchestration, calls } = client([() => json(200, workflow('unassigned'))]);

    await expect(orchestration.submitWorkflow(TEMPLATE)).resolves.toMatchObject({ id: 'wf_1' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/v2/consumer/workflows` });
    expect(JSON.parse(calls[0]!.body!)).toEqual(TEMPLATE);
  });

  it('prices a workflow without running it', async () => {
    const { orchestration, calls } = client([() => json(200, workflow('unassigned'))]);

    await orchestration.estimateWorkflow(TEMPLATE);
    expect(calls[0]!.url).toBe(`${BASE}/v2/consumer/workflows?whatif=true`);
  });

  it('reads once, then holds reads until the workflow changes', async () => {
    const { orchestration, calls } = client([
      () => json(200, workflow('processing')),
      () => json(200, workflow('succeeded')),
    ]);

    await expect(orchestration.waitForWorkflow('wf_1')).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/v2/consumer/workflows/wf_1`,
      `${BASE}/v2/consumer/workflows/wf_1?wait=20&until=change`,
    ]);
  });

  it('yields each state the workflow moves through, and not a repeat', async () => {
    const { orchestration } = client([
      () => json(200, workflow('unassigned')),
      () => json(202, workflow('unassigned')),
      () => json(200, workflow('processing')),
      () => json(200, workflow('succeeded')),
    ]);

    const seen: string[] = [];
    for await (const state of orchestration.watchWorkflow('wf_1')) seen.push(state.status);

    expect(seen).toEqual(['unassigned', 'processing', 'succeeded']);
  });

  it('counts a step’s progress as a change even when the status holds', async () => {
    const running = (output: unknown) => ({ ...workflow('processing'), steps: [{ name: 'a', output }] });
    const { orchestration } = client([
      () => json(200, running(null)),
      () => json(200, running({ images: [{ url: 'https://blob/1.png' }] })),
      () => json(200, workflow('succeeded')),
    ]);

    let yields = 0;
    for await (const _ of orchestration.watchWorkflow('wf_1')) yields++;

    expect(yields).toBe(3);
  });

  it('stops reading when the caller stops watching', async () => {
    const { orchestration, calls } = client([() => json(200, workflow('processing'))]);

    for await (const state of orchestration.watchWorkflow('wf_1')) {
      expect(state.status).toBe('processing');
      break;
    }

    expect(calls).toHaveLength(1);
  });

  it('resolves a failed workflow rather than throwing', async () => {
    const { orchestration } = client([() => json(200, workflow('failed'))]);

    await expect(orchestration.waitForWorkflow('wf_1')).resolves.toMatchObject({ status: 'failed' });
  });

  it('waits out a blip but not a refusal', async () => {
    const blip = client([
      () => json(200, workflow('processing')),
      () => json(503, {}),
      () => json(200, workflow('succeeded')),
    ]);
    await expect(blip.orchestration.waitForWorkflow('wf_1')).resolves.toMatchObject({
      status: 'succeeded',
    });

    const refused = client([() => json(404, { title: 'Not Found' })]);
    await expect(refused.orchestration.waitForWorkflow('wf_1')).rejects.toMatchObject({ status: 404 });
  });

  it('cancels by setting the status', async () => {
    const { orchestration, calls } = client([() => new Response(null, { status: 200 })]);

    await orchestration.cancelWorkflow('wf_1');
    expect(calls[0]).toMatchObject({ method: 'PUT', url: `${BASE}/v2/consumer/workflows/wf_1` });
    expect(JSON.parse(calls[0]!.body!)).toEqual({ status: 'canceled' });
  });

  it('queries a page of workflows by tag', async () => {
    const { orchestration, calls } = client([() => json(200, { next: 'c2', items: [] })]);

    await expect(orchestration.queryWorkflows({ tags: ['mine'], take: 10 })).resolves.toEqual({
      next: 'c2',
      items: [],
    });
    expect(calls[0]!.url).toBe(`${BASE}/v2/consumer/workflows?tags=mine&take=10`);
  });
});
