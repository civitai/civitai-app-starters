import type { OrchestrationClient, Workflow, WorkflowQuery, WorkflowTemplate } from '@civitai/sdk';
import { ulid } from 'ulid';

import { APP_TAG, HEAD_TAG, JOB_TAG, TURN_TAG, conversationTag, scopeTag, stepLimit } from '../config.js';
import type { OrchestrationApi } from '../orchestration/api.js';
import type { SavedPanel } from '../panels/panel.js';
import type { SavedPost } from '../posting/post.js';
import type { JSONValue, ModelMessage } from 'ai';

import { DISPATCH_AGENT, interruptedSubagent, type SubagentCheckpoint } from '../agent/subagent-result.js';

import type { ConversationPatchRequest } from '../runner-protocol.js';
import type { Attachment, Conversation, ConversationSummary, JobMetadata, ResumePoint, SavedTurn, SavedTurnV3, StoredConversationMetadata, TitleSource, Turn } from '../types.js';
import { notFoundError, supersededError, type ConversationStore, type OpenOptions } from './conversation-store.js';

export interface ThreadStoreDeps {
  orchestration: Pick<OrchestrationClient, 'submitWorkflow' | 'queryWorkflows'>;
  api: Pick<OrchestrationApi, 'updateWorkflow' | 'removeTag' | 'deleteWorkflow'>;
  hideMatureContent(): boolean;
  /** Keeps an embedding app's conversations apart: each scope lists only its own. */
  scope?: string;
  now?(): Date;
  newId?(): string;
  /**
   * Where this tab notes the reply it started (`replyStarted`), so a reload of the tab knows a reply it
   * finds unfinished died here. The tab's `sessionStorage` unless set; `null` keeps no note.
   */
  ownReplies?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  /**
   * The browser's Web Locks (`navigator.locks`), shared by every tab of the origin, unless set; `null`
   * for none. A reply running in a tab holds a lock named for it; the browser drops a tab's locks when the
   * tab closes, crashes or is unloaded. With none, a reply is never taken as dead by its note alone.
   */
  locks?: Pick<LockManager, 'request' | 'query'> | null;
  /**
   * Remote mode (`runner: 'remote'`): a server-side runner is the only writer of every head, so this
   * store writes none. It still holds the open chat as the page changes it, and reads heads as ever. A
   * title the viewer or the assistant gave, and the chat's model, go to the runner as a patch (`patch`)
   * once the chat has a turn; before that, the model goes with its first run (`model`) and a title is
   * kept for this page only, as are posts and panels.
   */
  remote?: { patch(conversationId: string, patch: Omit<ConversationPatchRequest, 'v'>): Promise<void> };
}

/** The reply this tab started and has not seen end, and the time of the latest save this tab made of it. */
interface OwnReply {
  conversationId: string;
  seq: number;
  savedAt: string;
}

export interface OpenedConversation {
  conversation: Conversation;
  jobs: { metadata: JobMetadata; workflow: Workflow }[];
}

interface Head {
  workflowId: string;
  seq: number;
}

const LIST_PAGE = 30;
const PAGE = 100;
const MAX_PAGES = 20;
const TITLE_MAX = 60;
export const CUT_OFF = 'cut-off';

/**
 * Each turn saves the whole conversation as a new free `echo` workflow tagged as its head.
 * Workflows expire 30 days after creation, so a conversation lasts 30 days from its latest turn.
 */
export class ThreadStore extends EventTarget implements ConversationStore {
  #writes = new Map<string, Promise<void>>();
  summaries: ConversationSummary[] = [];
  current: Conversation | null = null;
  /** What the orchestrator charged for the latest save; unknown until this session saves once. */
  saveCost: number | undefined;

  #deps: ThreadStoreDeps;
  #cursor: string | null = null;
  #submits = new Map<string, Promise<string | undefined>>();
  #heads = new Map<string, Head>();
  /** Bumped by every open and new chat, so an open that lands after a later one cannot take its place. */
  #generation = 0;
  /** The chat each turn belongs to, so a reply that ends after the viewer left its chat is saved there. */
  #owners = new WeakMap<Turn, Conversation>();
  /** Chats deleted (or being deleted) here: a reply of theirs that ends after is not saved, which would bring them back. */
  #removed = new Set<string>();
  /** A running reply's finished steps so far (`checkpoint`): every save of the chat carries them, as `running`. */
  #progress = new WeakMap<Turn, ModelMessage[]>();
  /** A running reply's write subagents as far as each had got (`checkpointSubagent`), by `dispatch_agent` call id: saved with its progress. */
  #subagents = new WeakMap<Turn, Record<string, SubagentCheckpoint>>();
  /** Heads with a progress save queued and not yet built: another waits for that one, which is built from the latest state. */
  #checkpointQueued = new Set<string>();
  /** Replies running in this tab: the chat each is in, and how to let go of its lock once it ended. */
  #running = new Map<Turn, { conversationId: string; release: () => void }>();

  constructor(deps: ThreadStoreDeps) {
    super();
    this.#deps = deps;
  }

