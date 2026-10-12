import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('free chat replies without AbortSignal.any', () => {
  // Safari before 17.4, Chrome before 116 and Firefox before 124 have no AbortSignal.any.
  const any = AbortSignal.any;
  beforeEach(() => {
    delete (AbortSignal as { any?: unknown }).any;
  });
  afterEach(() => {
    AbortSignal.any = any;
  });

  const send = (doFetch: typeof fetch, signal: AbortSignal) => doFetch('https://orch/v1/chat/completions', { method: 'POST', body: '{"model":"x"}', signal });

  it('sends a free reply, and it reads in full', async () => {
    for (const payWhenOut of [false, true]) {
      const tier = await loaded();
      const { calls, inner } = endpoint({ free: () => new Response('data: {"text":"hello"}\n\n', { status: 200 }) });

      const response = await send(freeTierFetch(inner, QWEN, tier, () => ({ useFree: true, payWhenOut })), new AbortController().signal);

      expect(calls).toEqual(['free']);
      expect(await response.text()).toBe('data: {"text":"hello"}\n\n');
    }
  });

  it('stops a free reply when the caller aborts, even after it has started', async () => {
    for (const payWhenOut of [false, true]) {
      const tier = await loaded();
      const seen: AbortSignal[] = [];
      const open = (signal: AbortSignal) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('data: {"text":"he"}\n\n'));
              signal.addEventListener('abort', () => stream.error(signal.reason));
            },
          }),
          { status: 200 },
        );
      const inner = (async (_input: RequestInfo | URL, init?: RequestInit) => (seen.push(init!.signal!), open(init!.signal!))) as typeof fetch;
      const caller = new AbortController();

      const response = await send(freeTierFetch(inner, QWEN, tier, () => ({ useFree: true, payWhenOut })), caller.signal);
      const reader = response.body!.getReader();
      await reader.read();
      caller.abort(new Error('stopped by the viewer'));

      expect(seen[0]!.aborted).toBe(true);
      await expect(reader.read()).rejects.toThrow('stopped by the viewer');
    }
  });

  it('never sends a free reply the caller stopped before it went out', async () => {
    const caller = new AbortController();
    const stop = new Error('stopped while the allowance loaded');
    // The viewer presses Stop while the chat is still asking how many free replies are left.
    const tier = new FreeTier(async () => {
      caller.abort(stop);
      return status();
    });
    const seen: AbortSignal[] = [];
    // Like fetch: an aborted signal rejects with its reason; otherwise the reply would arrive.
    const inner = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(init!.signal!);
      if (init!.signal!.aborted) throw init!.signal!.reason;
      return new Response('data: {"text":"hello"}\n\n', { status: 200 });
    }) as typeof fetch;

    await expect(send(freeTierFetch(inner, QWEN, tier, () => ({ useFree: true, payWhenOut: false })), caller.signal)).rejects.toBe(stop);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.reason).toBe(stop);
  });
});
