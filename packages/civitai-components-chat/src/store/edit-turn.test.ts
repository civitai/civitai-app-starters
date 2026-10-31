import type { ModelMessage } from 'ai';
import { describe, expect, it, vi } from 'vitest';

import { Agent } from '../agent/agent.js';
import { JobManager } from '../orchestration/jobs.js';
import { memoryStore } from '../test-support/fake-backend.js';
import { fakeHeads } from '../test-support/fake-heads.js';
import { scriptedModel, text, type Scripted } from '../test-support/scripted-model.js';
import type { Conversation, Turn } from '../types.js';
import { HostThreadStore } from './host-store.js';
import { editTurn, ThreadStore } from './thread-store.js';

/**
 * The viewer's edit of their latest message, as the stores save it and the page's own agent replies to
 * it: the message replaced in place (never a second copy), the reply that followed it dropped, and the
 * chat saved so at once.
 */

const FIRST = 'list four Andean lakes';
const FIRST_REPLY = 'Titicaca, Poopó, Junín and Parinacochas.';
const ORIGINAL = 'suggest a name for a grey cat';
const ORIGINAL_REPLY = 'How about Pebble?';
const EDITED = 'suggest a name for an orange dog';
const EDITED_REPLY = 'How about Marmalade?';

const NOW = '2026-10-23T09:00:00.000Z';
const LATER = '2026-10-23T09:05:00.000Z';

/** Every user message the model was asked with, and every assistant text, per request. */
function recorder(responses: Scripted[]) {
  const asked: { users: string[]; assistants: string[] }[] = [];
  const model = scriptedModel(responses);
  const doStream = model.doStream.bind(model);
  model.doStream = async (options) => {
    const prompt = options.prompt as { role: string; content: unknown }[];
    asked.push({ users: prompt.filter((m) => m.role === 'user').map((m) => JSON.stringify(m.content)), assistants: prompt.filter((m) => m.role === 'assistant').map((m) => JSON.stringify(m.content)) });
    return doStream(options);
  };
  return { model, asked };
}

function browserChat(responses: Scripted[]) {
  const heads = fakeHeads();
  let now = NOW;
  const store = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, newId: () => 'CONV1', ownReplies: null, locks: null, now: () => new Date(now) });
  const { model, asked } = recorder(responses);
  const agent = new Agent({ model: () => model, titleModel: () => scriptedModel([new Error('no titles here')]), store, jobs: new JobManager({} as never), toolSet: async () => ({}), attachments: () => [], now: () => new Date(now) });
  return { heads, store, agent, asked, later: () => (now = LATER) };
}

/** The latest head saved for CONV1, as a reload reads it. */
async function reload(heads: ReturnType<typeof fakeHeads>): Promise<Conversation> {
  const store = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, ownReplies: null, locks: null });
  return (await store.open('CONV1')).conversation;
}

/** A reply of `words` that starts streaming only once `open()` is called. */
function gated(words: string) {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const stream = (): ReadableStream<Record<string, unknown>> =>
    new ReadableStream({
      async start(controller) {
        controller.enqueue({ type: 'stream-start', warnings: [] });
        await opened;
        for (const part of text(words).slice(1)) controller.enqueue(part);
        controller.close();
      },
    });
  return { stream, open };
}

const shown = (turns: Turn[]) => turns.map((turn) => [turn.seq, turn.user.content, turn.assistant.status, JSON.stringify(turn.assistant.messages)]);
const said = (words: string): string => JSON.stringify([{ role: 'assistant', content: [{ type: 'text', text: words }] }] satisfies ModelMessage[]);