  /**
   * A reply starts in this tab: noted (in the tab's `sessionStorage`) with the latest save of it this tab
   * made, so a reload of the tab that finds it unfinished, and saved by no one since, knows it died here.
   */
  replyStarted(turn: Turn): void {
    const conversation = this.current;
    if (!conversation?.turns.includes(turn)) return;
    // Now: no save this tab made of it is later (a new message was saved as it was sent, a reply carried on was read before).
    this.#setOwnReply({ conversationId: conversation.id, seq: turn.seq, savedAt: this.#now().toISOString() });
    // Held while it runs here: another tab (a copy of this one included) asks whether it is held.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    try {
      this.#locks()?.request(this.#lockName(conversation.id, turn.seq), () => held).catch(() => undefined);
    } catch {
      // No lock: a note alone never marks this reply dead elsewhere.
    }
    this.#running.get(turn)?.release();
    this.#running.set(turn, { conversationId: conversation.id, release });
    // A new run of the reply (Retry/Continue): an earlier run's write subagents all have results by now,
    // and a record of theirs must not be read as this run's if a provider reuses a call id.
    this.#subagents.delete(turn);
  }

  /**
   * Saves a running reply's progress: the head is written as v3 with the reply `running`, its finished
   * steps and the step now running as far as its tool calls go. The write is free (a metadata update of
   * the turn's own `echo` workflow) and goes through the same one-at-a-time queue as every other, built from the latest state
   * when it goes, so nothing another change set meanwhile (title, model, posts, panels) is lost, and a
   * reply that ended meanwhile is written as it ended. One such write waits at most: more steps finishing
   * while it waits ride on it. Nothing until the turn's first save went through: its end saves it then.
   */
  async checkpoint(turn: Turn, { messages }: { messages: ModelMessage[] }): Promise<void> {
    const conversation = this.#ownerOf(turn);
    if (!conversation || turn.assistant.status !== 'streaming') return;
    this.#progress.set(turn, [...messages]);
    await this.#saveProgress(conversation, turn);
  }

  /**
   * Saves how far a write subagent of a running reply has got, with the reply's progress (see
   * `checkpoint`), through the same queue. Nothing until that reply has saved progress: its
   * `dispatch_agent` call is saved as it starts, and a subagent's record means nothing without it.
   */
  async checkpointSubagent(turn: Turn, toolCallId: string, progress: SubagentCheckpoint): Promise<void> {
    const conversation = this.#ownerOf(turn);
    if (!conversation || turn.assistant.status !== 'streaming') return;
    this.#subagents.set(turn, { ...this.#subagents.get(turn), [toolCallId]: progress });
    if (!this.#progress.has(turn)) return;
    await this.#saveProgress(conversation, turn);
  }

  async #saveProgress(conversation: Conversation, turn: Turn): Promise<void> {
    await this.#submits.get(submitKey(conversation.id, turn.seq));
    const head = this.#heads.get(conversation.id);
    if (head?.seq !== turn.seq || this.#checkpointQueued.has(head.workflowId)) return;
    this.#checkpointQueued.add(head.workflowId);
    await this.#writeHead(head.workflowId, () => {
      this.#checkpointQueued.delete(head.workflowId);
      return this.#metadata(conversation);
    });
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
    const page = await this.#deps.orchestration.queryWorkflows({
      tags: [APP_TAG, HEAD_TAG, ...this.#scopeTags()],
      take: LIST_PAGE,
      ...(this.#cursor ? { cursor: this.#cursor } : {}),
    });
    this.#cursor = page.next || null;
    const known = new Set(this.summaries.map((summary) => summary.id));
    const added: ConversationSummary[] = [];
    for (const workflow of page.items) {
      const metadata = conversationMetadataOf(workflow);
      // A head whose tag removal failed is older than the one listed before it.
      if (!metadata || known.has(metadata.conversationId) || !workflow.id || metadata.scope !== this.#deps.scope) continue;
      known.add(metadata.conversationId);
      added.push(summaryOf(workflow.id, metadata));
    }
    // Replaced, never mutated: Lit only re-renders a property that is a new object.
    this.summaries = [...this.summaries, ...added];
    this.#emit('list-change');
  }

  async open(id: string, options: OpenOptions = {}): Promise<OpenedConversation> {
    const generation = ++this.#generation;
    let heads: Awaited<ReturnType<OrchestrationClient['queryWorkflows']>>;
    let jobWorkflows: Workflow[];
    try {
      [heads, jobWorkflows] = await Promise.all([
        this.#deps.orchestration.queryWorkflows({ tags: [APP_TAG, HEAD_TAG, conversationTag(id)], take: 5 }),
        this.#all([APP_TAG, JOB_TAG, conversationTag(id)]),
      ]);
    } catch (error) {
      throw generation === this.#generation ? error : supersededError();
    }
    // The viewer opened or started another chat meanwhile: this one must not take its place.
    if (generation !== this.#generation) throw supersededError();
    const head = newestHead(heads.items);
    if (options.existing && !head) throw notFoundError();
    const now = this.#now().toISOString();
    const turns = (head?.metadata.turns ?? []).map(turnFrom).sort((a, b) => a.seq - b.seq);
    await this.#markLiveness(id, turns.at(-1));
    if (generation !== this.#generation) throw supersededError();
    options.ready?.();
    if (head) this.#heads.set(id, { workflowId: head.workflowId, seq: turns.at(-1)?.seq ?? 0 });
    this.current = {
      id,
      title: head?.metadata.title ?? 'New chat',
      titleSource: head?.metadata.titleSource ?? 'first-message',
      createdAt: head?.metadata.createdAt ?? now,
      updatedAt: head?.metadata.updatedAt ?? now,
      turns,
      ...(head?.metadata.posts ? { posts: head.metadata.posts } : {}),
      ...(head?.metadata.panels ? { panels: head.metadata.panels } : {}),
      ...(typeof head?.metadata.model === 'string' && head.metadata.model.trim() ? { model: head.metadata.model.trim() } : {}),
    };
    for (const turn of turns) this.#owners.set(turn, this.current);
    const jobs = jobWorkflows.flatMap((workflow) => {
      const metadata = jobMetadataOf(workflow);
      return metadata ? [{ metadata, workflow }] : [];
    });
    this.#emit('conversation-change');
    return { conversation: this.current, jobs };
  }

  startNew(): Conversation {
    this.#generation++;
    const now = this.#now().toISOString();
    this.current = { id: this.#deps.newId?.() ?? ulid(), title: 'New chat', titleSource: 'first-message', createdAt: now, updatedAt: now, turns: [] };
    this.#emit('conversation-change');
    return this.current;
  }

  /** Saves the conversation with the user's new message at once (free, instant), so a reload mid-reply keeps it. */
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
    this.#submits.set(submitKey(conversation.id, seq), this.#submitHead(conversation, seq));
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
    return turn;
  }

  /**
   * The viewer edited their latest message (`turn`), whose reply is asked for afresh: its text becomes
   * `content` and its reply is dropped (see {@link editTurn}). Saved at once, as a new message is, so a
   * reload mid-reply shows the edited message and no reply to the old one. Remote: the runner saves it.
   */
  editUserTurn(turn: Turn, content: string): void {
    const conversation = this.#ownerOf(turn);
    if (!conversation || conversation.turns.at(-1) !== turn) return;
    editTurn(conversation, turn, content, this.#now().toISOString());
    // Nothing of the old reply rides on a later save.
    this.#progress.delete(turn);
    this.#subagents.delete(turn);
    this.#saveTurn(conversation, turn).catch((error: unknown) => console.warn('[chat-cvt] could not save the edited message yet', error));
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
  }

  /**
   * Saves how the reply to `turn` ended into the chat it belongs to, which need not be the open one: the
   * viewer may have opened or started another while it ran (its reply is then stopped, and ends after).
   */
  async completeTurn(turn: Turn): Promise<void> {
    try {
      const conversation = this.#ownerOf(turn);
      if (!conversation) return;
      await this.#saveTurn(conversation, turn);
      this.#touchSummary(conversation);
      this.#emit('conversation-change');
    } finally {
      // How it ended is saved, or could not be: either way no reply of this tab's runs any more.
      if (turn.assistant.status !== 'streaming') this.#ended(turn);
    }
  }

  /** Writes the chat as it is now into the head of `turn`, submitting that head first when it has none yet. */
  async #saveTurn(conversation: Conversation, turn: Turn): Promise<void> {
    await this.#submits.get(submitKey(conversation.id, turn.seq));
    const head = this.#heads.get(conversation.id);
    if (head?.seq === turn.seq) {
      await this.#writeHead(head.workflowId, () => this.#metadata(conversation));
      return;
    }
    const submit = this.#submitHead(conversation, turn.seq);
    this.#submits.set(submitKey(conversation.id, turn.seq), submit);
    // A submit that timed out may have landed: the externalId hands back that workflow as it was.
    const workflowId = await submit;
    if (workflowId) await this.#writeHead(workflowId, () => this.#metadata(conversation));
  }

  /** The chat `turn` belongs to: the one it was added to or read with, else the open chat when it holds it. */
  #ownerOf(turn: Turn): Conversation | null {
    const owner = this.#owners.get(turn);
    const conversation = owner?.turns.includes(turn) ? owner : this.current?.turns.includes(turn) ? this.current : null;
    return conversation && !this.#removed.has(conversation.id) ? conversation : null;
  }

  /** A reply of this tab's ended: its lock is let go, its progress dropped, and its note (when it is the one noted) cleared. */
  #ended(turn: Turn): void {
    this.#progress.delete(turn);
    const running = this.#running.get(turn);
    this.#running.delete(turn);
    running?.release();
    const own = this.#ownReply();
    const conversationId = running?.conversationId ?? this.current?.id;
    if (own && own.conversationId === conversationId && own.seq === turn.seq) this.#setOwnReply(null);
  }

  async savePost(id: string, post: SavedPost): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    conversation.posts = { ...conversation.posts, [id]: post };
    const head = this.#heads.get(conversation.id);
    if (head) await this.#writeHead(head.workflowId, () => this.#metadata(conversation));
  }

  /**
   * Sets the open chat's own model (`undefined` follows the viewer's default again), from its next
   * reply. Saved with the chat; a chat with nothing saved yet keeps it for its first save.
   */
  async setModel(model: string | undefined): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    const id = model?.trim();
    if (id) conversation.model = id;
    else delete conversation.model;
    this.#emit('conversation-change');
    // Remote: the runner writes it, now or with the run that is live; a chat with nothing saved yet sends it with its first run.
    if (this.#deps.remote) {
      if (conversation.turns.length > 0) await this.#deps.remote.patch(conversation.id, { model: id || null });
      return;
    }
    // A reply still streaming saves it with that reply.
    if (conversation.turns.at(-1)?.assistant.status === 'streaming') return;
    const head = this.#heads.get(conversation.id);
    if (head) await this.#writeHead(head.workflowId, () => this.#metadata(conversation));
  }

  async savePanel(panel: SavedPanel): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    conversation.panels = { ...conversation.panels, [panel.handle]: panel };
    // A reply still streaming saves the panel with it; writing now could land after that save and drop the reply.
    if (conversation.turns.at(-1)?.assistant.status === 'streaming') return;
    const head = this.#heads.get(conversation.id);
    if (head) await this.#writeHead(head.workflowId, () => this.#metadata(conversation));
  }

  // Each write replaces the whole metadata, so they go one at a time per workflow, each built from the latest state.
  // Only a rename of a chat that is not open writes back a head as it was read, which may be a v3 one.
  #writeHead(workflowId: string, metadata: () => StoredConversationMetadata): Promise<void> {
    // Remote: the runner is the only writer of a head.
    if (this.#deps.remote) return Promise.resolve();
    const write = (this.#writes.get(workflowId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => {
        const built = metadata();
        this.#noteOwnSave(built);
        return this.#deps.api.updateWorkflow(workflowId, { metadata: built });
      });
    this.#writes.set(workflowId, write);
    return write;
  }

  async setTitle(title: string, source: TitleSource): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    conversation.title = clampTitle(title);
    conversation.titleSource = source;
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
    if (this.#deps.remote) {
      if (source !== 'first-message' && conversation.turns.length > 0) await this.#deps.remote.patch(conversation.id, { title: conversation.title, titleSource: source });
      return;
    }
    const newest = conversation.turns.at(-1);
    if (newest && newest.assistant.status !== 'streaming') await this.completeTurn(newest);
  }

  async rename(id: string, title: string): Promise<void> {
    if (this.current?.id === id) return this.setTitle(title, 'user');
    const summary = this.summaries.find((s) => s.id === id);
    if (!summary) return;
    const metadata: StoredConversationMetadata = { ...summary.head.metadata, title: clampTitle(title), titleSource: 'user' };
    if (this.#deps.remote) await this.#deps.remote.patch(id, { title: metadata.title, titleSource: 'user' });
    else await this.#writeHead(summary.head.workflowId, () => metadata);
    this.summaries = this.summaries.map((s) => (s.id === id ? { ...s, title: metadata.title, titleSource: 'user', head: { ...s.head, metadata } } : s));
    this.#emit('list-change');
  }

  async remove(id: string): Promise<void> {
    this.#removed.add(id);
    try {
      const workflows = await this.#all([APP_TAG, conversationTag(id)]);
      await Promise.all(workflows.map((workflow) => (workflow.id ? this.#deps.api.deleteWorkflow(workflow.id) : undefined)));
    } catch (error) {
      // Not deleted: its replies are saved again as usual.
      this.#removed.delete(id);
      throw error;
    }
    this.summaries = this.summaries.filter((summary) => summary.id !== id);
    this.#heads.delete(id);
    if (this.current?.id === id) this.current = null;
    this.#emit('list-change');
    this.#emit('conversation-change');
  }

  async #all(tags: string[]): Promise<Workflow[]> {
    const workflows: Workflow[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = {
        tags,
        take: PAGE,
        hideMatureContent: this.#deps.hideMatureContent(),
        ...(cursor ? { cursor } : {}),
      } as WorkflowQuery;
      const result = await this.#deps.orchestration.queryWorkflows(query);
      workflows.push(...result.items);
      if (!result.next) break;
      cursor = result.next;
    }
    return workflows;
  }

  async #submitHead(conversation: Conversation, seq: number): Promise<string | undefined> {
    // Remote: the runner saves the turn when its run starts.
    if (this.#deps.remote) return undefined;
    const template: WorkflowTemplate = {
      steps: [{ $type: 'echo', name: 'turn', input: { message: 'chat-cvt turn' } }],
      tags: [APP_TAG, TURN_TAG, HEAD_TAG, conversationTag(conversation.id), ...this.#scopeTags()],
      metadata: this.#metadata(conversation) as unknown as Record<string, unknown>,
      externalId: `cvt-head-${conversation.id}-${seq}`,
    };
    let workflowId: string | undefined;
    try {
      const workflow = await this.#deps.orchestration.submitWorkflow(template);
      workflowId = workflow.id ?? undefined;
      this.saveCost = workflow.cost?.total ?? 0;
    } catch (error) {
      console.warn('[chat-cvt] could not save the turn yet', error);
    }
    if (!workflowId) return undefined;
    const previous = this.#heads.get(conversation.id);
    this.#heads.set(conversation.id, { workflowId, seq });
    if (!previous) this.#emit('saved-change');
    this.#touchSummary(conversation);
    if (previous && previous.workflowId !== workflowId) {
      this.#deps.api.removeTag(previous.workflowId, HEAD_TAG).catch((error) => console.warn('[chat-cvt] an older save still counts as the latest', error));
    }
    return workflowId;
  }

  /**
   * The whole conversation as saved, from what this tab holds now. v2, unless a reply running here has
   * progress (`checkpoint`): then v3, with that reply `running`, its finished steps and this save's time.
   * A chat goes back to v2 once its reply ended, so a reader of v2 only lists it again.
   */
  #metadata(conversation: Conversation): StoredConversationMetadata {
    const savedAt = this.#now().toISOString();
    let running = false;
    const turns: SavedTurnV3[] = conversation.turns.map((turn) => {
      const progress = turn.assistant.status === 'streaming' ? this.#progress.get(turn) : undefined;
      if (!progress) return saved(turn);
      running = true;
      const subagents = unfinishedSubagents(progress, this.#subagents.get(turn));
      return { ...saved(turn), assistant: { messages: progress, status: 'running', savedAt, ...(subagents ? { subagents } : {}) } };
    });
    const shared = {
      app: 'chat-cvt' as const,
      conversationId: conversation.id,
      title: conversation.title,
      titleSource: conversation.titleSource,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      ...(conversation.posts ? { posts: conversation.posts } : {}),
      ...(conversation.panels ? { panels: conversation.panels } : {}),
      ...(this.#deps.scope ? { scope: this.#deps.scope } : {}),
      ...(conversation.model ? { model: conversation.model } : {}),
    };
    return running ? { v: 3, ...shared, turns } : { v: 2, ...shared, turns: turns as SavedTurn[] };
  }

  #locks(): Pick<LockManager, 'request' | 'query'> | null {
    if (this.#deps.locks !== undefined) return this.#deps.locks;
    try {
      return (globalThis.navigator as Navigator | undefined)?.locks ?? null;
    } catch {
      return null;
    }
  }

  #lockName(conversationId: string, seq: number): string {
    return `cvt-reply:${this.#deps.scope ?? ''}:${conversationId}:${seq}`;
  }

  #ownStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    if (this.#deps.ownReplies !== undefined) return this.#deps.ownReplies;
    try {
      return typeof sessionStorage === 'undefined' ? null : sessionStorage;
    } catch {
      return null;
    }
  }

  #ownKey(): string {
    return `cvt:own-reply${this.#deps.scope ? `:${this.#deps.scope}` : ''}`;
  }

  #ownReply(): OwnReply | null {
    try {
      const raw = this.#ownStorage()?.getItem(this.#ownKey());
      const own = raw ? (JSON.parse(raw) as Partial<OwnReply>) : null;
      return own && typeof own.conversationId === 'string' && typeof own.seq === 'number' && typeof own.savedAt === 'string' ? (own as OwnReply) : null;
    } catch {
      return null;
    }
  }

  #setOwnReply(own: OwnReply | null): void {
    try {
      const storage = this.#ownStorage();
      if (own) storage?.setItem(this.#ownKey(), JSON.stringify(own));
      else storage?.removeItem(this.#ownKey());
    } catch {
      // No note can be kept (storage off or full): a reload then reads its own reply by the time rule.
    }
  }

  /** A save this tab makes of the reply it started moves the note's time to that save's. */
  #noteOwnSave(metadata: StoredConversationMetadata): void {
    if (metadata.v !== 3) return;
    const own = this.#ownReply();
    if (own?.conversationId !== metadata.conversationId) return;
    const turn = metadata.turns.find((t) => t.seq === own.seq);
    const savedAt = turn?.assistant?.status === 'running' ? turn.assistant.savedAt : undefined;
    if (savedAt) this.#setOwnReply({ ...own, savedAt });
  }

  /**
   * Whether the latest turn read back unfinished is still running, as far as this browser can tell. A
   * tab running it holds its lock (`replyStarted`): held, it runs, whatever the save times say
   * (`heldElsewhere`). Not held, and it is the reply this tab noted (a reload, or a copy of this tab once
   * the original let go) with no save newer than the note's: nothing runs it, so it is gone at once
   * (`orphaned`). With no locks to ask, the note alone proves nothing (a copy of a tab carries it while
   * the original still runs the reply), and the time rule decides.
   */
  async #markLiveness(conversationId: string, turn: Turn | undefined): Promise<void> {
    if (!turn || turn.assistant.status !== 'error' || turn.assistant.error !== CUT_OFF || turn.assistant.savedAt === undefined) return;
    const locks = this.#locks();
    if (!locks) return;
    let held: boolean;
    try {
      const state = await locks.query();
      const name = this.#lockName(conversationId, turn.seq);
      held = [...(state.held ?? []), ...(state.pending ?? [])].some((lock) => lock.name === name);
    } catch {
      return;
    }
    if (held) {
      turn.assistant.heldElsewhere = true;
      return;
    }
    const own = this.#ownReply();
    if (own?.conversationId !== conversationId || own.seq !== turn.seq) return;
    const theirs = Date.parse(turn.assistant.savedAt);
    const mine = Date.parse(own.savedAt);
    if (!Number.isNaN(theirs) && !Number.isNaN(mine) && theirs <= mine) turn.assistant.orphaned = true;
  }


  #scopeTags(): string[] {
    return this.#deps.scope ? [scopeTag(this.#deps.scope)] : [];
  }

  #touchSummary(conversation: Conversation): void {
    const workflowId = this.#heads.get(conversation.id)?.workflowId ?? '';
    const summary = summaryOf(workflowId, this.#metadata(conversation));
    this.summaries = [summary, ...this.summaries.filter((s) => s.id !== conversation.id)];
    this.#emit('list-change');
  }

  #now(): Date {
    return this.#deps.now?.() ?? new Date();
  }

  isSaved(id: string): boolean {
    return this.#heads.has(id);
  }

  #emit(type: 'list-change' | 'conversation-change' | 'saved-change'): void {
    this.dispatchEvent(new Event(type));
  }
}

