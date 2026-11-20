import type { Workflow, WorkflowTemplate } from '@civitai/sdk';
import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import type { RunEvent, StartRunRequest } from '../runner-protocol.js';
import { ThreadStore } from '../store/thread-store.js';
import { fakeRunner, RUNNER_URL } from '../test-support/fake-runner.js';
import { workflow } from '../test-support/fakes.js';
import { RemoteAgent } from './remote-agent.js';
import { RunnerClient } from './runner-client.js';

/**
 * Edit of the viewer's latest message when replies run on a server runner: offered only once the
 * runner said it takes edits, sent as a start of the same turn with `edit` (never `retry`, so a runner
 * that does not know `edit` refuses it rather than replying to the old message).
 */

const SETTINGS = { maxOutputTokens: 4096, tier: 'auto', allowMature: false, autoRunLimit: 10, spokenReplies: false } as const;
const ORIGINAL = 'draw a lighthouse at dusk';
const ORIGINAL_REPLY: ModelMessage[] = [{ role: 'assistant', content: [{ type: 'text', text: 'Here is your lighthouse.' }] }];
const EDITED = 'draw a windmill at dawn';
const EDITED_REPLY: ModelMessage[] = [{ role: 'assistant', content: [{ type: 'text', text: 'Here is your windmill.' }] }];

/** The runner's saved chat `c1`, with its one turn as `turn` says. */
function head(turn: { content: string; reply: ModelMessage[] }): Workflow {
  return workflow({
    id: 'head-c1',
    tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:c1'],
    metadata: {
      v: 2,
      app: 'chat-cvt',
      conversationId: 'c1',
      title: 'Saved',
      titleSource: 'llm',
      createdAt: '2026-10-19T00:00:00Z',
      updatedAt: '2026-10-19T00:00:00Z',
      turns: [{ seq: 1, createdAt: '2026-10-19T00:00:00Z', user: { content: turn.content, attachments: [] }, assistant: { messages: turn.reply, status: 'done' } }],
    },
  });
}

function setup(features?: unknown, reconnectDelaysMs: readonly number[] = [0]) {
  const runner = fakeRunner();
  if (features !== undefined) runner.knobs.features = features;
  const heads: Workflow[] = [head({ content: ORIGINAL, reply: ORIGINAL_REPLY })];
  const submitWorkflow = vi.fn(async (_: WorkflowTemplate) => workflow({ id: 'never' }));
  const updateWorkflow = vi.fn(async () => undefined);
  const store = new ThreadStore({
    orchestration: { submitWorkflow, queryWorkflows: vi.fn(async (query: { tags?: string[] }) => ({ items: query.tags?.includes('cvt:job') ? [] : [...heads], next: '' })) as never },
    api: { updateWorkflow, removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn(async () => undefined) },
    hideMatureContent: () => true,
    newId: () => 'c1',
    ownReplies: null,
    locks: null,
    remote: { patch: vi.fn(async () => undefined) },
  });
  let keys = 0;
  const agent = new RemoteAgent({
    client: new RunnerClient({ url: RUNNER_URL, fetch: runner.fetch, reconnectDelaysMs }),
    store,
    model: () => 'model-a',
    settings: () => SETTINGS,
    reread: async (id) => {
      await store.open(id);
    },
    newKey: () => `key-${++keys}`,
  });
  let changes = 0;
  agent.addEventListener('change', () => changes++);
  const starts = () => runner.requests.filter((request) => request.method === 'POST' && request.path === 'runs').map((request) => request.body as StartRunRequest);
  return { runner, store, agent, heads, submitWorkflow, updateWorkflow, starts, changes: () => changes };
}

/** Opens the saved chat and looks for a run in it, as the page does on opening a chat. */
async function opened(features?: unknown, reconnectDelaysMs?: readonly number[]) {
  const made = setup(features, reconnectDelaysMs);
  await made.store.open('c1');
  await made.agent.reattach('c1');
  return made;
}

async function endRun(runner: ReturnType<typeof fakeRunner>, runId: string, messages: ModelMessage[]) {
  const event: RunEvent = { type: 'run-ended', status: 'done', messages, steps: 1 };
  runner.push(runId, event);
}

