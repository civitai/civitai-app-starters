import { jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../agent/agent.js';
import { JobManager } from '../orchestration/jobs.js';
import { fakeHeads, tabStorage } from '../test-support/fake-heads.js';
import type { Turn } from '../types.js';
import { CUT_OFF, ThreadStore, replyElsewhere } from './thread-store.js';

/**
 * The per-step checkpoint: as a reply runs, its head is saved after each step that ran a tool, as v3
 * with the reply `running`, its finished steps and that save's time; how it ends is saved as before.
 */

type StreamPart = Record<string, unknown>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
const callsNote = (id: string, text: string): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: id, toolName: 'note', input: JSON.stringify({ text }) },
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];
const says = (words: string): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: words },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];

const NOW = Date.parse('2026-10-19T15:00:00Z');
const at = (ms: number) => () => new Date(ms);

type Head = { v: number; title: string; model?: string; posts?: Record<string, unknown>; turns: { seq: number; assistant?: { status: string; messages: { role: string; content: unknown }[]; savedAt?: string } }[] };
const roles = (head: Head, seq = 1) => head.turns.find((t) => t.seq === seq)?.assistant?.messages.map((m) => m.role);
const calls = (head: Head) => JSON.stringify(head).match(/"toolCallId":"call_\d"/g) ?? [];

/**
 * A tab: an agent and its store on the shared `heads`. Step `k` of the model is asked for only once the
 * store has written `k - 1` checkpoints, so each step's checkpoint is its own write.
 */
/** A step whose answer starts and never ends: the tab running it dies there. */
const HANGS = 'hangs' as const;

function tab(heads = fakeHeads(), steps: (StreamPart[] | typeof HANGS)[] = [callsNote('call_1', 'one'), callsNote('call_2', 'two'), says('All done.')], options: { noteWaits?: () => Promise<void>; now?: () => Date; own?: ReturnType<typeof tabStorage> } = {}) {
  const ran: string[] = [];
  let asked = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      asked++;
      const step = asked;
      await vi.waitFor(() => expect(heads.writes.length).toBeGreaterThanOrEqual(step - 1));
      const next = steps.shift() ?? says('…');
      if (next === HANGS) return { stream: new ReadableStream<StreamPart>({ start: (c) => c.enqueue({ type: 'stream-start', warnings: [] }) }) as never };
      return { stream: convertArrayToReadableStream(next) as never };
    },
  });
  const tools: ToolSet = {
    note: tool({
      inputSchema: jsonSchema<{ text: string }>({ type: 'object', properties: { text: { type: 'string' } } }),
      execute: async ({ text }) => {
        ran.push(text);
        if (text === 'two') await options.noteWaits?.();
        return { ok: true, text };
      },
    }),
  };
  const own = options.own ?? tabStorage();
  const store = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, now: options.now ?? at(NOW), newId: () => 'CONV1', ownReplies: own });
  const agent = new Agent({ model: () => model, titleModel: () => model, store, jobs: new JobManager({} as never), toolSet: async () => tools, attachments: () => [] });
  agent.addEventListener('error', () => undefined);
  return { heads, store, agent, ran, own };
}

