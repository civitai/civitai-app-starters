import { jsonSchema, tool, type ToolSet } from 'ai';
import { MockLanguageModelV3, convertArrayToReadableStream } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../agent/agent.js';
import { JobManager } from '../orchestration/jobs.js';
import { fakeHeads, fakeLocks, tabStorage } from '../test-support/fake-heads.js';
import type { Turn } from '../types.js';
import { CUT_OFF, INTERRUPTED_CALL, ThreadStore, replyElsewhere } from './thread-store.js';

/**
 * The per-step checkpoint: as a reply runs, its head is saved as v3 with the reply `running`, every step
 * that finished, the step now running as far as its tool calls go, and that save's time; how it ends is
 * saved as before. A tab running a reply holds a Web Lock for it, which tells a copy of the tab, or the
 * tab reloaded, whether it still runs.
 */

type StreamPart = Record<string, unknown>;
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
/** A step that calls each of `calls` (`[toolCallId, toolName, text]`). */
const callsTools = (...calls: [string, string, string][]): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  ...calls.map(([toolCallId, toolName, text]) => ({ type: 'tool-call', toolCallId, toolName, input: JSON.stringify({ text }) })),
  { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
];
const callsNote = (id: string, text: string) => callsTools([id, 'note', text]);
const says = (words: string): StreamPart[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  { type: 'text-delta', id: 't', delta: words },
  { type: 'text-end', id: 't' },
  { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
];
/** A step whose answer starts and never ends: the tab running it dies there. */
const HANGS = 'hangs' as const;

const NOW = Date.parse('2026-10-19T15:00:00Z');
const at = (ms: number) => () => new Date(ms);

type Part = { type: string; toolCallId?: string; output?: { type: string; value: unknown } };
type Message = { role: string; content: string | Part[] };
type Head = { v: number; title: string; model?: string; posts?: Record<string, unknown>; turns: { seq: number; assistant?: { status: string; messages: Message[]; savedAt?: string } }[] };
const headOf = (write: { metadata: Record<string, unknown> }) => write.metadata as unknown as Head;
const roles = (head: Head, seq = 1) => head.turns.find((t) => t.seq === seq)?.assistant?.messages.map((m) => m.role);
/** The tool results a head holds for the turn, by call id. */
const results = (head: Head | undefined) =>
  (head?.turns[0]?.assistant?.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'tool-result').map((p) => p.toolCallId);

/**
 * A tab: an agent and its store on the shared `heads`. Step `k` of the model is asked for only once the
 * head holds `k - 1` tool results, so every step starts from a saved state.
 */
function tab(
  heads = fakeHeads(),
  steps: (StreamPart[] | typeof HANGS)[] = [callsNote('call_1', 'one'), callsNote('call_2', 'two'), says('All done.')],
  options: { noteWaits?: () => Promise<void>; now?: () => Date; own?: ReturnType<typeof tabStorage>; locks?: Pick<LockManager, 'request' | 'query'> | null } = {},
) {
  const ran: string[] = [];
  let asked = 0;
  const model = new MockLanguageModelV3({
    doStream: async () => {
      asked++;
      const step = asked;
      await vi.waitFor(() => expect(results(heads.writes.at(-1) && headOf(heads.writes.at(-1)!)).length).toBeGreaterThanOrEqual(step - 1));
      const next = steps.shift() ?? says('…');
      if (next === HANGS) return { stream: new ReadableStream<StreamPart>({ start: (c) => c.enqueue({ type: 'stream-start', warnings: [] }) }) as never };
      return { stream: convertArrayToReadableStream(next) as never };
    },
  });
  const run = (name: string) => ({ text }: { text: string }) => {
    ran.push(`${name}:${text}`);
    return { ok: true, text };
  };
  const tools: ToolSet = {
    note: tool({
      inputSchema: jsonSchema<{ text: string }>({ type: 'object', properties: { text: { type: 'string' } } }),
      execute: async (input) => {
        const out = run('note')(input);
        if (input.text === 'two') await options.noteWaits?.();
        return out;
      },
    }),
    x: tool({ inputSchema: jsonSchema<{ text: string }>({ type: 'object', properties: { text: { type: 'string' } } }), execute: async (input) => ({ ...run('x')(input), made: 'x-result-7' }) }),
    // Starts and never finishes: the tab dies while it runs.
    hang: tool({ inputSchema: jsonSchema<{ text: string }>({ type: 'object', properties: { text: { type: 'string' } } }), execute: (input) => (run('hang')(input), new Promise(() => {})) }),
  };
  const own = options.own ?? tabStorage();
  const store = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, now: options.now ?? at(NOW), newId: () => 'CONV1', ownReplies: own, locks: options.locks ?? null });
  const agent = new Agent({ model: () => model, titleModel: () => model, store, jobs: new JobManager({} as never), toolSet: async () => tools, attachments: () => [] });
  agent.addEventListener('error', () => undefined);
  return { heads, store, agent, ran, own };
}