function submitKey(conversationId: string, seq: number): string {
  return `${conversationId}:${seq}`;
}

function summaryOf(workflowId: string, metadata: StoredConversationMetadata): ConversationSummary {
  return { id: metadata.conversationId, title: metadata.title, titleSource: metadata.titleSource, updatedAt: metadata.updatedAt, head: { workflowId, metadata } };
}

function newestHead(workflows: Workflow[]): { workflowId: string; metadata: StoredConversationMetadata } | undefined {
  let best: { workflowId: string; metadata: StoredConversationMetadata } | undefined;
  for (const workflow of workflows) {
    const metadata = conversationMetadataOf(workflow);
    if (!metadata || !workflow.id) continue;
    if (!best || lastSeq(metadata) > lastSeq(best.metadata)) best = { workflowId: workflow.id, metadata };
  }
  return best;
}

function lastSeq(metadata: StoredConversationMetadata): number {
  return Math.max(0, ...metadata.turns.map((turn) => turn.seq));
}

export function saved(turn: Turn): SavedTurn {
  const { assistant, ...rest } = turn;
  if (assistant.status === 'streaming') return rest;
  // The trace is for this session's diagnostics only: a response body may carry the reply's text. The
  // resume point is for this session too: a reopened chat's failed reply starts over when asked again.
  // `savedAt` is when the save this reply was read from was made: a reply saved again is no longer that one.
  const { errorTrace: _trace, networkRetries: _retries, resume: _resume, savedAt: _savedAt, orphaned: _orphaned, heldElsewhere: _held, ...kept } = assistant;
  return { ...rest, assistant: kept };
}

