import { ulid } from 'ulid';

import type { SavedPanel } from '../panels/panel.js';
import type { SavedPost } from '../posting/post.js';
import type { Attachment, Conversation, TitleSource, Turn } from '../types.js';
import { supersededError, type ChatConversation, type ChatConversationStore, type ConversationStore, type ListedConversation } from './conversation-store.js';
import { clampTitle, firstMessageTitle, persistable, saved, turnFrom, type OpenedConversation } from './thread-store.js';

export interface HostThreadStoreDeps {
  store: ChatConversationStore;
  scope?: string;
  now?(): Date;
  newId?(): string;
}

/**
 * The chat's conversations kept by the host's own `ChatConversationStore`: every change saves the
 * whole conversation, and every write for one conversation (save, rename, delete) goes through its
 * queue, one at a time in the order asked, each save built from the latest state. Behaves
 * as `ThreadStore` does for the element: the user's message is saved at once (without the reply that
 * is still coming), and the reply when it ends.
 */
export class HostThreadStore extends EventTarget implements ConversationStore {
  summaries: ListedConversation[] = [];
  current: Conversation | null = null;

  #deps: HostThreadStoreDeps;
  #cursor: string | null = null;
  /**
   * Each chat's queue: every write for one id (a save, a rename, the delete) runs one after another, in
   * the order it was asked for. Only the latest link is kept; it never rejects.
   */
  #saves = new Map<string, Promise<void>>();
  /** The conversation each turn belongs to: a reply ends in its own chat even after the viewer opened another. */
  #owners = new WeakMap<Turn, Conversation>();
  /** Deletes asked for and not yet settled, by id: such a chat is not listed until they all fail. */
  #deleting = new Map<string, number>();
  /** Bumped by every `open` and `startNew`: an `open` that finishes after a newer one is stale. */
  #generation = 0;
  /** Deleted in this session. A write queued after the delete is dropped; the chat is never opened, listed or listed again. */
  #deleted = new Set<string>();

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
      if (typeof item?.id !== 'string' || known.has(item.id) || this.#gone(item.id)) continue;
      known.add(item.id);
      added.push({ id: item.id, title: typeof item.title === 'string' && item.title ? item.title : 'New chat', updatedAt: String(item.updatedAt ?? '') });
    }
    this.summaries = [...this.summaries, ...added];
    this.#emit('list-change');
  }

  /**
   * Loads in the chat's queue: after every save and delete asked before it, and never while one runs.
   * A chat whose delete worked is refused, so it never becomes the open one, where nothing could save
   * it; one whose delete failed still exists and opens as usual.
   */
  async open(id: string): Promise<OpenedConversation> {
    const generation = ++this.#generation;
    let record: ChatConversation | null;
    try {
      record = await this.#queue(id, async () => {
        this.#refuseDeleted(id);
        return this.#deps.store.load(id, this.#scope());
      });
    } catch (error) {
      throw generation === this.#generation ? error : supersededError();
    }
    // The viewer opened or started another chat meanwhile: this one must not take its place.
    if (generation !== this.#generation) throw supersededError();
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
    const opened = this.current;
    for (const turn of turns) this.#owners.set(turn, opened);
    this.#emit('conversation-change');
    return { conversation: this.current, jobs: [] };
  }

  startNew(): Conversation {
    this.#generation++;
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
    this.#owners.set(turn, conversation);
    conversation.updatedAt = now;
    // Announced, if at all, by the save when the reply ends, which carries this message too: one note per send.
    this.#save(conversation).catch((error: unknown) => console.warn('[chat-cvt] could not save the message yet', error));
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
    return turn;
  }

  /**
   * Saves the reply with the chat it belongs to, which need not be the open one: the viewer may have
   * started or opened another while it ran. A failure is also told as `save-error`, since the agent
   * that calls this only logs it.
   */
  async completeTurn(turn: Turn): Promise<void> {
    await this.#finish(this.#owners.get(turn) ?? this.current, true);
  }

  /**
   * Saves a chat as it is now. Only the end of a reply announces a failure (`announce`). A rename
   * rejects to its caller, which says so; an automatic title is not announced, since every later
   * save carries it again.
   */
  async #finish(conversation: Conversation | null, announce: boolean): Promise<void> {
    if (!conversation) return;
    try {
      await this.#save(conversation);
    } catch (error) {
      if (announce) this.dispatchEvent(new CustomEvent('save-error', { detail: { id: conversation.id, error } }));
      throw error;
    }
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
    if (newest && newest.assistant.status !== 'streaming') await this.#finish(conversation, false);
  }

  async rename(id: string, title: string): Promise<void> {
    if (this.current?.id === id) return this.setTitle(title, 'user');
    // Loaded in the chat's queue, so a save still on its way lands first and is not overwritten, and a
    // rename after a delete finds the chat gone.
    const step = this.#queue(id, async () => {
      if (this.#deleted.has(id)) return null;
      const record = await this.#deps.store.load(id, this.#scope());
      if (!record) return null;
      const renamed: ChatConversation = { ...record, title: clampTitle(title), titleSource: 'user', ...this.#scope() };
      await this.#deps.store.save(renamed);
      return renamed;
    });
    const renamed = await step;
    if (!renamed) return;
    this.summaries = this.summaries.map((s) => (s.id === id ? { ...s, title: renamed.title } : s));
    this.#emit('list-change');
  }

  /**
   * Deletes the chat in its own queue: what was asked before it is written first, and what is asked
   * after it (a reply still running, its title, a rename) runs after it. If the delete worked, those
   * are dropped; if it failed, they run as usual, so the chat keeps everything said in it.
   */
  async remove(id: string): Promise<void> {
    // Counted and off the list at once, before its turn in the queue comes: the viewer cannot open a
    // chat whose delete is on its way, so no open waits on it.
    this.#deleting.set(id, (this.#deleting.get(id) ?? 0) + 1);
    const listed = this.summaries.find((summary) => summary.id === id);
    if (listed) {
      this.summaries = this.summaries.filter((summary) => summary !== listed);
      this.#emit('list-change');
    }
    try {
      await this.#delete(id);
    } catch (error) {
      // Still there: back on the list, unless another delete of it is on its way.
      if (listed && !this.#gone(id) && !this.summaries.some((summary) => summary.id === id)) {
        this.summaries = [...this.summaries, listed].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        this.#emit('list-change');
      }
      throw error;
    }
    this.summaries = this.summaries.filter((summary) => summary.id !== id);
    if (this.current?.id === id) this.current = null;
    this.#emit('list-change');
    this.#emit('conversation-change');
  }

  #delete(id: string): Promise<void> {
    return this.#queue(id, async () => {
      // Settled inside the queue, so the next step for this chat sees the delete's outcome, never a pending one.
      try {
        // Already gone (a second delete asked before the first was done): a host need not be asked twice.
        if (this.#deleted.has(id)) return;
        await this.#deps.store.delete(id, this.#scope());
        this.#deleted.add(id);
      } finally {
        const left = (this.#deleting.get(id) ?? 1) - 1;
        if (left > 0) this.#deleting.set(id, left);
        else this.#deleting.delete(id);
      }
    });
  }

  /**
   * Saves the conversation as it is when its turn in the chat's queue comes. Dropped only when the chat
   * was deleted before that turn came (the delete ran earlier in the same queue and worked); then the
   * chat no longer exists for anything to be lost from it.
   */
  #save(conversation: Conversation): Promise<void> {
    return this.#queue(conversation.id, async () => {
      if (!this.#deleted.has(conversation.id)) await this.#deps.store.save(this.#record(conversation));
    });
  }

  /** Deleted, or being deleted: left out of the list. */
  #gone(id: string): boolean {
    return this.#deleted.has(id) || this.#deleting.has(id);
  }

  #refuseDeleted(id: string): void {
    if (this.#deleted.has(id)) throw new Error('That chat was deleted.');
  }

  // Each save replaces the whole conversation, so everything that writes one goes one at a time, in order.
  #queue<T>(id: string, step: () => Promise<T>): Promise<T> {
    const run = (this.#saves.get(id) ?? Promise.resolve()).then(step);
    // The queue only orders: a failed step is the caller's to handle, never the next step's.
    this.#saves.set(id, run.then(() => undefined, () => undefined));
    return run;
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
    if (this.#gone(conversation.id)) return;
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
