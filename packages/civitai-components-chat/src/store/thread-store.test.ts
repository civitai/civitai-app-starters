import type { Workflow, WorkflowTemplate } from '@civitai/sdk';
import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { flush, workflow } from '../test-support/fakes.js';
import type { SavedPanel } from '../panels/panel.js';
import type { ConversationMetadata, SavedTurn, SavedTurnV3 } from '../types.js';
import { CUT_OFF, LIVE_REPLY_MS, ThreadStore, firstMessageTitle, liveUntil, replyElsewhere, saved, turnFrom } from './thread-store.js';

function setup(stored: Workflow[] = [], scope?: string) {
  const submitted: WorkflowTemplate[] = [];
  const deps = {
    orchestration: {
      submitWorkflow: vi.fn(async (template: WorkflowTemplate) => {
        submitted.push(template);
        return workflow({ id: `7-${submitted.length}` });
      }),
      queryWorkflows: vi.fn(async (query: { tags?: string[] }) => ({
        next: '',
        items: stored.filter((wf) => (query.tags ?? []).every((tag) => wf.tags?.includes(tag))),
      })),
    },
    api: { updateWorkflow: vi.fn(async () => undefined), removeTag: vi.fn(async () => undefined), deleteWorkflow: vi.fn(async () => undefined) },
    hideMatureContent: () => true,
    now: () => new Date('2026-09-23T10:00:00Z'),
    newId: () => 'CONV1',
    scope,
  };
  return { store: new ThreadStore(deps), deps, submitted };
}

const said = (seq: number, content: string, reply?: string): SavedTurn => ({
  seq,
  createdAt: '2026-09-20T00:00:00Z',
  user: { content, attachments: [] },
  ...(reply ? { assistant: { messages: [{ role: 'assistant', content: reply }], status: 'done' } } : {}),
});