describe('checkpoint as the reply runs', () => {
  it('saves the head as v3 running as each tool call starts and lands and each step finishes, with exactly the steps so far, then how it ended', async () => {
    const { heads, agent, ran } = tab();
    await agent.send('take notes');
    const written = heads.writes.map(headOf);
    const last = written.at(-1)!;
    expect([last.v, last.turns[0]!.assistant?.status, roles(last)]).toEqual([2, 'done', ['assistant', 'tool', 'assistant', 'tool', 'assistant']]);
    const during = written.slice(0, -1);
    expect(during.length).toBeGreaterThanOrEqual(2);
    for (const head of during) expect([head.v, head.turns[0]!.assistant?.status, head.turns[0]!.assistant?.savedAt]).toEqual([3, 'running', new Date(NOW).toISOString()]);
    // The first step with its result, then both: each save holds exactly what had happened by then.
    expect(during.map((h) => results(h))).toContainEqual(['call_1']);
    expect(during.map((h) => roles(h))).toContainEqual(['assistant', 'tool']);
    expect(during.map((h) => results(h))).toContainEqual(['call_1', 'call_2']);
    expect(during.map((h) => roles(h))).toContainEqual(['assistant', 'tool', 'assistant', 'tool']);
    expect(during.every((h) => roles(h)!.length <= 4)).toBe(true);
    expect(ran).toEqual(['note:one', 'note:two']);
  });

  it('a step that ran no tool is the last, and is saved only as the reply ends', async () => {
    const { heads, agent } = tab(fakeHeads(), [says('Just words.')]);
    await agent.send('hello');
    expect(heads.writes.map((w) => [headOf(w).v, headOf(w).turns[0]!.assistant?.status])).toEqual([[2, 'done']]);
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
    const last = headOf(heads.writes.at(-1)!);
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
    // Step 2's tool has started and is running.
    await vi.waitFor(() => expect(JSON.stringify(heads.writes.at(-1)?.metadata ?? {})).toContain('"toolCallId":"call_2"'));
    const before = heads.writes.length;
    await store.setTitle('Renamed by hand', 'user');
    await store.setModel('model-x');
    await store.savePost('call_post', { status: 'posted', url: 'https://civitai.com/posts/1' } as never);
    // The post's own save, mid-reply: the reply as it was, running, not dropped.
    const postSave = headOf(heads.writes[before]!);
    expect([postSave.v, postSave.turns[0]!.assistant?.status, postSave.title, postSave.model, results(postSave)]).toEqual([3, 'running', 'Renamed by hand', 'model-x', ['call_1']]);
    release();
    await done;
    for (const head of heads.writes.slice(before).map(headOf)) {
      expect([head.title, head.model, Object.keys(head.posts ?? {})]).toEqual(['Renamed by hand', 'model-x', ['call_post']]);
    }
    expect([headOf(heads.writes.at(-1)!).v, headOf(heads.writes.at(-1)!).turns[0]!.assistant?.status]).toEqual([2, 'done']);
  });
});