/**
 * The viewer's edit of their latest message, in place: `turn`'s text becomes `content` (its files and
 * references stay), the reply that followed it is dropped (the turn is replied to afresh, so it reads
 * as streaming and is saved with no reply), and a chat still named after this first message is named
 * after the edited one. The server runner's head does the same (`startTurn` with `edit`).
 */
export function editTurn(conversation: Conversation, turn: Turn, content: string, now: string): void {
  turn.user = { ...turn.user, content };
  turn.assistant = { messages: [], status: 'streaming' };
  conversation.updatedAt = now;
  if (turn.seq === 1 && conversation.titleSource === 'first-message') conversation.title = firstMessageTitle(content);
}

export function persistable(attachment: Attachment): Attachment {
  const { blocked: _blocked, ...rest } = attachment;
  return rest;
}

export function firstMessageTitle(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  if (flat === '') return 'New chat';
  if (flat.length <= 40) return flat;
  const cut = flat.slice(0, 40);
  const space = cut.lastIndexOf(' ');
  return `${space > 20 ? cut.slice(0, space) : cut}…`;
}

export function clampTitle(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”.]+$/g, '').trim();
  return (flat || 'New chat').slice(0, TITLE_MAX);
}

/** The head versions this version reads; it writes v2 (see {@link ConversationMetadataV3}). */
const READ_VERSIONS: ReadonlySet<unknown> = new Set([2, 3]);