function head(id: string, metadata: Partial<ConversationMetadata> & { conversationId: string }): Workflow {
  return workflow({
    id,
    status: 'succeeded',
    tags: ['chat-cvt', 'cvt:turn', 'cvt:head', `cvt:conv:${metadata.conversationId}`],
    metadata: { v: 2, app: 'chat-cvt', title: 'A chat', titleSource: 'first-message', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', turns: [said(1, 'hi')], ...metadata },
  });
}

describe('ThreadStore', () => {
  it("saves the conversation with the user's message at once, as a free, idempotent echo workflow", async () => {
    const { store, submitted } = setup();
    store.appendUserTurn('make me a logo for a bakery called Crumbs and Co', []);
    await flush();
    expect(submitted[0]).toMatchObject({
      steps: [{ $type: 'echo', input: { message: 'chat-cvt turn' } }],
      tags: ['chat-cvt', 'cvt:turn', 'cvt:head', 'cvt:conv:CONV1'],
      externalId: 'cvt-head-CONV1-1',
      metadata: { conversationId: 'CONV1', title: 'make me a logo for a bakery called…', turns: [{ seq: 1, user: { content: expect.stringContaining('bakery') } }] },
    });
    expect((submitted[0]!.metadata as unknown as ConversationMetadata).turns[0]).not.toHaveProperty('assistant');
    expect(store.summaries[0]).toMatchObject({ id: 'CONV1', head: { workflowId: '7-1' } });
  });

  it('writes the reply onto that save when it ends', async () => {
    const { store, deps } = setup();
    const turn = store.appendUserTurn('hello', []);
    turn.assistant = { messages: [{ role: 'assistant', content: 'hi there' }], status: 'done' };
    await store.completeTurn(turn);
    expect(deps.api.updateWorkflow).toHaveBeenCalledWith('7-1', {
      metadata: expect.objectContaining({ turns: [expect.objectContaining({ seq: 1, assistant: { messages: [{ role: 'assistant', content: 'hi there' }], status: 'done' } })] }),
    });
  });

  it("leaves an errored reply's trace and resume point out of the save, keeping what the viewer was told", async () => {
    const { store, deps } = setup();
    const turn = store.appendUserTurn('hello', []);
    turn.assistant = {
      messages: [],
      status: 'error',
      error: 'Lost the connection.',
      errorKind: 'network',
      errorTrace: { stage: 'request', step: 1, msIntoStep: 5, message: 'Failed to fetch' },
      // Where asking again would carry on from, for this session only.
      resume: { messages: [{ role: 'assistant', content: 'kept' }], steps: 1, at: 1 },
    };
    await store.completeTurn(turn);
    expect(deps.api.updateWorkflow).toHaveBeenCalledWith('7-1', {
      metadata: expect.objectContaining({ turns: [expect.objectContaining({ assistant: { messages: [], status: 'error', error: 'Lost the connection.', errorKind: 'network' } })] }),
    });
    expect(turn.assistant.errorTrace).toBeDefined();
    expect(turn.assistant.resume).toBeDefined();
  });

  it('carries every turn into the next save and retires the previous one as the head', async () => {
    const { store, deps, submitted } = setup();
    const first = store.appendUserTurn('hello', []);
    first.assistant = { messages: [{ role: 'assistant', content: 'hi' }], status: 'done' };
    await store.completeTurn(first);
    store.appendUserTurn('a cat please', []);
    await flush();
    expect((submitted[1]!.metadata as unknown as ConversationMetadata).turns.map((t) => [t.seq, t.user.content, t.assistant?.status])).toEqual([
      [1, 'hello', 'done'],
      [2, 'a cat please', undefined],
    ]);
    expect(submitted[1]).toMatchObject({ externalId: 'cvt-head-CONV1-2' });
    expect(deps.api.removeTag).toHaveBeenCalledWith('7-1', 'cvt:head');
  });

  it('lists each conversation once from its head, newest first', async () => {
    const { store, deps } = setup([
      head('7-3', { conversationId: 'B', title: 'Logo ideas' }),
      head('7-2', { conversationId: 'A', title: 'Cats in space', turns: [said(1, 'cats'), said(2, 'in space')] }),
      head('7-1', { conversationId: 'A', title: 'Cats' }),
    ]);
    await store.refreshList();
    expect(deps.orchestration.queryWorkflows).toHaveBeenCalledWith(expect.objectContaining({ tags: ['chat-cvt', 'cvt:head'] }));
    expect(store.summaries.map((s) => [s.id, s.title, s.head.workflowId])).toEqual([
      ['B', 'Logo ideas', '7-3'],
      ['A', 'Cats in space', '7-2'],
    ]);
  });

  it('rebuilds a conversation from its newest head, with its jobs, and says when a reply was cut off', async () => {
    const job = workflow({ id: '7-9', status: 'succeeded', tags: ['chat-cvt', 'cvt:job', 'cvt:conv:A'], metadata: { v: 1, app: 'chat-cvt', conversationId: 'A', seq: 1, job: 'gen1-1', toolCallId: 'c', tool: 'generate_image' } });
    const { store } = setup([
      head('7-1', { conversationId: 'A', title: 'Cats', turns: [said(1, 'cats')] }),
      job,
      head('7-2', { conversationId: 'A', title: 'Cats in space', turns: [said(1, 'cats', 'meow'), said(2, 'in space')] }),
    ]);
    const { conversation, jobs } = await store.open('A');
    expect(conversation.title).toBe('Cats in space');
    expect(conversation.turns.map((t) => [t.seq, t.assistant.status, t.assistant.error])).toEqual([
      [1, 'done', undefined],
      [2, 'error', CUT_OFF],
    ]);
    expect(jobs.map((j) => j.metadata.job)).toEqual(['gen1-1']);
  });

  it('keeps the head moving from a reopened conversation', async () => {
    const { store, deps, submitted } = setup([head('7-5', { conversationId: 'A', turns: [said(1, 'cats', 'meow')] })]);
    await store.open('A');
    store.appendUserTurn('more cats', []);
    await flush();
    expect((submitted[0]!.metadata as unknown as ConversationMetadata).turns).toHaveLength(2);
    expect(deps.api.removeTag).toHaveBeenCalledWith('7-5', 'cvt:head');
  });

  it('records how a post ended on the conversation, so it shows after a reload', async () => {
    const { store, deps } = setup([head('7-5', { conversationId: 'A', posts: { p0: { state: 'dismissed' } } })]);
    const { conversation } = await store.open('A');
    expect(conversation.posts).toEqual({ p0: { state: 'dismissed' } });
    await store.savePost('p1', { state: 'posted', postId: 9 });
    expect(deps.api.updateWorkflow).toHaveBeenCalledWith('7-5', { metadata: expect.objectContaining({ posts: { p0: { state: 'dismissed' }, p1: { state: 'posted', postId: 9 } } }) });
  });

  it('keeps panels with the conversation, but leaves saving to the reply while one is streaming', async () => {
    const panel: SavedPanel = { v: 1, id: 'U', handle: 'p1', seq: 1, toolCallId: 'c', versions: [], values: {}, runs: [] };
    const { store, deps } = setup([head('7-5', { conversationId: 'A', panels: { p1: panel } })]);
    const { conversation } = await store.open('A');
    expect(conversation.panels).toEqual({ p1: panel });

    await store.savePanel({ ...panel, handle: 'p2', runs: [{ job: 'p2-1', version: 1, values: {} }] });
    expect(deps.api.updateWorkflow).toHaveBeenLastCalledWith('7-5', { metadata: expect.objectContaining({ panels: { p1: panel, p2: expect.objectContaining({ runs: [{ job: 'p2-1', version: 1, values: {} }] }) } }) });

    store.appendUserTurn('make it warmer', []);
    deps.api.updateWorkflow.mockClear();
    await store.savePanel({ ...panel, values: { mood: 'warm' } });
    expect(deps.api.updateWorkflow).not.toHaveBeenCalled();
    expect(store.current?.panels?.p1?.values).toEqual({ mood: 'warm' });
  });

  it('writes the conversation one change at a time, each with everything known when it goes out, so none lands stale', async () => {
    const { store, deps } = setup([head('7-5', { conversationId: 'A' })]);
    await store.open('A');
    const sent: unknown[] = [];
    let release!: () => void;
    (deps.api.updateWorkflow as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (...args: unknown[]) => {
      sent.push(Object.keys((args[1] as { metadata: ConversationMetadata }).metadata.posts ?? {}));
      if (sent.length === 1) await new Promise<void>((resolve) => (release = resolve));
    });

    const first = store.savePost('p1', { state: 'posted', postId: 1 });
    const second = store.savePost('p2', { state: 'posted', postId: 2 });
    await flush();
    expect(sent).toHaveLength(1);

    release();
    await Promise.all([first, second]);
    expect(sent).toHaveLength(2);
    expect(sent.at(-1)).toEqual(['p1', 'p2']);
  });

  it('renames through the head, which is what the list reads', async () => {
    const { store, deps } = setup([head('7-2', { conversationId: 'A' })]);
    await store.refreshList();
    await store.rename('A', '  "Space cats."  ');
    expect(deps.api.updateWorkflow).toHaveBeenCalledWith('7-2', { metadata: expect.objectContaining({ title: 'Space cats', titleSource: 'user', turns: [expect.objectContaining({ seq: 1 })] }) });
    expect(store.summaries[0]?.title).toBe('Space cats');
  });

  it('deletes every workflow of a conversation', async () => {
    const { store, deps } = setup([head('7-1', { conversationId: 'A' }), head('7-5', { conversationId: 'B' })]);
    await store.refreshList();
    await store.remove('A');
    expect(deps.api.deleteWorkflow).toHaveBeenCalledTimes(1);
    expect(deps.api.deleteWorkflow).toHaveBeenCalledWith('7-1');
    expect(store.summaries.map((s) => s.id)).toEqual(['B']);
  });

  it('saves the whole turn again when the first save never went through', async () => {
    const { store, deps, submitted } = setup();
    deps.orchestration.submitWorkflow.mockRejectedValueOnce(new Error('offline'));
    const turn = store.appendUserTurn('hello', []);
    turn.assistant = { messages: [], status: 'done' };
    await store.completeTurn(turn);
    expect(submitted.at(-1)).toMatchObject({ externalId: 'cvt-head-CONV1-1' });
    expect(deps.api.updateWorkflow).toHaveBeenCalledWith('7-1', { metadata: expect.objectContaining({ turns: [expect.objectContaining({ assistant: { messages: [], status: 'done' } })] }) });
  });
  it("keeps each chat's own model with it, so it comes back after a reload, and an older chat has none", async () => {
    const { store, deps } = setup([head('7-1', { conversationId: 'A' }), head('8-1', { conversationId: 'B', model: 'b/own-model' })]);
    const { conversation } = await store.open('A');
    expect(conversation).not.toHaveProperty('model');

    await store.setModel('  a/picked-model ');
    expect(store.current?.model).toBe('a/picked-model');
    const written = () => (deps.api.updateWorkflow.mock.calls.at(-1) as unknown as [string, { metadata: ConversationMetadata }])[1].metadata;
    expect(written()).toMatchObject({ conversationId: 'A', model: 'a/picked-model' });

    await store.setModel(undefined);
    expect(store.current).not.toHaveProperty('model');
    expect(written()).not.toHaveProperty('model');

    expect((await store.open('B')).conversation.model).toBe('b/own-model');
  });

  it("leaves saving a model picked mid-reply to that reply, so the two writes cannot cross", async () => {
    const { store, deps } = setup([head('7-1', { conversationId: 'A' })]);
    await store.open('A');
    const turn = store.appendUserTurn('more please', []);
    await flush();
    const writes = deps.api.updateWorkflow.mock.calls.length;

    await store.setModel('d/mid-reply-model');
    expect(deps.api.updateWorkflow.mock.calls.length).toBe(writes);

    turn.assistant = { messages: [], status: 'done' };
    await store.completeTurn(turn);
    const last = deps.api.updateWorkflow.mock.calls.at(-1) as unknown as [string, { metadata: ConversationMetadata }];
    expect(last[1].metadata).toMatchObject({ model: 'd/mid-reply-model', turns: [{ seq: 1 }, { seq: 2, assistant: { status: 'done' } }] });
  });

  it('saves a new chat\'s model with its first message', async () => {
    const { store, submitted } = setup();
    store.startNew();
    await store.setModel('c/first-model');
    store.appendUserTurn('hello', []);
    await flush();
    expect(submitted[0]?.metadata).toMatchObject({ conversationId: 'CONV1', model: 'c/first-model' });
  });
});

describe('firstMessageTitle', () => {
  it('keeps short messages and cuts long ones at a word', () => {
    expect(firstMessageTitle('  a cat  ')).toBe('a cat');
    expect(firstMessageTitle('make me a logo for a bakery called Crumbs and Co')).toBe('make me a logo for a bakery called…');
  });

  it("keeps an embedding app's conversations apart from the rest", async () => {
    const plain = head('1-1', { conversationId: 'PLAIN' });
    const board = head('1-2', { conversationId: 'BOARD', scope: 'moodboard' });
    board.tags = [...(board.tags ?? []), 'cvt:scope:moodboard'];

    const scoped = setup([plain, board], 'moodboard');
    await scoped.store.refreshList();
    expect(scoped.store.summaries.map((s) => s.id)).toEqual(['BOARD']);
    scoped.store.appendUserTurn('hi', []);
    await flush();
    expect(scoped.submitted[0]?.tags).toContain('cvt:scope:moodboard');

    const standalone = setup([plain, board]);
    await standalone.store.refreshList();
    expect(standalone.store.summaries.map((s) => s.id)).toEqual(['PLAIN']);
  });

});

describe('conversation heads by version', () => {
  // A reply saved while it ran (v3): the step it finished (a tool call, its result, and the words it
  // said), and nothing of the step that was still going.
  const partial: ModelMessage[] = [
    { role: 'assistant', content: [{ type: 'text', text: 'Checking the bakery menu first.' }, { type: 'tool-call', toolCallId: 'call_menu', toolName: 'read_menu', input: { shop: 'Crumbs' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_menu', toolName: 'read_menu', output: { type: 'json', value: { items: 7 } } }] },
  ];
  const running: SavedTurnV3 = { seq: 2, createdAt: '2026-09-21T00:00:00Z', user: { content: 'now the logo', attachments: [] }, assistant: { messages: partial, status: 'running' } };
  const versioned = (id: string, v: number, conversationId: string, turns: SavedTurnV3[] = [said(1, 'hi', 'hello'), running]): Workflow => {
    const wf = head(id, { conversationId, title: `v${v} chat` });
    return { ...wf, metadata: { ...(wf.metadata as object), v, turns } } as Workflow;
  };

  it('lists a v3 head and opens its running reply as cut off, with the steps it finished on screen', async () => {
    const { store } = setup([versioned('3-1', 3, 'V3')]);
    await store.refreshList();
    expect(store.summaries.map((s) => [s.id, s.title, s.head.workflowId])).toEqual([['V3', 'v3 chat', '3-1']]);
    const { conversation } = await store.open('V3');
    expect(conversation.title).toBe('v3 chat');
    expect(conversation.turns.map((t) => [t.seq, t.assistant.status, t.assistant.error])).toEqual([
      [1, 'done', undefined],
      [2, 'error', CUT_OFF],
    ]);
    expect(conversation.turns[1]!.assistant.messages).toEqual(partial);
    // Never asked for again by itself or with one press: whoever saved it may still be running it.
    expect(conversation.turns[1]!.assistant).not.toHaveProperty('resume');
  });

  it('still lists and opens a v2 head', async () => {
    const { store } = setup([versioned('2-1', 2, 'V2', [said(1, 'cats', 'meow')])]);
    await store.refreshList();
    expect(store.summaries.map((s) => s.id)).toEqual(['V2']);
    const { conversation } = await store.open('V2');
    expect(conversation.turns.map((t) => [t.seq, t.assistant.status, t.assistant.messages])).toEqual([[1, 'done', [{ role: 'assistant', content: 'meow' }]]]);
  });

  it('leaves out a head of a version it does not know, in the list and when opened', async () => {
    const { store } = setup([versioned('4-1', 4, 'V4'), versioned('1-1', 1, 'V1'), versioned('2-1', 2, 'V2', [said(1, 'cats', 'meow')])]);
    await store.refreshList();
    expect(store.summaries.map((s) => s.id)).toEqual(['V2']);
    const { conversation } = await store.open('V4');
    expect(conversation).toMatchObject({ id: 'V4', title: 'New chat', turns: [] });
  });

  // Invariant guard (not a regression test): this version reads v3 and must still write v2.
  it('writes v2 after a v3 head was opened, with the running reply saved as cut off', async () => {
    const { store, deps, submitted } = setup([versioned('3-1', 3, 'V3')]);
    await store.open('V3');
    const turn = store.appendUserTurn('try again', []);
    await flush();
    turn.assistant = { messages: [{ role: 'assistant', content: 'Here it is.' }], status: 'done' };
    await store.completeTurn(turn);
    const sent = submitted[0]!.metadata as unknown as ConversationMetadata;
    const written = (deps.api.updateWorkflow.mock.calls.at(-1) as unknown as [string, { metadata: ConversationMetadata }])[1].metadata;
    for (const metadata of [sent, written]) {
      expect(metadata.v).toBe(2);
      expect(metadata.turns[1]!.assistant).toEqual({ messages: partial, status: 'error', error: CUT_OFF });
    }
    expect(written.turns.map((t) => t.assistant?.status)).toEqual(['done', 'error', 'done']);
  });
});

describe('a reply read back before it ended: still running elsewhere, or gone', () => {
  // The fake "now" every case reads; fixtures sit well inside or well past LIVE_REPLY_MS (5 min), never on it.
  const NOW = Date.parse('2026-10-19T15:00:00Z');
  const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
  const v2Pending = (createdAt: string): SavedTurn => ({ seq: 2, createdAt, user: { content: 'build it', attachments: [] } });
  const step: ModelMessage[] = [
    { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'call_run', toolName: 'run_command', input: { cmd: 'npm test' } }] },
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_run', toolName: 'run_command', output: { type: 'json', value: { exit: 0 } } }] },
  ];
  const v3Running = (savedAt: string | undefined, messages: ModelMessage[] = step): SavedTurnV3 => ({
    seq: 2,
    createdAt: ago(40),
    user: { content: 'build it', attachments: [] },
    assistant: { messages, status: 'running', ...(savedAt !== undefined ? { savedAt } : {}) },
  });

  it('dates a v2 reply saved as it started by the turn start: live under 5 minutes, gone after', () => {
    expect(replyElsewhere(turnFrom(v2Pending(ago(1))), NOW)).toBe('live');
    expect(replyElsewhere(turnFrom(v2Pending(ago(30))), NOW)).toBe('stale');
    expect(liveUntil(turnFrom(v2Pending(ago(1))), NOW)).toBe(NOW - 60_000 + LIVE_REPLY_MS);
    expect(liveUntil(turnFrom(v2Pending(ago(30))), NOW)).toBeUndefined();
  });

  it('dates a v3 running reply by its latest save, not by the turn start', () => {
    // The turn began 40 minutes ago; its latest step was saved a minute ago.
    expect(replyElsewhere(turnFrom(v3Running(ago(1))), NOW)).toBe('live');
    expect(replyElsewhere(turnFrom(v3Running(ago(30))), NOW)).toBe('stale');
    // No save time: the turn start stands in.
    expect(replyElsewhere(turnFrom(v3Running(undefined)), NOW)).toBe('stale');
  });

  it('reads a time it cannot parse as gone, and says nothing of other replies', () => {
    expect(replyElsewhere(turnFrom(v2Pending('not a date')), NOW)).toBe('stale');
    expect(replyElsewhere(turnFrom(said(1, 'hi', 'hello')), NOW)).toBeUndefined();
    // Saved again cut off (by a later save of the chat): no save time is kept, so it is not taken as running.
    expect(replyElsewhere(turnFrom({ seq: 1, createdAt: ago(1), user: { content: 'x', attachments: [] }, assistant: { messages: [], status: 'error', error: CUT_OFF } }), NOW)).toBeUndefined();
  });

  it('lets a v3 running reply carry on from its finished steps only when every call in them has its result', () => {
    expect(turnFrom(v3Running(ago(30))).assistant).toMatchObject({ errorKind: 'interrupted', resume: { messages: step, steps: 1, at: NOW - 30 * 60_000 } });
    // A call with no result may have run: carrying on could run it again.
    expect(turnFrom(v3Running(ago(30), [step[0]!])).assistant).not.toHaveProperty('resume');
    // No save time, or no steps: nothing to carry on from.
    expect(turnFrom(v3Running(undefined)).assistant).not.toHaveProperty('resume');
    expect(turnFrom(v3Running(ago(30), [])).assistant).not.toHaveProperty('resume');
  });

  it('does not save the read-back time again', () => {
    expect(saved(turnFrom(v2Pending(ago(1)))).assistant).toEqual({ messages: [], status: 'error', error: CUT_OFF });
  });
});