describe('checkpoint after each step', () => {
  it('saves the head after each step that ran a tool as v3 running, with exactly the steps that finished, then how it ended', async () => {
    const { heads, agent, ran } = tab();
    await agent.send('take notes');
    const written = heads.writes.map((w) => w.metadata as unknown as Head);
    expect(written).toHaveLength(3);
    expect(written.map((h) => [h.v, h.turns[0]!.assistant?.status, h.turns[0]!.assistant?.savedAt])).toEqual([
      [3, 'running', new Date(NOW).toISOString()],
      [3, 'running', new Date(NOW).toISOString()],
      [2, 'done', undefined],
    ]);
    expect(roles(written[0]!)).toEqual(['assistant', 'tool']);
    expect(calls(written[0]!)).toEqual(['"toolCallId":"call_1"', '"toolCallId":"call_1"']);
    expect(roles(written[1]!)).toEqual(['assistant', 'tool', 'assistant', 'tool']);
    expect(roles(written[2]!)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant']);
    expect(ran).toEqual(['one', 'two']);
  });

  it('a step that ran no tool is the last, and is saved only as the reply ends', async () => {
    const { heads, agent } = tab(fakeHeads(), [says('Just words.')]);
    await agent.send('hello');
    expect(heads.writes.map((w) => [(w.metadata as unknown as Head).v, (w.metadata as unknown as Head).turns[0]!.assistant?.status])).toEqual([[2, 'done']]);
  });

  it('writes the end as it ended: a reply that failed after a step is saved as an error with that step, not running', async () => {
    const heads = fakeHeads();
    const failing = new MockLanguageModelV3({
      doStream: vi
        .fn()
        .mockResolvedValueOnce({ stream: convertArrayToReadableStream(callsNote('call_1', 'one')) })
        .mockRejectedValueOnce(Object.assign(new Error('Insufficient buzz'), { statusCode: 402 })),
    });
    const { store } = tab(heads);
    const agent = new Agent({ model: () => failing, store, jobs: new JobManager({} as never), toolSet: async () => ({ note: tool({ inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => ({ ok: true }) }) }), attachments: () => [] });
    agent.addEventListener('error', () => undefined);
    await agent.send('take notes');
    const last = heads.writes.at(-1)!.metadata as unknown as Head;
    expect([last.v, last.turns[0]!.assistant?.status]).toEqual([2, 'error']);
    expect(roles(last)).toEqual(['assistant', 'tool']);
  });
});

describe('single writer in this tab', () => {
  it('a title, model and post set while the reply runs are in its next checkpoint and its end, and the post save keeps the reply running', async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (release = resolve));
    const { heads, store, agent } = tab(fakeHeads(), undefined, { noteWaits: () => waiting });
    const done = agent.send('take notes');
    await vi.waitFor(() => expect(heads.writes).toHaveLength(1));
    // Step 2's tool is running: the viewer renames the chat, picks a model, and a post finishes.
    await store.setTitle('Renamed by hand', 'user');
    await store.setModel('model-x');
    await store.savePost('call_post', { status: 'posted', url: 'https://civitai.com/posts/1' } as never);
    release();
    await done;
    const written = heads.writes.map((w) => w.metadata as unknown as Head);
    // The post's own save, mid-reply: the reply as it was, running with its first step, not dropped.
    const postSave = written[1]!;
    expect([postSave.v, postSave.turns[0]!.assistant?.status, postSave.title, postSave.model]).toEqual([3, 'running', 'Renamed by hand', 'model-x']);
    expect(roles(postSave)).toEqual(['assistant', 'tool']);
    for (const head of written.slice(2)) {
      expect([head.title, head.model, Object.keys(head.posts ?? {})]).toEqual(['Renamed by hand', 'model-x', ['call_post']]);
    }
    expect([written.at(-1)!.v, written.at(-1)!.turns[0]!.assistant?.status]).toEqual([2, 'done']);
    expect(roles(written.at(-2)!)).toEqual(['assistant', 'tool', 'assistant', 'tool']);
  });
});

