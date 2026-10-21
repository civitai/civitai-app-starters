import type { Workflow, WorkflowTemplate } from '@civitai/sdk';
import { jsonSchema, tool, type ModelMessage, type ToolSet } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../agent/agent.js';
import { partsFromMessages, type TurnPart } from '../agent/parts.js';
import { JobManager } from '../orchestration/jobs.js';
import { createPartsDiffer, type RunEvent } from '../runner-protocol.js';
import { ThreadStore, type ThreadStoreDeps } from '../store/thread-store.js';
import { fakeRunner, RUNNER_URL } from '../test-support/fake-runner.js';
import { workflow } from '../test-support/fakes.js';
import { scriptedModel, text, toolCall } from '../test-support/scripted-model.js';
import type { ChatToolResult } from '../tools/gate.js';
import { RemoteAgent, RUN_ACTIVE, type RemoteAgentDeps } from './remote-agent.js';
import { RunnerClient } from './runner-client.js';

const SETTINGS = { maxOutputTokens: 4096, tier: 'auto', allowMature: false, autoRunLimit: 10, spokenReplies: false } as const;

/** A v2 head as the runner saves it once a run ended. */
function head(conversationId: string, turns: unknown[]): Workflow {
  return workflow({
    id: `head-${conversationId}`,
    tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${conversationId}`],
    metadata: { v: 2, app: 'chat-cvt', conversationId, title: 'Saved', titleSource: 'llm', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', turns },
  });
}

/** A store in remote mode, whose every orchestrator write is watched; `heads` is what reading it back finds. */
function remoteStore(heads: Workflow[] = []) {
  const submitWorkflow = vi.fn(async (_: WorkflowTemplate) => workflow({ id: 'never' }));
  const updateWorkflow = vi.fn(async () => undefined);
  const queryWorkflows = vi.fn(async (query: { tags?: string[] }) => ({ items: query.tags?.includes('cvt:job') ? [] : heads, next: '' }));
  const patch = vi.fn(async () => undefined);
  const deps: ThreadStoreDeps = {
    orchestration: { submitWorkflow, queryWorkflows: queryWorkflows as never },
    api: { updateWorkflow, removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn(async () => undefined) },
    hideMatureContent: () => true,
    newId: () => 'c1',
    ownReplies: null,
    locks: null,
    remote: { patch },
  };
  return { store: new ThreadStore(deps), submitWorkflow, updateWorkflow, queryWorkflows, patch, heads };
}

function setup(heads: Workflow[] = [], extra: Partial<RemoteAgentDeps> = {}) {
  const runner = fakeRunner();
  const made = remoteStore(heads);
  const rereads: string[] = [];
  const errors: unknown[] = [];
  const toolResults: ChatToolResult[] = [];
  const agent = new RemoteAgent({
    client: new RunnerClient({ url: RUNNER_URL, fetch: runner.fetch, headers: async () => ({ authorization: 'Bearer viewer' }), reconnectDelaysMs: [0] }),
    store: made.store,
    scope: 'app-assistant',
    model: () => 'model-a',
    settings: () => SETTINGS,
    pageState: () => ({ appId: 'app-7', sandbox: 'sb-1' }),
    reread: async (id) => {
      rereads.push(id);
      await made.store.open(id);
    },
    onToolResult: (result) => toolResults.push(result),
    newKey: () => 'key-1',
    ...extra,
  });
  agent.addEventListener('error', (event) => errors.push((event as CustomEvent).detail));
  const seen: TurnPart[][] = [];
  agent.addEventListener('change', () => {
    if (agent.live) seen.push(structuredClone(agent.live.parts));
  });
  return { ...made, runner, agent, rereads, errors, toolResults, seen };
}

/** Pushes events onto the run's journal one at a time, letting the page read each. */
async function pushAll(runner: ReturnType<typeof fakeRunner>, runId: string, events: RunEvent[]) {
  for (const event of events) {
    runner.push(runId, event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const ended = (messages: ModelMessage[], status: 'done' | 'stopped' | 'error' | 'ran_out' = 'done', extra: Partial<Extract<RunEvent, { type: 'run-ended' }>> = {}): RunEvent => ({ type: 'run-ended', status, messages, steps: 1, ...extra });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RemoteAgent, against a runner', () => {
  it('shows the same parts, and ends on the same turn, as the page’s own Agent for the same reply', async () => {
    // The page's own reply, recorded as a runner would stream it.
    const tools: ToolSet = {
      generate_image: tool({ inputSchema: jsonSchema<{ prompt: string }>({ type: 'object', properties: { prompt: { type: 'string' } } }), execute: async () => ({ job: 'gen1-1', status: 'running' }) }),
    };
    const browserStore = new ThreadStore({
      orchestration: { submitWorkflow: vi.fn(async () => workflow({ id: '7-1' })), queryWorkflows: vi.fn() },
      api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn() },
      hideMatureContent: () => true,
      ownReplies: null,
      locks: null,
    });
    const browser = new Agent({
      model: () => scriptedModel([toolCall('generate_image', { prompt: 'a red bike' }), text('Your bike ', 'is on ', 'its way!')]),
      store: browserStore,
      jobs: new JobManager({} as never),
      toolSet: async () => tools,
      attachments: () => [],
    });
    const differ = createPartsDiffer();
    const journal: RunEvent[] = [];
    let browserLast: TurnPart[] = [];
    browser.addEventListener('change', () => {
      if (!browser.live) return;
      journal.push(...differ.diff(browser.live.parts));
      browserLast = structuredClone(browser.live.parts);
    });
    await browser.send('make a red bike');
    const browserTurn = browserStore.current!.turns[0]!;
    expect(browserTurn.assistant.status).toBe('done');
    // Not a trivial reply: a tool call with its result, and words after it.
    expect(browserLast.map((part) => part.kind)).toEqual(['tool', 'text']);

    // The same reply, run by a runner and followed by the page.
    const { agent, runner, store, rereads, errors } = setup([head('c1', [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'make a red bike', attachments: [] }, assistant: { messages: browserTurn.assistant.messages, status: 'done' } }])]);
    const sent = agent.send('make a red bike');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await pushAll(runner, 'r1', journal);
    await vi.waitFor(() => expect(agent.live?.parts).toEqual(browserLast));
    expect(agent.running).toBe(true);
    runner.push('r1', ended(browserTurn.assistant.messages));
    await vi.waitFor(() => expect(rereads).toEqual(['c1']));
    await sent;
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(agent.live).toBeNull();
    const turn = store.current!.turns[0]!;
    expect(turn.assistant.status).toBe('done');
    expect(turn.assistant.messages).toEqual(browserTurn.assistant.messages);
    expect(partsFromMessages(turn.assistant.messages)).toEqual(partsFromMessages(browserTurn.assistant.messages));
    expect(errors).toEqual([]);
  });

  it('starts the run with the turn, the model, the settings and the page’s state, with the page’s auth on every call', async () => {
    const { agent, runner } = setup();
    void agent.send('build me a todo app');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const start = runner.requests.find((request) => request.method === 'POST' && request.path === 'runs')!;
    expect(start.body).toEqual({
      v: 1,
      idempotencyKey: 'key-1',
      conversationId: 'c1',
      scope: 'app-assistant',
      turn: { seq: 1, user: { content: 'build me a todo app', attachments: [] } },
      model: 'model-a',
      settings: SETTINGS,
      page: { appId: 'app-7', sandbox: 'sb-1' },
    });
    expect(runner.requests.every((request) => request.headers.authorization === 'Bearer viewer')).toBe(true);
    agent.leave();
  });

  it('writes no head while a run goes, and reads the head again once it ended', async () => {
    const { agent, runner, submitWorkflow, updateWorkflow, queryWorkflows, rereads } = setup([head('c1', [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'hi', attachments: [] }, assistant: { messages: [{ role: 'assistant', content: 'Hello.' }], status: 'done' } }])]);
    const sent = agent.send('hi');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    // An event of a type this client does not know (a later protocol's) is skipped.
    await pushAll(runner, 'r1', [{ type: 'text-delta', index: 0, text: 'Hello.' }, { type: 'some-later-event', at: 1 } as unknown as RunEvent]);
    expect(queryWorkflows).not.toHaveBeenCalled();
    runner.push('r1', ended([{ role: 'assistant', content: 'Hello.' }]));
    await sent;
    await vi.waitFor(() => expect(rereads).toEqual(['c1']));
    expect(queryWorkflows).toHaveBeenCalled();
    expect(submitWorkflow).not.toHaveBeenCalled();
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('resumes after the last event it read when the stream is cut, without showing anything twice', async () => {
    const { agent, runner } = setup();
    runner.knobs.dropAfter = 3;
    const sent = agent.send('go');
    await vi.waitFor(() => expect(runner.eventOpens('r1').length).toBeGreaterThan(0));
    await pushAll(runner, 'r1', [
      { type: 'text-delta', index: 0, text: 'Hello' },
      { type: 'text-delta', index: 0, text: ' world' },
      { type: 'tool-call', index: 1, toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'npm test' } },
      { type: 'tool-result', toolCallId: 't1', output: { exitCode: 0 } },
      { type: 'text-delta', index: 2, text: 'Done.' },
    ]);
    await vi.waitFor(() => expect(agent.live?.parts.length).toBe(3));
    expect(agent.live!.parts).toEqual([
      { kind: 'text', text: 'Hello world' },
      { kind: 'tool', toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'npm test' }, state: 'done', output: { exitCode: 0 } },
      { kind: 'text', text: 'Done.' },
    ]);
    const opens = runner.eventOpens('r1');
    expect(opens.length).toBeGreaterThan(1);
    // The first open asks for the whole journal; each one after resumes after the last event read.
    expect(opens[0]!.headers['last-event-id']).toBeUndefined();
    expect(opens[1]!.headers['last-event-id']).toBe('2');
    runner.push('r1', ended([{ role: 'assistant', content: 'Done.' }]));
    await sent;
    await vi.waitFor(() => expect(agent.running).toBe(false));
  });

  it('applies each event once even when a runner sends events it already sent', async () => {
    const { agent, runner } = setup();
    void agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await pushAll(runner, 'r1', [
      { type: 'text-delta', index: 0, text: 'One' },
      { type: 'text-delta', index: 0, text: ' two' },
    ]);
    // A runner that replays from after `run-started` (id 0) whatever the client last read: 'One' and ' two' come again.
    runner.knobs.replayFrom = 1;
    runner.dropStreams('r1');
    await vi.waitFor(() => expect(runner.eventOpens('r1')).toHaveLength(2));
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    expect(runner.eventOpens('r1')[1]!.headers['last-event-id']).toBe('2');
    await pushAll(runner, 'r1', [{ type: 'text-delta', index: 0, text: ' three' }]);
    await vi.waitFor(() => expect(agent.live?.parts).toEqual([{ kind: 'text', text: 'One two three' }]));
    agent.leave();
  });

  it('reads the journal again from its start when a message does not fit what it shows', async () => {
    const { agent, runner, toolResults } = setup();
    void agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const report: ChatToolResult = { name: 'sandbox__run_command', input: {}, output: 'ok', isError: false };
    await pushAll(runner, 'r1', [{ type: 'text-delta', index: 0, text: 'Kept once.' }, { type: 'tool-reported', result: report }]);
    runner.knobs.garbleNext = true;
    runner.dropStreams('r1');
    // The open after the drop resumes after id 1, gets the broken message, and the next one reads everything again.
    await vi.waitFor(() => expect(runner.eventOpens('r1')).toHaveLength(3));
    const opens = runner.eventOpens('r1');
    expect(opens[1]!.headers['last-event-id']).toBe('2');
    expect(opens[2]!.headers['last-event-id']).toBeUndefined();
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await pushAll(runner, 'r1', [{ type: 'text-delta', index: 0, text: ' Then more.' }]);
    await vi.waitFor(() => expect(agent.live?.parts).toEqual([{ kind: 'text', text: 'Kept once. Then more.' }]));
    // Read again from the start, the report did not reach the page a second time.
    expect(toolResults).toEqual([report]);
    agent.leave();
  });

  it('keeps reconnecting through a network drop, the turn still replying and no error shown', async () => {
    const { agent, runner, store, errors } = setup();
    const sent = agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await pushAll(runner, 'r1', [{ type: 'text-delta', index: 0, text: 'Working' }]);
    const before = runner.eventOpens('r1').length;
    runner.knobs.failEvents = 4;
    runner.dropStreams('r1');
    await vi.waitFor(() => expect(runner.eventOpens('r1').length).toBe(before + 5));
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const turn = store.current!.turns[0]!;
    expect(agent.running).toBe(true);
    expect(turn.assistant.status).toBe('streaming');
    expect(turn.assistant.error).toBeUndefined();
    expect(errors).toEqual([]);
    expect(agent.live!.parts).toEqual([{ kind: 'text', text: 'Working' }]);
    await pushAll(runner, 'r1', [{ type: 'text-delta', index: 0, text: ' on it.' }]);
    await vi.waitFor(() => expect(agent.live?.parts).toEqual([{ kind: 'text', text: 'Working on it.' }]));
    runner.push('r1', ended([{ role: 'assistant', content: 'Working on it.' }]));
    await sent;
    expect(turn.assistant.status).toBe('done');
  });

  it('asks again for a start whose answer never came, with the same key, so the run starts once', async () => {
    const { agent, runner } = setup();
    runner.knobs.failStarts = 2;
    void agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const starts = runner.requests.filter((request) => request.method === 'POST' && request.path === 'runs');
    expect(starts).toHaveLength(3);
    expect(new Set(starts.map((request) => (request.body as { idempotencyKey: string }).idempotencyKey))).toEqual(new Set(['key-1']));
    expect(runner.runs.size).toBe(1);
    agent.leave();
  });

  it('sends Stop to the runner, and shows the reply stopped only once the run says it ended', async () => {
    const { agent, runner, store } = setup();
    const sent = agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await pushAll(runner, 'r1', [{ type: 'text-delta', index: 0, text: 'Partial' }]);
    await vi.waitFor(() => expect(agent.live?.parts).toEqual([{ kind: 'text', text: 'Partial' }]));
    agent.abort();
    await vi.waitFor(() => expect(runner.requests.filter((request) => request.path === 'runs/r1/stop')).toHaveLength(1));
    expect(runner.requests.find((request) => request.path === 'runs/r1/stop')!.body).toEqual({ v: 1 });
    const turn = store.current!.turns[0]!;
    expect(agent.running).toBe(true);
    expect(turn.assistant.status).toBe('streaming');
    runner.push('r1', ended([{ role: 'assistant', content: 'Partial' }], 'stopped'));
    await sent;
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(turn.assistant.status).toBe('aborted');
    expect(turn.assistant.messages).toEqual([{ role: 'assistant', content: 'Partial' }]);
  });

  it('finds the live run of a chat opened again (a reload) and follows it from its start', async () => {
    const first = setup();
    void first.agent.send('build it');
    await vi.waitFor(() => expect(first.runner.openStreams('r1')).toBe(1));
    await pushAll(first.runner, 'r1', [
      { type: 'text-delta', index: 0, text: 'Building' },
      { type: 'tool-call', index: 1, toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'npm run build' } },
    ]);
    first.agent.leave();
    expect(first.runner.requests.filter((request) => request.path === 'runs/r1/stop')).toEqual([]);

    // The reloaded page: a new store and agent on the same runner, the head saved with the reply running.
    const runningHead = workflow({
      id: 'head-c1',
      tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:c1'],
      metadata: { v: 3, app: 'chat-cvt', conversationId: 'c1', title: 'Build it', titleSource: 'first-message', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z', turns: [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'build it', attachments: [] }, assistant: { messages: [], status: 'running', savedAt: '2026-10-19T00:00:01Z' } }] },
    });
    const made = remoteStore([runningHead]);
    const rereads: string[] = [];
    const agent = new RemoteAgent({
      client: new RunnerClient({ url: RUNNER_URL, fetch: first.runner.fetch, reconnectDelaysMs: [0] }),
      store: made.store,
      model: () => 'model-a',
      settings: () => SETTINGS,
      reread: async (id) => {
        rereads.push(id);
        await made.store.open(id);
      },
    });
    await made.store.open('c1');
    const opensBefore = first.runner.eventOpens('r1').length;
    expect(await agent.reattach('c1')).toBe(true);
    expect(first.runner.requests.some((request) => request.method === 'GET' && request.path === 'runs?conversationId=c1')).toBe(true);
    await vi.waitFor(() =>
      expect(agent.live?.parts).toEqual([
        { kind: 'text', text: 'Building' },
        { kind: 'tool', toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'npm run build' }, state: 'calling' },
      ]),
    );
    // Read from the journal's start: no event id to resume after.
    expect(first.runner.eventOpens('r1')[opensBefore]!.headers['last-event-id']).toBeUndefined();
    expect(agent.live!.seq).toBe(1);
    expect(made.store.current!.turns[0]!.assistant.status).toBe('streaming');
    first.runner.push('r1', ended([{ role: 'assistant', content: 'Built.' }]));
    await vi.waitFor(() => expect(rereads).toEqual(['c1']));
    await vi.waitFor(() => expect(agent.running).toBe(false));
  });

  it('stays running until the head was read again, so nothing sent meanwhile lands on the chat being replaced', async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => (open = resolve));
    const made = setup([head('c1', [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'go', attachments: [] }, assistant: { messages: [{ role: 'assistant', content: 'Done.' }], status: 'done' } }])]);
    const { agent, runner, store } = made;
    const slow = new RemoteAgent({
      client: new RunnerClient({ url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs: [0] }),
      store,
      model: () => 'model-a',
      settings: () => SETTINGS,
      reread: async (id) => {
        await gate;
        await store.open(id);
      },
    });
    void agent;
    const sent = slow.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    runner.push('r1', ended([{ role: 'assistant', content: 'Done.' }]));
    await vi.waitFor(() => expect(slow.live).toBeNull());
    expect(slow.running).toBe(true);
    await slow.send('again');
    expect(runner.requests.filter((request) => request.method === 'POST' && request.path === 'runs')).toHaveLength(1);
    open();
    await sent;
    await vi.waitFor(() => expect(slow.running).toBe(false));
    expect(store.current!.turns.map((turn) => turn.user.content)).toEqual(['go']);
  });

  it('takes how a run ended from the head when the runner no longer knows it', async () => {
    const { agent, runner, store, rereads } = setup([head('c1', [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'go', attachments: [] }, assistant: { messages: [{ role: 'assistant', content: 'Finished while you were away.' }], status: 'done' } }])]);
    const sent = agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    // The run ended and was let go of while the page slept.
    runner.runs.delete('r1');
    runner.dropStreams('r1');
    await sent;
    await vi.waitFor(() => expect(rereads).toEqual(['c1']));
    await vi.waitFor(() => expect(agent.running).toBe(false));
    const turn = store.current!.turns[0]!;
    expect(turn.assistant.status).toBe('done');
    expect(turn.assistant.error).toBeUndefined();
    expect(turn.assistant.messages).toEqual([{ role: 'assistant', content: 'Finished while you were away.' }]);
  });

  it('keeps trying through a refusal of the event stream other than 404, 410, 401 or 403, the turn still replying', async () => {
    const { agent, runner, store } = setup();
    const sent = agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    // Two 400s on reopening, as a runner replica that has not caught up might answer.
    runner.knobs.refuseEvents = { status: 400, times: 2 };
    const before = runner.eventOpens('r1').length;
    runner.dropStreams('r1');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    expect(runner.eventOpens('r1').length).toBe(before + 3);
    expect(agent.running).toBe(true);
    expect(store.current!.turns[0]!.assistant.status).toBe('streaming');
    runner.push('r1', ended([]));
    await sent;
    await vi.waitFor(() => expect(agent.running).toBe(false));
  });

  it('ends the reply at once on Stop while its start has had no answer, and stops the run by its start key', async () => {
    const { agent, runner, store } = setup();
    runner.knobs.failStarts = 1_000_000;
    void agent.send('go');
    await vi.waitFor(() => expect(runner.requests.filter((request) => request.path === 'runs').length).toBeGreaterThan(1));
    // The first stops by key get no answer either: asked again until one is answered.
    runner.knobs.failStops = 2;
    agent.abort();
    expect(agent.running).toBe(false);
    expect(store.current!.turns[0]!.assistant.status).toBe('aborted');
    const starts = runner.requests.filter((request) => request.path === 'runs').length;
    // An earlier start may have reached the runner and started a run whose id the page never learned: it is stopped by its key.
    await vi.waitFor(() => expect(runner.requests.filter((request) => request.method === 'POST' && request.path === 'runs/stop')).toHaveLength(3));
    expect(runner.requests.filter((request) => request.path === 'runs/stop').map((request) => request.body)).toEqual(Array(3).fill({ v: 1, idempotencyKey: 'key-1', conversationId: 'c1' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runner.requests.filter((request) => request.path === 'runs').length).toBe(starts);
    expect(runner.requests.filter((request) => request.path === 'runs/stop')).toHaveLength(3);
  });

  it.each([401, 403])('ends the turn with an auth error the page can show when the runner refuses the viewer (%i) on the event stream', async (status) => {
    const { agent, runner, store, errors } = setup();
    const sent = agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const turn = store.current!.turns[0]!;
    runner.knobs.refuseEvents = { status, times: 1_000_000 };
    runner.dropStreams('r1');
    await sent;
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(turn.assistant).toMatchObject({ status: 'error', errorKind: 'auth' });
    expect(errors).toMatchObject([{ kind: 'auth' }]);
    // The run itself is the runner's: the page asked nothing to stop it.
    expect(runner.requests.filter((request) => request.path.endsWith('/stop'))).toEqual([]);
    expect(runner.eventOpens('r1').length).toBeLessThan(5);
  });

  it('frees the composer on Stop even when the runner refuses it', async () => {
    const { agent, runner, store } = setup();
    void agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await pushAll(runner, 'r1', [{ type: 'text-delta', index: 0, text: 'Partial' }]);
    await vi.waitFor(() => expect(agent.live?.parts).toEqual([{ kind: 'text', text: 'Partial' }]));
    const turn = store.current!.turns[0]!;
    runner.knobs.refuseStop = { status: 403 };
    agent.abort();
    await vi.waitFor(() => expect(runner.requests.filter((request) => request.path === 'runs/r1/stop')).toHaveLength(1));
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(turn.assistant.status).toBe('aborted');
  });

  it('fires no host event for what the journal already held when a reloaded page follows the run again, only for what comes after', async () => {
    const first = setup();
    void first.agent.send('build it');
    await vi.waitFor(() => expect(first.runner.openStreams('r1')).toBe(1));
    const trace = { stage: 'stream', step: 1, msIntoStep: 3, message: 'cut' } as const;
    const earlier: ChatToolResult = { name: 'sandbox__run_command', input: { command: 'npm test' }, output: 'ok', isError: false };
    await pushAll(first.runner, 'r1', [
      { type: 'tool-call', index: 0, toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'npm test' } },
      { type: 'tool-result', toolCallId: 't1', output: 'ok' },
      { type: 'tool-reported', result: earlier },
      { type: 'network-retry', attempt: 1, trace },
    ]);
    await vi.waitFor(() => expect(first.toolResults).toEqual([earlier]));
    first.agent.leave();

    const made = remoteStore();
    const toolResults: ChatToolResult[] = [];
    const retries: unknown[] = [];
    const agent = new RemoteAgent({
      client: new RunnerClient({ url: RUNNER_URL, fetch: first.runner.fetch, reconnectDelaysMs: [0] }),
      store: made.store,
      model: () => 'model-a',
      settings: () => SETTINGS,
      reread: async (id) => void (await made.store.open(id)),
      onToolResult: (result) => toolResults.push(result),
    });
    agent.addEventListener('network-retry', (event) => retries.push((event as CustomEvent).detail));
    await made.store.open('c1');
    expect(await agent.reattach('c1')).toBe(true);
    // The state is rebuilt from the replay...
    await vi.waitFor(() => expect(agent.live?.parts).toEqual([{ kind: 'tool', toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'npm test' }, state: 'done', output: 'ok' }]));
    // ...but what the page already heard about before the reload is not announced again.
    expect(toolResults).toEqual([]);
    expect(retries).toEqual([]);
    const later: ChatToolResult = { name: 'create_app', input: { name: 'todo' }, output: { app: 'todo' }, isError: false };
    await pushAll(first.runner, 'r1', [{ type: 'tool-reported', result: later }]);
    await vi.waitFor(() => expect(toolResults).toEqual([later]));
    agent.leave();
  });

  it('never starts following a run once the page left, even when the lookup was already on its way', async () => {
    const { agent, runner, store } = setup();
    runner.knobs.holdLookups = true;
    await runner.fetch(`${RUNNER_URL}/runs`, {
      method: 'POST',
      body: JSON.stringify({ v: 1, idempotencyKey: 'other', conversationId: 'c1', turn: { seq: 1, user: { content: 'hi', attachments: [] } }, model: 'm', settings: {} }),
    });
    await store.open('c1');
    const attached = agent.reattach('c1');
    await vi.waitFor(() => expect(runner.requests.some((request) => request.path === 'runs?conversationId=c1')).toBe(true));
    agent.leave();
    runner.releaseLookups();
    expect(await attached).toBe(false);
    expect(agent.running).toBe(false);
    expect(runner.eventOpens('r1')).toEqual([]);
  });

  it('follows nothing, starts nothing and looks nothing up once disposed (its session was replaced)', async () => {
    const { agent, runner, store } = setup();
    runner.knobs.holdLookups = true;
    await runner.fetch(`${RUNNER_URL}/runs`, {
      method: 'POST',
      body: JSON.stringify({ v: 1, idempotencyKey: 'other', conversationId: 'c1', turn: { seq: 1, user: { content: 'hi', attachments: [] } }, model: 'm', settings: {} }),
    });
    await store.open('c1');
    const attached = agent.reattach('c1');
    await vi.waitFor(() => expect(runner.requests.some((request) => request.path === 'runs?conversationId=c1')).toBe(true));
    agent.dispose();
    runner.releaseLookups();
    expect(await attached).toBe(false);
    const before = runner.requests.length;
    expect(await agent.reattach('c1')).toBe(false);
    await agent.send('again');
    expect(runner.requests.length).toBe(before);
    expect(runner.eventOpens('r1')).toEqual([]);
    expect(agent.running).toBe(false);
  });

  it('gives up on a lookup the runner never answers, and can look again', async () => {
    const runner = fakeRunner();
    const made = remoteStore();
    const agent = new RemoteAgent({
      client: new RunnerClient({ url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs: [0], timeoutMs: 50 }),
      store: made.store,
      model: () => 'model-a',
      settings: () => SETTINGS,
      reread: async () => undefined,
    });
    await runner.fetch(`${RUNNER_URL}/runs`, {
      method: 'POST',
      body: JSON.stringify({ v: 1, idempotencyKey: 'other', conversationId: 'c1', turn: { seq: 1, user: { content: 'hi', attachments: [] } }, model: 'm', settings: {} }),
    });
    await made.store.open('c1');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runner.knobs.hangLookups = true;
    expect(await agent.reattach('c1')).toBe(false);
    // Not stuck "looking": the next open looks again, and follows the run.
    runner.knobs.hangLookups = false;
    expect(await agent.reattach('c1')).toBe(true);
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    agent.leave();
  });

  it('ends the reply on the page as stopped when the run does not say it stopped in time', async () => {
    const { agent, runner, store } = setup([], { stopGraceMs: 30 });
    void agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const turn = store.current!.turns[0]!;
    agent.abort();
    await vi.waitFor(() => expect(runner.requests.filter((request) => request.path === 'runs/r1/stop')).toHaveLength(1));
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(turn.assistant.status).toBe('aborted');
  });

  it('writes no head even after reading one back (a later post or panel stays on the page)', async () => {
    const { agent, runner, store, updateWorkflow, rereads } = setup([head('c1', [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'go', attachments: [] }, assistant: { messages: [], status: 'done' } }])]);
    const sent = agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    runner.push('r1', ended([]));
    await sent;
    await vi.waitFor(() => expect(rereads).toEqual(['c1']));
    await vi.waitFor(() => expect(agent.running).toBe(false));
    await store.savePost('call_9', { status: 'posted' } as never);
    await store.savePanel({ handle: 'p1' } as never);
    expect(updateWorkflow).not.toHaveBeenCalled();
  });

  it('fails the turn when the chat already has a run, and asks again with retry once Retry is pressed', async () => {
    const { agent, runner, store } = setup();
    runner.knobs.refuseStart = { status: 409, body: { v: 1, error: 'run-active', message: 'busy', runId: 'r9' } };
    await agent.send('go');
    expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'error', error: RUN_ACTIVE });
    expect(agent.running).toBe(false);
    runner.knobs.refuseStart = undefined;
    void agent.retry();
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const starts = runner.requests.filter((request) => request.method === 'POST' && request.path === 'runs');
    expect((starts.at(-1)!.body as { turn: unknown }).turn).toEqual({ seq: 1, user: { content: 'go', attachments: [] }, retry: true });
    agent.leave();
  });

  it('finds nothing to follow in a chat with no live run', async () => {
    const { agent, runner, store } = setup();
    store.startNew();
    expect(await agent.reattach('c1')).toBe(false);
    expect(agent.running).toBe(false);
    expect(runner.requests.map((request) => request.path)).toEqual(['runs?conversationId=c1']);
  });

  it('feeds subagent cards and the page’s tool-result reports from the run', async () => {
    const progress = { set: vi.fn() };
    const { agent, runner, toolResults } = setup([], { progress });
    void agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const result: ChatToolResult = { name: 'create_app', input: { name: 'todo' }, output: { app: 'todo' }, isError: false };
    await pushAll(runner, 'r1', [
      { type: 'subagent-progress', toolCallId: 'd1', progress: { task: 'read the docs', steps: 2, toolCalls: 3, lastTool: 'site__search' } },
      { type: 'subagent-progress', toolCallId: 'd1', progress: null },
      { type: 'tool-reported', result },
    ]);
    await vi.waitFor(() => expect(toolResults).toHaveLength(1));
    expect(progress.set.mock.calls).toEqual([
      ['d1', { task: 'read the docs', steps: 2, toolCalls: 3, lastTool: 'site__search' }],
      ['d1', undefined],
    ]);
    expect(toolResults).toEqual([result]);
    agent.leave();
  });

  it('fails the turn with the runner’s words when the run ends in an error, offering Retry when it can carry on', async () => {
    const message = 'The assistant isn’t available right now.';
    const { agent, runner, store, errors } = setup([head('c1', [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'go', attachments: [] }, assistant: { messages: [], status: 'error', error: message } }])]);
    const sent = agent.send('go');
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    const trace = { stage: 'request', step: 2, msIntoStep: 5, message: 'upstream 503' } as const;
    runner.push('r1', { type: 'error', message, kind: 'assistant_unavailable', trace });
    runner.push('r1', ended([], 'error', { resumable: true, steps: 1 }));
    await sent;
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    const turn = store.current!.turns[0]!;
    // Read back from the head, with what is kept for this page only carried over: the kind, the trace, the resume point.
    expect(turn.assistant).toMatchObject({ status: 'error', error: message, errorKind: 'assistant_unavailable', errorTrace: trace, resume: { messages: [], steps: 1 } });
    expect(errors[0]).toEqual({ kind: 'assistant_unavailable', message, trace });
  });
});

/** A v3 head as the runner saves it while its reply to turn 1 still runs: nothing finished yet. */
function runningHead(conversationId: string): Workflow {
  return workflow({
    id: `head-${conversationId}`,
    tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${conversationId}`],
    metadata: {
      v: 3,
      app: 'chat-cvt',
      conversationId,
      title: 'Go',
      titleSource: 'first-message',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      turns: [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'go', attachments: [] }, assistant: { messages: [], status: 'running', savedAt: '2026-10-19T00:00:01Z' } }],
    },
  });
}

