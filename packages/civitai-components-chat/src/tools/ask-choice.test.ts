import type { WorkflowTemplate } from '@civitai/sdk';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../agent/agent.js';
import { JobManager } from '../orchestration/jobs.js';
import { ThreadStore } from '../store/thread-store.js';
import { workflow } from '../test-support/fakes.js';
import { ASK_CHOICE, buildToolSet, type TurnToolContext } from './build.js';
import { normalizeChoice } from './choice.js';

/**
 * Run (a) turn 1 of the App Assistant evaluation: `options` as a JSON string with a stray trailing
 * `}`, so it does not parse. The card rendered nothing while the tool reported `shown: true`.
 */
const MALFORMED =
  '[{"label": "Manual switch", "description": "You start each break yourself"}, {"label": "Auto cycle", "description": "Breaks start on their own"}, {"label": "4-work long break", "description": "A long break after every 4 sessions"}]}';

function askChoice() {
  const ctx = {
    conversationId: 'C1',
    seq: 1,
    posts: { available: false },
    findAttachment: () => undefined,
    resolveArgs: async (args: Record<string, unknown>) => args,
    onCaption: () => undefined,
  } as unknown as TurnToolContext;
  const tools = buildToolSet({ orchestration: [], site: [] }, ctx);
  return { tools, run: (input: unknown) => (tools[ASK_CHOICE] as unknown as { execute: (input: unknown, opts: unknown) => Promise<unknown> }).execute(input, { toolCallId: 'c', messages: [] }) };
}

describe('ask_choice', () => {
  it('refuses the malformed options string the evaluation saw, instead of reporting it shown', async () => {
    const result = await askChoice().run({ question: 'How should breaks work?', options: MALFORMED });
    expect(result).toEqual({
      error: 'options must be an array of 2 to 4 objects, each with a "label" string.',
      note: 'Nothing was shown. Call ask_choice again with options as an array.',
    });
  });

  it('shows options sent as a JSON string that parses, and ends the reply', async () => {
    const result = await askChoice().run({ question: 'Which?', options: '[{"label":"Cozy"},{"label":"Moody"}]' });
    expect(result).toMatchObject({ shown: true, awaitsUser: true });
  });

  it('refuses fewer than 2, more than 4, or an option without a label', async () => {
    const { run } = askChoice();
    for (const options of [[{ label: 'Only' }], [1, 2, 3, 4, 5].map((n) => ({ label: `O${n}` })), [{ label: 'A' }, { description: 'no label' }], [{ label: 'A' }, { label: '  ' }]]) {
      expect(await run({ question: 'Q', options })).toHaveProperty('error');
    }
  });
});

describe('normalizeChoice', () => {
  it('reads an array or a parseable string the same way, keeping only known fields', () => {
    const expected = { question: 'Which?', options: [{ label: 'A', description: 'first' }, { label: 'B', image: 'gen1-1-1' }] };
    expect(normalizeChoice({ question: 'Which?', options: [{ label: 'A', description: 'first', extra: 1 }, { label: 'B', image: 'gen1-1-1' }] })).toEqual(expected);
    expect(normalizeChoice({ question: 'Which?', options: JSON.stringify(expected.options) })).toEqual(expected);
  });

  it('gives null for anything the card could not show', () => {
    expect(normalizeChoice({ question: 'Q', options: MALFORMED })).toBeNull();
    expect(normalizeChoice({ question: 'Q', options: 'Cozy, Moody' })).toBeNull();
    expect(normalizeChoice(undefined)).toBeNull();
  });
});

describe('an ask_choice the card could not show', () => {
  it('does not end the reply, so the assistant can ask again correctly', async () => {
    const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
    const call = (id: string, options: unknown) => [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: id, toolName: ASK_CHOICE, input: JSON.stringify({ question: 'How should breaks work?', options }) },
      { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
    ];
    const responses = [call('bad', MALFORMED), call('good', [{ label: 'Manual switch' }, { label: 'Auto cycle' }]), call('never', [])];
    let requests = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        requests++;
        return { stream: convertArrayToReadableStream(responses.shift()!) as never };
      },
      doGenerate: async () => ({ content: [{ type: 'text', text: 'T' }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }),
    });
    const store = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async (_: WorkflowTemplate) => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
    });
    const { tools } = askChoice();
    const agent = new Agent({ model: () => model, store, jobs: new JobManager({} as never), toolSet: async () => tools, attachments: () => [] });

    await agent.send('build me a pomodoro timer');

    // The bad call went back to the model as an error, the good one ended the reply.
    expect(requests).toBe(2);
    const results = store.current!.turns[0]!.assistant.messages.filter((m) => m.role === 'tool').map((m) => (m.content[0] as { output: { value: unknown } }).output.value);
    expect(results[0]).toHaveProperty('error');
    expect(results[1]).toMatchObject({ shown: true, awaitsUser: true });
  });
});