/** A conversation head's metadata, when the workflow is one this version can read: v2 or v3. */
export function conversationMetadataOf(workflow: Workflow): StoredConversationMetadata | null {
  const metadata = workflow.metadata as Partial<StoredConversationMetadata> | null | undefined;
  if (!metadata || metadata.app !== 'chat-cvt' || !READ_VERSIONS.has(metadata.v) || !workflow.tags?.includes(HEAD_TAG)) return null;
  if (typeof metadata.conversationId !== 'string' || !Array.isArray(metadata.turns)) return null;
  return metadata as StoredConversationMetadata;
}

export function jobMetadataOf(workflow: Workflow): JobMetadata | null {
  const metadata = workflow.metadata as Partial<JobMetadata> | null | undefined;
  if (!metadata || metadata.app !== 'chat-cvt' || !workflow.tags?.includes(JOB_TAG)) return null;
  if (typeof metadata.job !== 'string' || typeof metadata.tool !== 'string') return null;
  return { ...(metadata as JobMetadata), seq: Number(metadata.seq) };
}

/**
 * How long after its latest save a reply read back cut off still counts as running elsewhere: another
 * tab or window (or, later, a server) may be running it. A v2 save is made only as the reply starts and
 * a v3 one after each step, so for v2 this is a guess at a whole reply and for v3 at one step. Past it,
 * the reply is taken as gone: asking again is offered, and a v3 reply with finished steps can Continue.
 * A dead reply read as live only waits; a live one read as dead invites a second run that is paid twice,
 * so this errs long.
 */
