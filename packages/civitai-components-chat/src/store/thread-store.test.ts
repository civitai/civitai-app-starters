import type { Workflow, WorkflowTemplate } from '@civitai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { flush, workflow } from '../test-support/fakes.js';
import type { SavedPanel } from '../panels/panel.js';
import type { ConversationMetadata, SavedTurn } from '../types.js';
import { CUT_OFF, ThreadStore, firstMessageTitle } from './thread-store.js';

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