describe('RemoteAgent edit', () => {
  it('is not offered by a runner that lists no features (an older runner), and sends nothing', async () => {
    const { agent, runner, store } = await opened();
    expect(runner.requests.filter((request) => request.path.startsWith('runs?'))).toHaveLength(1);
    expect(agent.canEdit).toBe(false);
    await agent.edit(EDITED);
    expect(runner.requests.filter((request) => request.method === 'POST')).toEqual([]);
    expect(store.current!.turns[0]!.user.content).toBe(ORIGINAL);
    expect(store.current!.turns[0]!.assistant.messages).toEqual(ORIGINAL_REPLY);
  });

  it('is offered once a lookup lists `edit`, which the page hears as a change', async () => {
    const { agent, changes } = await opened(['edit']);
    expect(agent.canEdit).toBe(true);
    expect(changes()).toBe(1);
  });

  it('ignores features it does not know, and a features field that is not a list', async () => {
    expect((await opened(['regenerate', 7])).agent.canEdit).toBe(false);
    expect((await opened('edit')).agent.canEdit).toBe(false);
  });

  it('starts the same turn with the edited message and `edit`, never `retry`, dropping the old reply on the page', async () => {
    const { agent, runner, store, starts, submitWorkflow, updateWorkflow, heads } = await opened(['edit']);
    const turn = store.current!.turns[0]!;
    const editing = agent.edit(EDITED);
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    expect(starts()).toEqual([
      {
        v: 1,
        idempotencyKey: 'key-1',
        conversationId: 'c1',
        turn: { seq: 1, user: { content: EDITED, attachments: [] }, edit: true },
        model: 'model-a',
        settings: SETTINGS,
      },
    ]);
    // The page shows the edited message with no reply to the old one, and writes nothing: the runner saves it.
    expect(store.current!.turns).toHaveLength(1);
    expect(store.current!.turns[0]).toBe(turn);
    expect(turn.user.content).toBe(EDITED);
    expect(turn.assistant).toEqual({ messages: [], status: 'streaming' });
    expect(agent.running).toBe(true);
    expect(submitWorkflow).not.toHaveBeenCalled();
    expect(updateWorkflow).not.toHaveBeenCalled();

    // The runner saved the edited turn and its new reply; the page reads it back once the run ended.
    heads.splice(0, heads.length, head({ content: EDITED, reply: EDITED_REPLY }));
    await endRun(runner, 'r1', EDITED_REPLY);
    await editing;
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(store.current!.turns.map((t) => [t.seq, t.user.content, t.assistant.status])).toEqual([[1, EDITED, 'done']]);
    expect(store.current!.turns[0]!.assistant.messages).toEqual(EDITED_REPLY);
  });

  it('a first start whose answer lists `edit` makes the next message editable', async () => {
    const made = setup(['edit']);
    made.heads.splice(0);
    made.store.startNew();
    expect(made.agent.canEdit).toBe(false);
    const sending = made.agent.send(ORIGINAL);
    await vi.waitFor(() => expect(made.runner.openStreams('r1')).toBe(1));
    expect(made.agent.canEdit).toBe(true);
    made.heads.push(head({ content: ORIGINAL, reply: ORIGINAL_REPLY }));
    await endRun(made.runner, 'r1', ORIGINAL_REPLY);
    await sending;
    await vi.waitFor(() => expect(made.agent.running).toBe(false));
    void made.agent.edit(EDITED);
    await vi.waitFor(() => expect(made.starts()).toHaveLength(2));
    expect(made.starts()[1]!.turn).toEqual({ seq: 1, user: { content: EDITED, attachments: [] }, edit: true });
  });

  it('does nothing while a reply runs', async () => {
    const { agent, runner, store, starts } = await opened(['edit']);
    void agent.edit(EDITED);
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    await agent.edit('draw a castle at noon');
    expect(starts()).toHaveLength(1);
    expect(store.current!.turns[0]!.user.content).toBe(EDITED);
  });

  it('a refused edit, asked again, goes as the edit again (the runner still holds the old message)', async () => {
    const { agent, runner, store, starts, heads } = await opened(['edit']);
    runner.knobs.refuseStart = { status: 409, body: { v: 1, error: 'run-active', message: 'Busy.', runId: 'other' } };
    await agent.edit(EDITED);
    await vi.waitFor(() => expect(store.current!.turns[0]!.assistant.status).toBe('error'));
    expect(agent.running).toBe(false);

    runner.knobs.refuseStart = undefined;
    void agent.retry();
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    expect(starts()[1]!.turn).toEqual({ seq: 1, user: { content: EDITED, attachments: [] }, edit: true });
    // Once the runner took it (and saved the edited message), a retry of a later failure is an ordinary retry.
    await vi.waitFor(() => expect(runner.openStreams('r1')).toBe(1));
    heads.splice(0, heads.length, head({ content: EDITED, reply: [] }));
    runner.push('r1', { type: 'error', message: 'The model broke.', trace: { stage: 'request', step: 0, msIntoStep: 0, message: 'The model broke.' } });
    runner.push('r1', { type: 'run-ended', status: 'error', messages: [], steps: 0, resumable: false });
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(store.current!.turns[0]!.assistant.status).toBe('error');
    void agent.retry();
    await vi.waitFor(() => expect(starts()).toHaveLength(3));
    expect(starts()[2]!.turn).toEqual({ seq: 1, user: { content: EDITED, attachments: [] }, retry: true });
  });

  it('an edit of a turn whose start was given up on asks with a fresh key, so Retry never brings back the run of the old message', async () => {
    // A first wait longer than START_GIVE_UP_MS: a start that gets no answer is given up at once.
    const { agent, runner, store, starts } = await opened(['edit'], [61_000]);
    // The next message reaches the runner (its run r1 starts, with key-1) but the answer is lost: given
    // up with Retry, and its key kept so a Retry finds r1 rather than being refused as run-active.
    runner.knobs.refuseConcurrent = true;
    runner.knobs.loseStartAnswers = 1;
    await agent.send(ORIGINAL);
    const turn = store.current!.turns.at(-1)!;
    await vi.waitFor(() => expect(turn.assistant.status).toBe('error'));
    expect(starts().map((start) => start.idempotencyKey)).toEqual(['key-1']);
    expect(runner.runs.get('r1')!.live).toBe(true);

    // The viewer edits that message instead: the runner refuses it while r1 runs.
    await agent.edit(EDITED);
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    expect(starts()[1]).toMatchObject({ idempotencyKey: 'key-2', turn: { user: { content: EDITED }, edit: true } });
    expect(turn.assistant.status).toBe('error');

    // Retry asks for the edit again, never with key-1: that key is r1's, the run of the OLD message, and
    // the runner would answer with it, dropping the edit without a word.
    void agent.retry();
    await vi.waitFor(() => expect(starts()).toHaveLength(3));
    expect(starts()[2]).toMatchObject({ turn: { user: { content: EDITED }, edit: true } });
    expect(starts()[2]!.idempotencyKey).not.toBe('key-1');
    await vi.waitFor(() => expect(agent.running).toBe(false));
    expect(runner.openStreams('r1')).toBe(0);
    expect(runner.runs.size).toBe(1);
    agent.leave();
  });
});