export const LIVE_REPLY_MS = 5 * 60_000;

/**
 * How far ahead of this page's clock a save time may be and still be believed: the clocks of two
 * devices differ by a little. A save further ahead was made by a clock that is wrong, so when it was
 * made is unknown, and it reads as gone. One that is ahead by less counts from now, so it reads live
 * for at most this plus {@link LIVE_REPLY_MS}.
 */
export const SAVE_CLOCK_SKEW_MS = 60_000;

/** The longest one wait for a live reply to go past may be: a longer one is cut and waited again. */
export const LIVE_REDRAW_MAX_MS = 60_000;

/** When the reply's latest save was made (ms since the epoch), as far as it can be believed; `undefined` when it cannot. */
function savedTime(turn: Turn, now: number): number | undefined {
  const { status, error, savedAt } = turn.assistant;
  if (status !== 'error' || error !== CUT_OFF || savedAt === undefined) return undefined;
  const at = Date.parse(savedAt);
  if (Number.isNaN(at) || at > now + SAVE_CLOCK_SKEW_MS) return Number.NaN;
  return Math.min(at, now);
}

/**
 * For the latest turn read back cut off with the time of its save (`assistant.savedAt`): `live` while
 * that save is under {@link LIVE_REPLY_MS} old, `stale` after, or when its time cannot be read or is
 * further ahead than {@link SAVE_CLOCK_SKEW_MS}. `undefined` for every other reply. The one rule for
 * both the note shown and whether asking again is allowed.
 */
