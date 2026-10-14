import type { ToolSet } from 'ai';
import { nothing } from 'lit';
import { describe, expect, it, vi } from 'vitest';

import { BUILT_IN_VIEWS, type ToolPart, type ToolViewContext } from '../components/tool-views.js';
import { ASK_CHOICE } from './build.js';
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

  it('still runs an allowed call that was not stopped', async () => {
    const execute = vi.fn(async () => 'ran');
    const tools = gateToolSet({ run_step: { execute } } as unknown as ToolSet, { conversationId: 'c', gate: async () => ({ allow: true }), onResult: () => undefined });
    expect(await tools.run_step!.execute!({}, { toolCallId: 't', messages: [], abortSignal: new AbortController().signal })).toBe('ran');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('the ask_choice card', () => {
  const ctx = { resolve: () => undefined, latest: true, live: false } as unknown as ToolViewContext;
  const part = (extra: Partial<ToolPart>): ToolPart => ({
    kind: 'tool',
    toolCallId: 'a',
    toolName: ASK_CHOICE,
    input: { question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] },
    state: 'done',
    ...extra,
  });

  it('shows nothing for a call the page refused', () => {
    expect(BUILT_IN_VIEWS[ASK_CHOICE]!.render!(part({ output: { error: 'Not on this page.', note: 'x' } }), ctx)).toBe(nothing);
    expect(BUILT_IN_VIEWS[ASK_CHOICE]!.render!(part({ state: 'error', error: 'boom' }), ctx)).toBe(nothing);
  });

  it('shows the options for a call that went through', () => {
    expect(BUILT_IN_VIEWS[ASK_CHOICE]!.render!(part({ output: { shown: true } }), ctx)).not.toBe(nothing);
  });
});
