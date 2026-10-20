import { jsonSchema, tool, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';

import { AgentCore, type AgentCoreRequest } from './agent/core.js';
import type { TurnPart } from './agent/parts.js';
import { applyRunEvent, createPartsDiffer, encodeRunEvent, type RunEvent } from './runner-protocol.js';
import { bodyCut, cutAfter, scriptedModel, text, toolCall, type Scripted } from './test-support/scripted-model.js';

/** What the wire does to an event: it arrives as a copy, parsed from JSON. */
const wire = (event: RunEvent): RunEvent => JSON.parse(JSON.stringify(event)) as RunEvent;

/**
 * Runs the real `AgentCore` on a scripted model, as a runner would, and mirrors its parts through the
 * protocol: on every `change` (or every `every`-th, as a runner that coalesces), the differ's events go
 * over the wire and are applied to a second list. Returns, per mirrored change, the reply's parts and
 * the mirror's, and the events sent.
 */
async function mirror(responses: Scripted[], { every = 1, request = {} }: { every?: number; request?: Partial<AgentCoreRequest> } = {}) {
  const tools: ToolSet = {
    sketch: tool({ inputSchema: jsonSchema<{ subject: string }>({ type: 'object', properties: { subject: { type: 'string' } } }), execute: async ({ subject }) => ({ sketched: subject }) }),
    fail: tool({
      inputSchema: jsonSchema<Record<string, unknown>>({ type: 'object', properties: {} }),
      execute: async (): Promise<unknown> => {
        throw new Error('the sandbox is asleep');
      },
    }),
  };
  const differ = createPartsDiffer();
  const mirrored: TurnPart[] = [];
  const events: RunEvent[] = [];
  const pairs: { reply: TurnPart[]; mirrored: TurnPart[] }[] = [];
  let changes = 0;
  const flush = (parts: readonly TurnPart[]) => {
    for (const event of differ.diff(parts)) {
      events.push(event);
      expect(applyRunEvent(mirrored, wire(event))).toBe(true);
    }
    pairs.push({ reply: structuredClone([...parts]), mirrored: structuredClone(mirrored) });
  };
  const core: AgentCore = new AgentCore({
    describeError: (error) => ({ kind: 'unknown', message: `shown: ${(error as Error).message}` }),
    change: () => {
      if (core.live && ++changes % every === 0) flush(core.live.parts);
    },
  });
  let final: TurnPart[] = [];
  await core.run({
    seq: 1,
    tools: async () => tools,
    request: () => ({ model: scriptedModel(responses), system: 'You draw.', history: [{ role: 'user', content: 'draw' }], maxOutputTokens: 512, networkRetryDelaysMs: [0, 0], ...request }),
    // As a runner does before `run-ended`: what changed since the last flush goes too.
    settled: () => {
      flush(core.live!.parts);
      final = structuredClone(core.live!.parts);
    },
  });
  return { pairs, events, final, mirrored };
}

describe('the parts a runner streams', () => {
  it('rebuild exactly the parts the reply shows, at every step, through text, a tool call and its result', async () => {
    const { pairs, events, final, mirrored } = await mirror([toolCall('sketch', { subject: 'a lighthouse' }), text('Here it ', 'is: a ', 'lighthouse.')]);
    for (const { reply, mirrored: copy } of pairs) expect(copy).toEqual(reply);
    expect(mirrored).toEqual(final);
    expect(final).toEqual([
      { kind: 'tool', toolCallId: 'call_1', toolName: 'sketch', input: { subject: 'a lighthouse' }, state: 'done', output: { sketched: 'a lighthouse' } },
      { kind: 'text', text: 'Here it is: a lighthouse.' },
    ]);
    // Words go as deltas, not as the whole text again.
    expect(events.filter((event) => event.type === 'text-delta').map((event) => (event as { text: string }).text)).toEqual(['Here it ', 'is: a ', 'lighthouse.']);
  });

  it("take back what a step cut by a drop showed, so the step asked again reads once (parts-truncate)", async () => {
    const { pairs, events, final, mirrored } = await mirror([
      toolCall('sketch', { subject: 'a' }),
      cutAfter([{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Your sketch is ' }], bodyCut),
      text('Your sketch is ', 'ready.'),
    ]);
    // The scenario does take parts back: otherwise this test would not exercise the truncation.
    expect(events.some((event) => event.type === 'parts-truncate')).toBe(true);
    for (const { reply, mirrored: copy } of pairs) expect(copy).toEqual(reply);
    expect(mirrored).toEqual(final);
    expect(final.at(-1)).toEqual({ kind: 'text', text: 'Your sketch is ready.' });
  });

  it("follow the last step's words as tool-call syntax is taken out of them, even where they are not a longer copy", async () => {
    const { pairs, events, mirrored, final } = await mirror([toolCall('sketch', { subject: 'a' }), text('Sketched ', 'more <tool_ca', 'll>{"name":"sketch"}</tool_call> end')], { request: { maxSteps: 2 } });
    expect(events.some((event) => event.type === 'parts-truncate')).toBe(true);
    for (const { reply, mirrored: copy } of pairs) expect(copy).toEqual(reply);
    expect(mirrored).toEqual(final);
    expect(JSON.stringify(final)).not.toContain('tool_call');
  });

  it("carry a tool's error as the words the viewer sees", async () => {
    const { mirrored, final } = await mirror([toolCall('fail', {}), text('It failed.')]);
    expect(mirrored).toEqual(final);
    expect(final[0]).toMatchObject({ kind: 'tool', toolName: 'fail', state: 'error', error: 'shown: the sandbox is asleep' });
  });

  it('end the same when a runner coalesces changes and sends them only now and then', async () => {
    const every = await mirror([toolCall('sketch', { subject: 'b' }), text('One ', 'two ', 'three ', 'four.')], { every: 3 });
    const all = await mirror([toolCall('sketch', { subject: 'b' }), text('One ', 'two ', 'three ', 'four.')]);
    expect(every.mirrored).toEqual(all.final);
    expect(every.events.length).toBeLessThan(all.events.length);
  });
});

describe('createPartsDiffer', () => {
  it('sends only what changed since the parts it last saw', () => {
    const differ = createPartsDiffer();
    expect(differ.diff([{ kind: 'text', text: 'ab' }])).toEqual([{ type: 'text-delta', index: 0, text: 'ab' }]);
    expect(
      differ.diff([
        { kind: 'text', text: 'abc' },
        { kind: 'tool', toolCallId: 'k', toolName: 'sketch', input: { s: 1 }, state: 'calling' },
      ]),
    ).toEqual([
      { type: 'text-delta', index: 0, text: 'c' },
      { type: 'tool-call', index: 1, toolCallId: 'k', toolName: 'sketch', input: { s: 1 } },
    ]);
    expect(differ.diff([{ kind: 'text', text: 'abc' }, { kind: 'tool', toolCallId: 'k', toolName: 'sketch', input: { s: 1 }, state: 'done', output: 7 }])).toEqual([{ type: 'tool-result', toolCallId: 'k', output: 7 }]);
    expect(differ.diff([{ kind: 'text', text: 'abc' }, { kind: 'tool', toolCallId: 'k', toolName: 'sketch', input: { s: 1 }, state: 'done', output: 7 }])).toEqual([]);
    expect(differ.diff([{ kind: 'text', text: 'xy' }])).toEqual([{ type: 'parts-truncate', length: 0 }, { type: 'text-delta', index: 0, text: 'xy' }]);
  });

  it('starts from the parts run-started carried', () => {
    const differ = createPartsDiffer([{ kind: 'text', text: 'Saved.' }]);
    expect(differ.diff([{ kind: 'text', text: 'Saved. More.' }])).toEqual([{ type: 'text-delta', index: 0, text: ' More.' }]);
  });
});

describe('applyRunEvent', () => {
  it('refuses an event that does not fit the parts, so the client reads the journal again', () => {
    const parts: TurnPart[] = [{ kind: 'tool', toolCallId: 'k', toolName: 'sketch', input: {}, state: 'calling' }];
    expect(applyRunEvent(parts, { type: 'tool-call', index: 3, toolCallId: 'z', toolName: 'sketch', input: {} })).toBe(false);
    expect(applyRunEvent(parts, { type: 'text-delta', index: 0, text: 'x' })).toBe(false);
    expect(applyRunEvent(parts, { type: 'tool-result', toolCallId: 'nope', output: 1 })).toBe(false);
    expect(applyRunEvent(parts, { type: 'parts-truncate', length: 2 })).toBe(false);
    expect(parts).toEqual([{ kind: 'tool', toolCallId: 'k', toolName: 'sketch', input: {}, state: 'calling' }]);
  });

  it('starts over from run-started, and leaves the parts alone for events that edit none', () => {
    const parts: TurnPart[] = [{ kind: 'text', text: 'stale' }];
    expect(applyRunEvent(parts, { type: 'run-started', v: 1, runId: 'r', conversationId: 'c', seq: 2, user: { content: 'hi', attachments: [] }, parts: [{ kind: 'text', text: 'Saved.' }] })).toBe(true);
    expect(applyRunEvent(parts, { type: 'checkpoint', savedAt: '2026-10-19T00:00:00Z' })).toBe(true);
    expect(applyRunEvent(parts, { type: 'step-finished', steps: 1, calledTools: false })).toBe(true);
    expect(parts).toEqual([{ kind: 'text', text: 'Saved.' }]);
  });
});

describe('encodeRunEvent', () => {
  it('is one SSE message: its journal id, then the event as JSON', () => {
    expect(encodeRunEvent(12, { type: 'text-delta', index: 0, text: 'hi\nthere' })).toBe('id: 12\ndata: {"type":"text-delta","index":0,"text":"hi\\nthere"}\n\n');
  });
});