export function replyElsewhere(turn: Turn, now: number = Date.now()): 'live' | 'stale' | undefined {
  const at = savedTime(turn, now);
  if (at === undefined) return undefined;
  // A tab of this browser holds its lock: it runs there, whatever the time.
  if (turn.assistant.heldElsewhere) return 'live';
  // This tab's own reply, which nothing runs any more (see `ThreadStore`'s note): gone, whatever the time.
  if (turn.assistant.orphaned) return 'stale';
  return !Number.isNaN(at) && now - at < LIVE_REPLY_MS ? 'live' : 'stale';
}

/** When a `live` reply (see {@link replyElsewhere}) turns `stale` (ms since the epoch); `undefined` otherwise. */
export function liveUntil(turn: Turn, now: number = Date.now()): number | undefined {
  return replyElsewhere(turn, now) === 'live' ? savedTime(turn, now)! + LIVE_REPLY_MS : undefined;
}

/**
 * How long to wait before drawing a `live` reply again to see whether it went past: just past its
 * {@link liveUntil}, at most {@link LIVE_REDRAW_MAX_MS} (then it is waited again). `undefined` otherwise.
 */
export function liveRedrawIn(turn: Turn, now: number = Date.now()): number | undefined {
  // Live while a tab holds its lock, past any save time: asked again each wait (the chat reads itself again).
  if (turn.assistant.heldElsewhere && replyElsewhere(turn, now) === 'live') return LIVE_REDRAW_MAX_MS;
  const until = liveUntil(turn, now);
  return until === undefined ? undefined : Math.min(LIVE_REDRAW_MAX_MS, Math.max(0, until - now) + 250);
}

/** The result a call that started and did not finish is given on Continue: it is not run again, and the model decides what to do. */
export const INTERRUPTED_CALL = 'interrupted: this call did not finish and was not re-run';

/**
 * `messages` with a result for every tool call: a call that started and has none (its page died before
 * it finished) gets {@link INTERRUPTED_CALL} as an error, right after the message that made it, beside
 * the results that did come in.
 */