describe('how often it saves', () => {
  it('has at most one checkpoint waiting per head: steps that finish while it waits ride on it, built from the latest', async () => {
    const heads = fakeHeads();
    const { store } = tab(heads);
    const turn: Turn = store.appendUserTurn('take notes', []);
    await vi.waitFor(() => expect(heads.workflows.size).toBe(1));
    const release = heads.hold();
    const step = (n: number) => Array.from({ length: n }, (_, i) => [{ role: 'assistant' as const, content: `step ${i + 1}` }]).flat();
    const first = store.checkpoint(turn, { messages: step(1), force: true });
    await vi.waitFor(() => expect(heads.started.count).toBe(1));
    // The first write is out (built, held). A second step finishes and its save waits; then the viewer
    // renames the chat and two more steps finish, all before that save goes.
    const second = store.checkpoint(turn, { messages: step(2), force: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await store.setTitle('Renamed while it waited', 'user');
    const more = [store.checkpoint(turn, { messages: step(3), force: true }), store.checkpoint(turn, { messages: step(4), force: true })];
    release();
    await Promise.all([first, second, ...more]);
    const written = heads.writes.map((w) => w.metadata as unknown as Head);
    // Two writes, the second built as it went: every step, and the new title.
    expect(written.map((h) => [h.turns[0]!.assistant?.messages.length, h.title])).toEqual([
      [1, 'take notes'],
      [4, 'Renamed while it waited'],
    ]);
  });

  it('keeps progress that is not saved at once for the next save', async () => {
    const heads = fakeHeads();
    const { store } = tab(heads);
    const turn = store.appendUserTurn('take notes', []);
    await vi.waitFor(() => expect(heads.workflows.size).toBe(1));
    await store.checkpoint(turn, { messages: [{ role: 'assistant', content: 'thinking' }], force: false });
    expect(heads.writes).toHaveLength(0);
    await store.savePost('call_post', { status: 'posted' } as never);
    expect(heads.writes.map((w) => (w.metadata as unknown as Head).turns[0]!.assistant)).toMatchObject([{ status: 'running', messages: [{ content: 'thinking' }] }]);
  });
});

describe("a reload of the tab that ran the reply", () => {
  /** Tab A runs the reply's first two steps and dies on the third; returns the store's tab note. */
  async function diedMidReply(heads: ReturnType<typeof fakeHeads>, own: ReturnType<typeof tabStorage>) {
    const { agent } = tab(heads, [callsNote('call_1', 'one'), callsNote('call_2', 'two'), HANGS], { own });
    void agent.send('take notes');
    await vi.waitFor(() => expect(heads.writes).toHaveLength(2));
  }

  it('reads its own unfinished reply as gone at once, though its last save is a minute old', async () => {
    const heads = fakeHeads();
    const own = tabStorage();
    await diedMidReply(heads, own);
    // The same tab, reloaded a minute later: a new store on the same sessionStorage.
    const reloaded = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, now: at(NOW + 60_000), ownReplies: own });
    const { conversation } = await reloaded.open('CONV1');
    const turn = conversation.turns.at(-1)!;
    expect([turn.assistant.status, turn.assistant.error, turn.assistant.orphaned]).toEqual(['error', CUT_OFF, true]);
    expect(replyElsewhere(turn, NOW + 60_000)).toBe('stale');
    expect(turn.assistant.resume?.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool']);
  });

  it('another tab, with no such note, reads it as still replying while the save is fresh', async () => {
    const heads = fakeHeads();
    await diedMidReply(heads, tabStorage());
    const other = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, now: at(NOW + 60_000), ownReplies: tabStorage() });
    const turn = (await other.open('CONV1')).conversation.turns.at(-1)!;
    expect(turn.assistant.orphaned).toBeUndefined();
    expect(replyElsewhere(turn, NOW + 60_000)).toBe('live');
  });

  it('a save newer than its note is someone else’s: the time rule decides', async () => {
    const heads = fakeHeads();
    const own = tabStorage();
    await diedMidReply(heads, own);
    // Another tab carried the reply on and saved it two minutes later.
    const wf = [...heads.workflows.values()][0]!;
    const turns = (wf.metadata as unknown as Head).turns;
    turns[0]!.assistant!.savedAt = new Date(NOW + 120_000).toISOString();
    const reloaded = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, now: at(NOW + 180_000), ownReplies: own });
    const turn = (await reloaded.open('CONV1')).conversation.turns.at(-1)!;
    expect(turn.assistant.orphaned).toBeUndefined();
    expect(replyElsewhere(turn, NOW + 180_000)).toBe('live');
  });

  it('forgets the note once the reply ended', async () => {
    const { agent, own } = tab();
    await agent.send('take notes');
    expect([...own.entries.keys()]).toEqual([]);
  });
});