describe("the page's own agent, on an edit of the latest message", () => {
  it('saves the edited message at once with no reply, replies to it once, and a reload shows exactly that', async () => {
    const reply = gated(EDITED_REPLY);
    const { heads, store, agent, asked, later } = browserChat([text(FIRST_REPLY), text(ORIGINAL_REPLY), reply.stream]);
    await agent.send(FIRST);
    await agent.send(ORIGINAL);
    expect(asked).toHaveLength(2);
    const writes = heads.writes.length;
    later();

    const editing = agent.edit(EDITED);
    // Saved as it goes: the edited message, no reply to the old one, while the new reply has not come.
    await vi.waitFor(() => expect(heads.writes.length).toBe(writes + 1));
    await vi.waitFor(() => expect(asked).toHaveLength(3));
    const atOnce = heads.writes[writes]!.metadata as { turns: { seq: number; user: { content: string }; assistant?: unknown }[]; updatedAt: string };
    expect(atOnce.turns.map((turn) => [turn.seq, turn.user.content, turn.assistant === undefined])).toEqual([
      [1, FIRST, false],
      [2, EDITED, true],
    ]);
    expect(atOnce.updatedAt).toBe(LATER);
    reply.open();
    await editing;

    // Asked exactly once more, with the edited words and nothing of the old exchange.
    expect(asked).toHaveLength(3);
    expect(asked[2]!.users).toHaveLength(2);
    expect(asked[2]!.users[1]).toContain(EDITED);
    expect(asked[2]!.users[0]).toContain(FIRST);
    expect(JSON.stringify(asked[2])).not.toContain(ORIGINAL);
    expect(JSON.stringify(asked[2])).not.toContain(ORIGINAL_REPLY);
    expect(asked[2]!.assistants.join()).toContain(FIRST_REPLY);

    const expected = [
      [1, FIRST, 'done', said(FIRST_REPLY)],
      [2, EDITED, 'done', said(EDITED_REPLY)],
    ];
    expect(shown(store.current!.turns)).toEqual(expected);
    expect(shown((await reload(heads)).turns)).toEqual(expected);
  });

  it('edits a reply that failed: the failed reply goes, and nothing carries on from it', async () => {
    const { store, agent, asked } = browserChat([new Error('the model broke'), text(EDITED_REPLY)]);
    await agent.send(ORIGINAL);
    expect(store.current!.turns[0]!.assistant.status).toBe('error');
    await agent.edit(EDITED);
    expect(asked).toHaveLength(2);
    expect(JSON.stringify(asked[1])).not.toContain(ORIGINAL);
    expect(shown(store.current!.turns)).toEqual([[1, EDITED, 'done', said(EDITED_REPLY)]]);
    expect(store.current!.turns[0]!.assistant.resume).toBeUndefined();
  });

  it('does nothing while a reply runs: no second request, the message as sent', async () => {
    const reply = gated(ORIGINAL_REPLY);
    const { store, agent, asked } = browserChat([reply.stream]);
    const sending = agent.send(ORIGINAL);
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    expect(agent.running).toBe(true);
    await agent.edit(EDITED);
    expect(asked).toHaveLength(1);
    expect(store.current!.turns.map((turn) => turn.user.content)).toEqual([ORIGINAL]);
    reply.open();
    await sending;
    expect(shown(store.current!.turns)).toEqual([[1, ORIGINAL, 'done', said(ORIGINAL_REPLY)]]);
  });
});

describe('editUserTurn', () => {
  it("a host's store saves the edited chat at once, with no reply to the old message", async () => {
    const host = memoryStore();
    const threads = new HostThreadStore({ store: host, newId: () => 'C1', now: () => new Date(NOW) });
    const turn = threads.appendUserTurn(ORIGINAL, []);
    turn.assistant = { messages: [{ role: 'assistant', content: ORIGINAL_REPLY }], status: 'done' };
    await threads.completeTurn(turn);

    threads.editUserTurn(turn, EDITED);
    await vi.waitFor(() => expect(host.records.get('C1')!.turns[0]!.user.content).toBe(EDITED));
    expect(host.records.get('C1')!.turns).toEqual([{ seq: 1, createdAt: NOW, user: { content: EDITED, attachments: [] } }]);
    expect(host.records.get('C1')!.title).toBe(EDITED);
  });

  it('leaves a message that is not the latest as it is', async () => {
    const heads = fakeHeads();
    const store = new ThreadStore({ orchestration: heads.orchestration, api: heads.api, hideMatureContent: () => true, newId: () => 'CONV1', ownReplies: null, locks: null });
    const first = store.appendUserTurn(FIRST, []);
    first.assistant = { messages: [], status: 'done' };
    store.appendUserTurn(ORIGINAL, []);
    store.editUserTurn(first, EDITED);
    expect(store.current!.turns.map((turn) => turn.user.content)).toEqual([FIRST, ORIGINAL]);
    expect(first.assistant.status).toBe('done');
  });
});

describe('editTurn', () => {
  const conversation = (titleSource: Conversation['titleSource'], turns: Turn[]): Conversation => ({ id: 'C', title: 'Old title', titleSource, createdAt: NOW, updatedAt: NOW, turns });
  const turn = (seq: number): Turn => ({ seq, createdAt: NOW, user: { content: ORIGINAL, attachments: [{ id: 'u1-1', kind: 'image', source: { type: 'upload', blobId: 'blob-1' }, url: 'https://example.test/a.png' }], refs: ['g1-1'] }, assistant: { messages: [{ role: 'assistant', content: ORIGINAL_REPLY }], status: 'done', buzz: 3 } });

  it('replaces the words, keeps the files and references, and drops the reply but not what it cost', () => {
    const edited = turn(2);
    const chat = conversation('first-message', [turn(1), edited]);
    editTurn(chat, edited, EDITED, LATER);
    expect(edited).toEqual({ seq: 2, createdAt: NOW, user: { content: EDITED, attachments: [{ id: 'u1-1', kind: 'image', source: { type: 'upload', blobId: 'blob-1' }, url: 'https://example.test/a.png' }], refs: ['g1-1'] }, assistant: { messages: [], status: 'streaming', buzz: 3 } });
    expect(chat.updatedAt).toBe(LATER);
    // Not the first message: the chat keeps its name.
    expect(chat.title).toBe('Old title');
  });

  it('renames a chat named after its first message, and only such a chat', () => {
    const first = turn(1);
    const named = conversation('first-message', [first]);
    editTurn(named, first, EDITED, LATER);
    expect(named.title).toBe(EDITED);
    for (const source of ['llm', 'user'] as const) {
      const other = turn(1);
      const chat = conversation(source, [other]);
      editTurn(chat, other, EDITED, LATER);
      expect(chat.title).toBe('Old title');
    }
  });
});