function withInterruptedCalls(messages: ModelMessage[], subagents?: Record<string, unknown>): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    out.push(message);
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const next = messages[index + 1];
    const answered = new Set(next?.role === 'tool' ? next.content.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : [])) : []);
    const missing = message.content.flatMap((part) => (part.type === 'tool-call' && !answered.has(part.toolCallId) ? [interruptedResult(part.toolCallId, part.toolName, subagents)] : []));
    if (missing.length === 0) continue;
    if (next?.role === 'tool') {
      out.push({ ...next, content: [...next.content, ...missing] });
      index++;
    } else out.push({ role: 'tool', content: missing });
  }
  return out;
}

/**
 * The ids of the tool calls in `messages` that have no result: a call whose result is not in the tool
 * message right after the assistant message that made it (the rule {@link withInterruptedCalls} reads by).
 */
function unansweredCalls(messages: ModelMessage[]): Set<string> {
  const ids = new Set<string>();
  messages.forEach((message, index) => {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) return;
    const next = messages[index + 1];
    const answered = new Set(next?.role === 'tool' ? next.content.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : [])) : []);
    for (const part of message.content) if (part.type === 'tool-call' && !answered.has(part.toolCallId)) ids.add(part.toolCallId);
  });
  return ids;
}

/**
 * The write subagents worth saving with `messages`: only those whose `dispatch_agent` call has no result
 * there yet, the only ones Continue reads. One whose result is in is not saved again.
 */
function unfinishedSubagents(messages: ModelMessage[], subagents: Record<string, SubagentCheckpoint> | undefined): Record<string, SubagentCheckpoint> | undefined {
  if (!subagents) return undefined;
  const open = unansweredCalls(messages);
  const kept = Object.entries(subagents).filter(([id]) => open.has(id));
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * The result a call with none is given: {@link INTERRUPTED_CALL}, or, for the chat's own write subagent
 * saved with the reply's progress, its interrupted result with the files it had changed by then.
 */
function interruptedResult(toolCallId: string, toolName: string, subagents: Record<string, unknown> | undefined) {
  const subagent = toolName === DISPATCH_AGENT && subagents && Object.hasOwn(subagents, toolCallId) ? interruptedSubagent(subagents[toolCallId]) : undefined;
  return subagent
    ? { type: 'tool-result' as const, toolCallId, toolName, output: { type: 'json' as const, value: subagent as unknown as JSONValue } }
    : { type: 'tool-result' as const, toolCallId, toolName, output: { type: 'error-text' as const, value: INTERRUPTED_CALL } };
}

/**
 * Where a v3 reply saved `running` can carry on from: its saved steps, sent as they are, so no tool in
 * them runs again: a call that finished goes with its result, and one that started and did not finish
 * with {@link INTERRUPTED_CALL} (`messages` already carries those, see `interrupted`). None unless its
 * save time reads, it has steps, and it has steps left to take. A step is one assistant message (with
 * its tools' results after it).
 */
function continuePoint(messages: ModelMessage[], savedAt: unknown): ResumePoint | undefined {
  const at = typeof savedAt === 'string' ? Date.parse(savedAt) : NaN;
  if (Number.isNaN(at) || messages.length === 0) return undefined;
  const steps = messages.filter((message) => message.role === 'assistant').length;
  if (steps === 0 || steps >= stepLimit()) return undefined;
  return { messages, steps, at };
}

/**
 * A saved turn as the chat shows it. A reply saved before it ended reads as cut off, with the time of
 * that save (`savedAt`): with no reply saved (v2, saved as it started: the turn's start), or saved
 * `running` (v3, after a step: its own `savedAt`) with the steps it had finished, which stay on screen.
 * A v3 one also gets a resume point when it can carry on from them ({@link continuePoint}); whether it
 * may, now, is {@link replyElsewhere}'s to say: not while whoever saved it may still be running it.
 */
export function turnFrom(turn: SavedTurn | SavedTurnV3): Turn {
  const assistant = turn.assistant;
  return {
    seq: turn.seq,
    createdAt: turn.createdAt,
    user: { content: turn.user.content, attachments: turn.user.attachments ?? [], ...(turn.user.refs ? { refs: turn.user.refs } : {}) },
    assistant: !assistant ? { messages: [], status: 'error', error: CUT_OFF, savedAt: turn.createdAt } : assistant.status === 'running' ? interrupted(turn, assistant) : (assistant as Turn['assistant']),
  };
}

function interrupted(turn: SavedTurnV3, assistant: NonNullable<SavedTurnV3['assistant']>): Turn['assistant'] {
  // Shown and carried on from alike: a call that never finished reads as interrupted, not as still running.
  const subagents = assistant.subagents && typeof assistant.subagents === 'object' ? assistant.subagents : undefined;
  const messages = withInterruptedCalls(Array.isArray(assistant.messages) ? assistant.messages : [], subagents);
  const resume = continuePoint(messages, assistant.savedAt);
  const savedAt = typeof assistant.savedAt === 'string' ? assistant.savedAt : turn.createdAt;
  return { messages, status: 'error', error: CUT_OFF, savedAt, ...(resume ? { resume, errorKind: 'interrupted' } : {}) };
}
