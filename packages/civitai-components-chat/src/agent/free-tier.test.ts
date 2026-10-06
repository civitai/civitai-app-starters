import { describe, expect, it, vi } from 'vitest';

import { humanize } from '../ux/humanize.js';
import { FreeTier, freeTierFetch, type FreeTierStatus } from './free-tier.js';

const QWEN = 'urn:air:qwen3:repository:huggingface:gittensor-model-hub/Qwen3.8-27B-NVFP4-RTX5090@main.tar';
const RESET = '2026-10-07T14:55:36Z';

function status(remaining = 3): FreeTierStatus {
  return { enabled: true, models: [{ key: 'qwen3.8-chat', airs: [QWEN], remaining, windows: [{ limit: 200, remaining, resetAt: RESET }] }] };
}

async function loaded(remaining = 3): Promise<FreeTier> {
  const tier = new FreeTier(async () => status(remaining));
  await tier.refresh();
  return tier;
}

/** A chat endpoint that records each request's tier and answers per tier. */
function endpoint(answers: { free?: () => Response; paid?: () => Response } = {}) {
  const calls: ('free' | 'paid')[] = [];
  const inner = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const tier = new Headers(init?.headers).get('X-Civitai-Tier') === 'free' ? 'free' : 'paid';
    calls.push(tier);
    return (tier === 'free' ? answers.free : answers.paid)?.() ?? new Response('data: {"ok":true}\n\n', { status: 200 });
  });
  return { calls, inner: inner as unknown as typeof fetch };
}

const request = (doFetch: typeof fetch) => doFetch('https://orch/v1/chat/completions', { method: 'POST', body: '{"model":"x"}' });

describe('free chat replies', () => {
  it('goes out free while the model has allowance left, and paid for a model without one', async () => {
    const tier = await loaded();
    const { calls, inner } = endpoint();

    await request(freeTierFetch(inner, QWEN, tier, () => ({ useFree: true, payWhenOut: false })));
    await request(freeTierFetch(inner, 'z-ai/glm-5.3-flash', tier, () => ({ useFree: true, payWhenOut: false })));
    await request(freeTierFetch(inner, QWEN, tier, () => ({ useFree: false, payWhenOut: false })));

    expect(calls).toEqual(['free', 'paid', 'paid']);
  });

  it('never pays without permission: a used-up allowance becomes an error that says until when', async () => {
    const tier = await loaded();
    const { calls, inner } = endpoint({ free: () => new Response('', { status: 429 }) });

    const response = await request(freeTierFetch(inner, QWEN, tier, () => ({ useFree: true, payWhenOut: false })));
    expect(calls).toEqual(['free']);
    expect(response.status).toBe(400);

    const failed = humanize(new Error(((await response.json()) as { error: { message: string } }).error.message));
    expect(failed.kind).toBe('free_tier_exhausted');
    expect(failed.message).toMatch(/^Your free replies are used up until .+\.$/);

    await request(freeTierFetch(inner, QWEN, tier, () => ({ useFree: true, payWhenOut: false })));
    expect(calls).toEqual(['free']);
  });

  it('switches to paid by itself when the viewer allows it', async () => {
    const tier = await loaded();
    const { calls, inner } = endpoint({ free: () => new Response('', { status: 429 }) });

    const response = await request(freeTierFetch(inner, QWEN, tier, () => ({ useFree: true, payWhenOut: true })));

    expect(response.status).toBe(200);
    expect(calls).toEqual(['free', 'paid']);
    expect(tier.available(QWEN)).toBe(false);
  });

  it('gives up on a free reply that is slow to start, but only for a viewer who allows paying', async () => {
    const stalled = () => new Response(new ReadableStream({ start() {} }), { status: 200 });
    const tier = await loaded();
    const allowed = endpoint({ free: stalled });
    const response = await request(freeTierFetch(allowed.inner, QWEN, tier, () => ({ useFree: true, payWhenOut: true }), 20));
    expect(allowed.calls).toEqual(['free', 'paid']);
    expect(await response.text()).toContain('ok');

    const waiting = endpoint({ free: stalled });
    await request(freeTierFetch(waiting.inner, QWEN, tier, () => ({ useFree: true, payWhenOut: false }), 20));
    expect(waiting.calls).toEqual(['free']);
  });

  it('passes a free reply through untouched once it starts', async () => {
    const tier = await loaded();
    const { inner } = endpoint({ free: () => new Response('data: {"text":"hello"}\n\ndata: [DONE]\n\n', { status: 200 }) });

    const response = await request(freeTierFetch(inner, QWEN, tier, () => ({ useFree: true, payWhenOut: true })));

    expect(await response.text()).toBe('data: {"text":"hello"}\n\ndata: [DONE]\n\n');
  });

  it('keeps the count current from the RateLimit header, one entry per window', async () => {
    const tier = await loaded(200);
    tier.note(new Headers({ RateLimit: '"buzz";r=940;t=12, "qwen3.8-chat-3600s";r=18;t=600, "qwen3.8-chat-86400s";r=187;t=3600' }));

    expect(tier.modelFor(QWEN)?.remaining).toBe(18);
  });
});
