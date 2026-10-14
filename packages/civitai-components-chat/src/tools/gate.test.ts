import type { ToolSet } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { gateToolSet, type ChatToolDecision } from './gate.js';

describe('gateToolSet', () => {
  it('runs nothing when the reply was stopped while the gate decided, even if it then allows', async () => {
    const execute = vi.fn(async () => 'ran');
    let answer!: (decision: ChatToolDecision) => void;
    let seen: AbortSignal | undefined;
    const gate = vi.fn((_name: string, _input: unknown, context: { signal?: AbortSignal }) => {
      seen = context.signal;
      return new Promise<ChatToolDecision>((resolve) => (answer = resolve));
    });
    const results: unknown[] = [];
    const tools = gateToolSet({ run_step: { execute } } as unknown as ToolSet, { conversationId: 'c', gate, onResult: (r) => results.push(r) });
    const stop = new AbortController();
    const call = tools.run_step!.execute!({}, { toolCallId: 't', messages: [], abortSignal: stop.signal });
    await Promise.resolve();
    stop.abort();
    answer({ allow: true });
    await expect(call).rejects.toBeDefined();
    expect(execute).not.toHaveBeenCalled();
    expect(seen).toBe(stop.signal);
    expect(results).toEqual([{ name: 'run_step', input: {}, output: { error: 'The reply was stopped before this call ran.' }, isError: true }]);
  });

  it('ends the call as soon as the reply is stopped, even when the gate never answers', async () => {
    const execute = vi.fn(async () => 'ran');
    const gate = () => new Promise<ChatToolDecision>(() => undefined);
    const tools = gateToolSet({ run_step: { execute } } as unknown as ToolSet, { conversationId: 'c', gate, onResult: () => undefined });
    const stop = new AbortController();
    const call = tools.run_step!.execute!({}, { toolCallId: 't', messages: [], abortSignal: stop.signal }) as Promise<unknown>;
    stop.abort();
    const settled = await Promise.race([call.then(() => 'resolved', () => 'rejected'), new Promise((resolve) => setTimeout(() => resolve('still waiting'), 500))]);
    expect(settled).toBe('rejected');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not warn about a gate that rejects because the reply was stopped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const gate = (_name: string, _input: unknown, { signal }: { signal?: AbortSignal }) =>
        new Promise<ChatToolDecision>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped'))));
      const tools = gateToolSet({ run_step: { execute: async () => 'ran' } } as unknown as ToolSet, { conversationId: 'c', gate, onResult: () => undefined });
      const stop = new AbortController();
      const call = tools.run_step!.execute!({}, { toolCallId: 't', messages: [], abortSignal: stop.signal }) as Promise<unknown>;
      stop.abort();
      await expect(call).rejects.toBeDefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('still runs an allowed call that was not stopped', async () => {
    const execute = vi.fn(async () => 'ran');
    const tools = gateToolSet({ run_step: { execute } } as unknown as ToolSet, { conversationId: 'c', gate: async () => ({ allow: true }), onResult: () => undefined });
    expect(await tools.run_step!.execute!({}, { toolCallId: 't', messages: [], abortSignal: new AbortController().signal })).toBe('ran');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