describe('RemoteAgent, a reply ended on the page without run-ended', () => {
  /** A run that showed some words and a finished tool call, then one still running, with the head saved still running. */
  async function partway(extra: Partial<RemoteAgentDeps> = {}) {
    const made = setup([runningHead('c1')], extra);
    void made.agent.send('go');
    await vi.waitFor(() => expect(made.runner.openStreams('r1')).toBe(1));
    await pushAll(made.runner, 'r1', [
      { type: 'text-delta', index: 0, text: 'Working on it.' },
      { type: 'tool-call', index: 1, toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'npm test' } },
      { type: 'tool-result', toolCallId: 't1', output: { exitCode: 0 } },
      { type: 'tool-call', index: 2, toolCallId: 't2', toolName: 'sandbox__run_command', input: { command: 'npm run build' } },
    ]);
    await vi.waitFor(() => expect(made.agent.live?.parts).toHaveLength(3));
    return made;
  }

  /** What the open chat's turn 1 shows now, as the thread draws it. */
  const shown = (store: ThreadStore) => partsFromMessages(store.current!.turns[0]!.assistant.messages);

  const kept = [
    { kind: 'text', text: 'Working on it.' },
    { kind: 'tool', toolCallId: 't1', toolName: 'sandbox__run_command', input: { command: 'npm test' }, state: 'done', output: { exitCode: 0 } },
    { kind: 'tool', toolCallId: 't2', toolName: 'sandbox__run_command', input: { command: 'npm run build' }, state: 'error' },
  ];

  it('keeps what the reply showed when the runner refuses Stop', async () => {
    const { agent, runner, store, rereads } = await partway();
    runner.knobs.refuseStop = { status: 403 };
    agent.abort();
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(rereads).toEqual(['c1']);
    expect(store.current!.turns[0]!.assistant.status).toBe('aborted');
    expect(shown(store)).toMatchObject(kept);
  });

  it('keeps what the reply showed when the run does not say it stopped in time', async () => {
    const { agent, store, rereads } = await partway({ stopGraceMs: 30 });
    agent.abort();
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(rereads).toEqual(['c1']);
    expect(store.current!.turns[0]!.assistant.status).toBe('aborted');
    expect(shown(store)).toMatchObject(kept);
  });

  it.each([401, 403])('keeps what the reply showed when the runner refuses the viewer (%i) mid-reply', async (status) => {
    const { agent, runner, store, rereads } = await partway();
    runner.knobs.refuseEvents = { status, times: 1_000_000 };
    runner.dropStreams('r1');
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(rereads).toEqual(['c1']);
    expect(store.current!.turns[0]!.assistant).toMatchObject({ status: 'error', errorKind: 'auth' });
    expect(shown(store)).toMatchObject(kept);
  });

  it('still takes a head whose reply finished meanwhile over what the page kept', async () => {
    const { agent, runner, store, heads } = await partway();
    heads.splice(0, 1, head('c1', [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: 'go', attachments: [] }, assistant: { messages: [{ role: 'assistant', content: 'All built.' }], status: 'done' } }]));
    runner.knobs.refuseStop = { status: 403 };
    agent.abort();
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(store.current!.turns[0]!.assistant.status).toBe('done');
    expect(shown(store)).toEqual([{ kind: 'text', text: 'All built.' }]);
  });
});

describe('RemoteAgent, a chat the page left and came back to while its lookup was on its way', () => {
  it('looks the chat up again, and follows its live run', async () => {
    const { agent, runner, store } = setup();
    runner.knobs.holdLookups = true;
    await runner.fetch(`${RUNNER_URL}/runs`, {
      method: 'POST',
      body: JSON.stringify({ v: 1, idempotencyKey: 'other', conversationId: 'c1', turn: { seq: 1, user: { content: 'hi', attachments: [] } }, model: 'm', settings: {} }),
    });
    // Open A: its lookup is held.
    await store.open('c1');
    const first = agent.reattach('c1');
    await vi.waitFor(() => expect(runner.requests.filter((request) => request.path === 'runs?conversationId=c1')).toHaveLength(1));
    // To B and back to A, as openConversation does (leave, then look up the chat opened).
    agent.leave();
    await store.open('c2');
    agent.leave();
    await store.open('c1');
    expect(await agent.reattach('c1')).toBe(false);
    runner.knobs.holdLookups = false;
    runner.releaseLookups();
    expect(await first).toBe(false);
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    expect(agent.running).toBe(true);
    expect(agent.live?.seq).toBe(1);
    agent.leave();
  });
});