describe('how often it saves', () => {
  it('has at most one checkpoint waiting per head: progress that comes in while it waits rides on it, built from the latest', async () => {
    const heads = fakeHeads();
    const { store } = tab(heads);
    const turn: Turn = store.appendUserTurn('take notes', []);
    await vi.waitFor(() => expect(heads.workflows.size).toBe(1));
    const release = heads.hold();
    const step = (n: number) => Array.from({ length: n }, (_, i) => [{ role: 'assistant' as const, content: `step ${i + 1}` }]).flat();
    const first = store.checkpoint(turn, { messages: step(1) });
    await vi.waitFor(() => expect(heads.started.count).toBe(1));
    // The first write is out (built, held). More progress comes in and its save waits; then the viewer
    // renames the chat and two more steps finish, all before that save goes.
    const second = store.checkpoint(turn, { messages: step(2) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await store.setTitle('Renamed while it waited', 'user');
    const more = [store.checkpoint(turn, { messages: step(3) }), store.checkpoint(turn, { messages: step(4) })];
    release();
    await Promise.all([first, second, ...more]);
    const written = heads.writes.map(headOf);
    expect(written.map((h) => [h.turns[0]!.assistant?.messages.length, h.title])).toEqual([
      [1, 'take notes'],
      [4, 'Renamed while it waited'],
    ]);
  });
});

describe('a reply whose tab died mid-step, carried on elsewhere', () => {
  /**
   * Tab A: step 1 calls `note` (it finishes); step 2 calls `x` (it finishes) and `hang` (it starts and
   * never finishes), unless `onlyHang`. A dies there: the browser drops its lock.
   */
  async function aDiesInStep2(onlyHang = false) {
    const heads = fakeHeads();
    const locks = fakeLocks();
    const step2 = onlyHang ? callsTools(['call_hang', 'hang', 'h']) : callsTools(['call_x', 'x', 'x1'], ['call_hang', 'hang', 'h']);
    const a = tab(heads, [callsNote('call_1', 'one'), step2], { locks: locks.tab('A') });
    void a.agent.send('build it');
    await vi.waitFor(() => {
      const saved = JSON.stringify(heads.writes.at(-1)?.metadata ?? {});
      expect(saved).toContain('"toolCallId":"call_hang"');
      if (!onlyHang) expect(results(headOf(heads.writes.at(-1)!))).toEqual(['call_1', 'call_x']);
    });
    locks.kill('A');
    return { heads, locks, ranInA: a.ran };
  }

  /** Tab B opens the chat 30 minutes later and carries on: what B's model was sent, and what ran in B. */
  async function bContinues(heads: ReturnType<typeof fakeHeads>, locks: ReturnType<typeof fakeLocks>) {
    const prompts: string[] = [];
    const model = new MockLanguageModelV3({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        return { stream: convertArrayToReadableStream(says('Picked it up.')) as never };
      },
    });
    const b = tab(heads, [], { now: at(NOW + 30 * 60_000), locks: locks.tab('B') });
    const agent = new Agent({ model: () => model, store: b.store, jobs: new JobManager({} as never), toolSet: async () => ({}), attachments: () => [] });
    agent.addEventListener('error', () => undefined);
    const turn = (await b.store.open('CONV1')).conversation.turns.at(-1)!;
    expect(replyElsewhere(turn, NOW + 30 * 60_000)).toBe('stale');
    await agent.retry();
    return { prompts, turn: b.store.current!.turns.at(-1)! };
  }

  it('sends the finished call with its result and the unfinished one as interrupted: neither runs again', async () => {
    const { heads, locks, ranInA } = await aDiesInStep2();
    const { prompts, turn } = await bContinues(heads, locks);
    expect(turn.assistant.status).toBe('done');
    expect(prompts).toHaveLength(1);
    const sent = prompts[0]!;
    // x's own result, once; hang's as interrupted, once; no call asked for again.
    expect(sent.match(/x-result-7/g)).toHaveLength(1);
    expect(sent.match(new RegExp(INTERRUPTED_CALL, 'g'))).toHaveLength(1);
    expect(sent.match(/"toolCallId":"call_x"/g)).toHaveLength(2);
    expect(sent.match(/"toolCallId":"call_hang"/g)).toHaveLength(2);
    expect(ranInA).toEqual(['note:one', 'x:x1', 'hang:h']);
  });

  it('a tab that died before any result in its step: the call that started goes as interrupted, and is not run again', async () => {
    const { heads, locks, ranInA } = await aDiesInStep2(true);
    const { prompts } = await bContinues(heads, locks);
    const sent = prompts[0]!;
    expect(sent.match(new RegExp(INTERRUPTED_CALL, 'g'))).toHaveLength(1);
    expect(sent.match(/"toolCallId":"call_hang"/g)).toHaveLength(2);
    expect(ranInA).toEqual(['note:one', 'hang:h']);
  });
});

describe('the tab that ran the reply, reloaded or copied', () => {
  /** Tab A runs the reply's first two steps and dies on the third (or still runs it, `kill: false`). */
  async function aStopsInStep3(own: ReturnType<typeof tabStorage>, locks: ReturnType<typeof fakeLocks> | null, kill = true) {
    const heads = fakeHeads();
    const { agent } = tab(heads, [callsNote('call_1', 'one'), callsNote('call_2', 'two'), HANGS], { own, locks: locks?.tab('A') ?? null });
    void agent.send('take notes');
    await vi.waitFor(() => expect(results(headOf(heads.writes.at(-1) ?? { metadata: {} }))).toEqual(['call_1', 'call_2']));
    if (kill) locks?.kill('A');
    return heads;
  }
  const opener = (heads: ReturnType<typeof fakeHeads>, own: ReturnType<typeof tabStorage>, locks: Pick<LockManager, 'request' | 'query'> | null, now: number) =>
    new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, now: at(now), ownReplies: own, locks });
  const copyOf = (own: ReturnType<typeof tabStorage>) => {
    const copy = tabStorage();
    for (const [key, value] of own.entries) copy.setItem(key, value);
    return copy;
  };

  it('reloaded: reads its own unfinished reply as gone at once, though its last save is a minute old', async () => {
    const own = tabStorage();
    const locks = fakeLocks();
    const heads = await aStopsInStep3(own, locks);
    const turn = (await opener(heads, own, locks.tab('A2'), NOW + 60_000).open('CONV1')).conversation.turns.at(-1)!;
    expect([turn.assistant.status, turn.assistant.error, turn.assistant.orphaned]).toEqual(['error', CUT_OFF, true]);
    expect(replyElsewhere(turn, NOW + 60_000)).toBe('stale');
    expect(turn.assistant.resume?.messages.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool']);
  });

  it('copied while the reply runs (same note, its lock held by the original): live, whatever the times say, until the original lets go', async () => {
    const own = tabStorage();
    const locks = fakeLocks();
    const heads = await aStopsInStep3(own, locks, false);
    const copy = copyOf(own);
    const turn = (await opener(heads, copy, locks.tab('B'), NOW + 30 * 60_000).open('CONV1')).conversation.turns.at(-1)!;
    expect([turn.assistant.orphaned, turn.assistant.heldElsewhere]).toEqual([undefined, true]);
    expect(replyElsewhere(turn, NOW + 30 * 60_000)).toBe('live');
    locks.kill('A');
    const after = (await opener(heads, copy, locks.tab('B'), NOW + 30 * 60_000).open('CONV1')).conversation.turns.at(-1)!;
    expect([after.assistant.orphaned, after.assistant.heldElsewhere]).toEqual([true, undefined]);
    expect(replyElsewhere(after, NOW + 30 * 60_000)).toBe('stale');
  });

  it('with no Web Locks to ask, a note alone never marks it dead: the time rule decides', async () => {
    const own = tabStorage();
    const heads = await aStopsInStep3(own, null);
    const turn = (await opener(heads, own, null, NOW + 60_000).open('CONV1')).conversation.turns.at(-1)!;
    expect(turn.assistant.orphaned).toBeUndefined();
    expect(replyElsewhere(turn, NOW + 60_000)).toBe('live');
  });

  it('another tab, with no such note, reads it as still replying while the save is fresh', async () => {
    const locks = fakeLocks();
    const heads = await aStopsInStep3(tabStorage(), locks);
    const turn = (await opener(heads, tabStorage(), locks.tab('B'), NOW + 60_000).open('CONV1')).conversation.turns.at(-1)!;
    expect(turn.assistant.orphaned).toBeUndefined();
    expect(replyElsewhere(turn, NOW + 60_000)).toBe('live');
  });

  it('a save newer than its note is someone else’s: the time rule decides', async () => {
    const own = tabStorage();
    const locks = fakeLocks();
    const heads = await aStopsInStep3(own, locks);
    const wf = [...heads.workflows.values()][0]!;
    (wf.metadata as unknown as Head).turns[0]!.assistant!.savedAt = new Date(NOW + 120_000).toISOString();
    const turn = (await opener(heads, own, locks.tab('A2'), NOW + 180_000).open('CONV1')).conversation.turns.at(-1)!;
    expect(turn.assistant.orphaned).toBeUndefined();
    expect(replyElsewhere(turn, NOW + 180_000)).toBe('live');
  });

  it('lets go of the note and the lock once the reply ended', async () => {
    const locks = fakeLocks();
    const { agent, own } = tab(fakeHeads(), undefined, { locks: locks.tab('A') });
    await agent.send('take notes');
    expect([[...own.entries.keys()], [...locks.held.keys()]]).toEqual([[], []]);
  });

  it('lets go of them even when saving how it ended fails', async () => {
    const heads = fakeHeads();
    const locks = fakeLocks();
    const { store, own } = tab(heads, undefined, { locks: locks.tab('A') });
    const turn = store.appendUserTurn('take notes', []);
    store.replyStarted(turn);
    await vi.waitFor(() => expect(heads.workflows.size).toBe(1));
    await store.checkpoint(turn, { messages: [{ role: 'assistant', content: 'thinking' }] });
    expect([[...own.entries.keys()].length, locks.held.size]).toEqual([1, 1]);
    heads.api.updateWorkflow = async () => {
      throw new Error('orchestrator down');
    };
    turn.assistant = { messages: [{ role: 'assistant', content: 'done' }], status: 'done' };
    await expect(store.completeTurn(turn)).rejects.toThrow('orchestrator down');
    expect([[...own.entries.keys()], [...locks.held.keys()]]).toEqual([[], []]);
  });
});
