import { ulid } from 'ulid';

import type { SavedPanel } from '../panels/panel.js';
import type { SavedPost } from '../posting/post.js';
import type { Attachment, Conversation, TitleSource, Turn } from '../types.js';
import type { ChatConversation, ChatConversationStore, ConversationStore, ListedConversation } from './conversation-store.js';
import { clampTitle, firstMessageTitle, persistable, saved, turnFrom, type OpenedConversation } from './thread-store.js';

export interface HostThreadStoreDeps {
  store: ChatConversationStore;
  scope?: string;
  now?(): Date;
  newId?(): string;
}

/**
 * The chat's conversations kept by the host's own `ChatConversationStore`: every change saves the
 * whole conversation, one save at a time per conversation, each built from the latest state. Behaves
 * as `ThreadStore` does for the element: the user's message is saved at once (without the reply that
 * is still coming), and the reply when it ends.
 */
export class HostThreadStore extends EventTarget implements ConversationStore {
  summaries: ListedConversation[] = [];
  current: Conversation | null = null;

  #deps: HostThreadStoreDeps;
  #cursor: string | null = null;
  #saves = new Map<string, Promise<void>>();

  constructor(deps: HostThreadStoreDeps) {
    super();
    this.#deps = deps;
  }

  get hasMore(): boolean {
    return this.#cursor !== null;
  }

  async refreshList(): Promise<void> {
    this.#cursor = null;
    this.summaries = [];
    await this.loadMore(true);
  }

  async loadMore(first = false): Promise<void> {
    if (!first && this.#cursor === null) return;
    const page = await this.#deps.store.list({ ...this.#scope(), ...(this.#cursor ? { cursor: this.#cursor } : {}) });
    this.#cursor = page?.next || null;
    const known = new Set(this.summaries.map((summary) => summary.id));
    const added: ListedConversation[] = [];
    for (const item of Array.isArray(page?.items) ? page.items : []) {
      if (typeof item?.id !== 'string' || known.has(item.id)) continue;
      known.add(item.id);
      added.push({ id: item.id, title: typeof item.title === 'string' && item.title ? item.title : 'New chat', updatedAt: String(item.updatedAt ?? '') });
    }
    this.summaries = [...this.summaries, ...added];
    this.#emit('list-change');
  }

  async open(id: string): Promise<OpenedConversation> {
    const record = await this.#deps.store.load(id, this.#scope());
    const now = this.#now().toISOString();
    const turns = (Array.isArray(record?.turns) ? record.turns : []).map(turnFrom).sort((a, b) => a.seq - b.seq);
    this.current = {
      id,
      title: record?.title ?? 'New chat',
      titleSource: record?.titleSource ?? 'first-message',
      createdAt: record?.createdAt ?? now,
      updatedAt: record?.updatedAt ?? now,
      turns,
      ...(typeof record?.model === 'string' && record.model.trim() ? { model: record.model.trim() } : {}),
    };
    this.#emit('conversation-change');
    return { conversation: this.current, jobs: [] };
  }

  startNew(): Conversation {
    const now = this.#now().toISOString();
    this.current = { id: this.#deps.newId?.() ?? ulid(), title: 'New chat', titleSource: 'first-message', createdAt: now, updatedAt: now, turns: [] };
    this.#emit('conversation-change');
    return this.current;
  }

  appendUserTurn(content: string, attachments: Attachment[], refs: string[] = []): Turn {
    const conversation = this.current ?? this.startNew();
    const now = this.#now().toISOString();
    const seq = (conversation.turns.at(-1)?.seq ?? 0) + 1;
    if (seq === 1) conversation.title = firstMessageTitle(content);
    const turn: Turn = {
      seq,
      createdAt: now,
      user: { content, attachments: attachments.map(persistable), ...(refs.length ? { refs } : {}) },
      assistant: { messages: [], status: 'streaming' },
    };
    conversation.turns.push(turn);
    conversation.updatedAt = now;
    this.#save(conversation).catch((error: unknown) => console.warn('[chat-cvt] could not save the turn yet', error));
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
    return turn;
  }

  async completeTurn(_turn: Turn): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    await this.#save(conversation);
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
  }

  // Posts and panels run on Civitai, which a chat on a host backend never reaches: kept for this
  // session only, never saved.
  async savePost(id: string, post: SavedPost): Promise<void> {
    if (this.current) this.current.posts = { ...this.current.posts, [id]: post };
  }

  async savePanel(panel: SavedPanel): Promise<void> {
    if (this.current) this.current.panels = { ...this.current.panels, [panel.handle]: panel };
  }

  async setModel(model: string | undefined): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    const id = model?.trim();
    if (id) conversation.model = id;
    else delete conversation.model;
    this.#emit('conversation-change');
    // A reply still streaming saves it with that reply; a chat with nothing saved keeps it for its first save.
    if (conversation.turns.at(-1)?.assistant.status === 'streaming' || conversation.turns.length === 0) return;
    await this.#save(conversation);
  }

  async setTitle(title: string, source: TitleSource): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    conversation.title = clampTitle(title);
    conversation.titleSource = source;
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
    const newest = conversation.turns.at(-1);
    if (newest && newest.assistant.status !== 'streaming') await this.completeTurn(newest);
  }

  async rename(id: string, title: string): Promise<void> {
    if (this.current?.id === id) return this.setTitle(title, 'user');
    const record = await this.#deps.store.load(id, this.#scope());
    if (!record) return;
    const renamed: ChatConversation = { ...record, title: clampTitle(title), titleSource: 'user' };
    await this.#enqueue(id, () => renamed);
    this.summaries = this.summaries.map((s) => (s.id === id ? { ...s, title: renamed.title } : s));
    this.#emit('list-change');
  }

  async remove(id: string): Promise<void> {
    // A save still on its way would otherwise bring the conversation back after the delete.
    await this.#saves.get(id)?.catch(() => undefined);
    await this.#deps.store.delete(id, this.#scope());
    this.summaries = this.summaries.filter((summary) => summary.id !== id);
    if (this.current?.id === id) this.current = null;
    this.#emit('list-change');
    this.#emit('conversation-change');
  }

  #save(conversation: Conversation): Promise<void> {
    return this.#enqueue(conversation.id, () => this.#record(conversation));
  }

  // Each save replaces the whole conversation, so they go one at a time, each built from the latest state.
  #enqueue(id: string, record: () => ChatConversation): Promise<void> {
    const save = (this.#saves.get(id) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.#deps.store.save(record()));
    this.#saves.set(id, save);
    return save;
  }

  #record(conversation: Conversation): ChatConversation {
    return {
      id: conversation.id,
      title: conversation.title,
      titleSource: conversation.titleSource,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      turns: conversation.turns.map(saved),
      ...(conversation.model ? { model: conversation.model } : {}),
      ...this.#scope(),
    };
  }

  #scope(): { scope?: string } {
    return this.#deps.scope ? { scope: this.#deps.scope } : {};
  }

  #touchSummary(conversation: Conversation): void {
    const summary: ListedConversation = { id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt };
    this.summaries = [summary, ...this.summaries.filter((s) => s.id !== conversation.id)];
    this.#emit('list-change');
  }

  #now(): Date {
    return this.#deps.now?.() ?? new Date();
  }

  #emit(type: 'list-change' | 'conversation-change'): void {
    this.dispatchEvent(new Event(type));
  }
}
