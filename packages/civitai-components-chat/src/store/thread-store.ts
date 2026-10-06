import type { OrchestrationClient, Workflow, WorkflowQuery, WorkflowTemplate } from '@civitai/sdk';
import { ulid } from 'ulid';

import { APP_TAG, HEAD_TAG, JOB_TAG, TURN_TAG, conversationTag, scopeTag } from '../config.js';
import type { OrchestrationApi } from '../orchestration/api.js';
import type { SavedPanel } from '../panels/panel.js';
import type { SavedPost } from '../posting/post.js';
import type { Attachment, Conversation, ConversationMetadata, ConversationSummary, JobMetadata, SavedTurn, TitleSource, Turn } from '../types.js';

export interface ThreadStoreDeps {
  orchestration: Pick<OrchestrationClient, 'submitWorkflow' | 'queryWorkflows'>;
  api: Pick<OrchestrationApi, 'updateWorkflow' | 'removeTag' | 'deleteWorkflow'>;
  hideMatureContent(): boolean;
  /** Keeps an embedding app's conversations apart: each scope lists only its own. */
  scope?: string;
  now?(): Date;
  newId?(): string;
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
export class ThreadStore extends EventTarget {
  #writes = new Map<string, Promise<void>>();
  summaries: ConversationSummary[] = [];
  current: Conversation | null = null;
  /** What the orchestrator charged for the latest save; unknown until this session saves once. */
  saveCost: number | undefined;

  #deps: ThreadStoreDeps;
  #cursor: string | null = null;
  #submits = new Map<string, Promise<string | undefined>>();
  #heads = new Map<string, Head>();

  constructor(deps: ThreadStoreDeps) {
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

  async open(id: string): Promise<OpenedConversation> {
    const [heads, jobWorkflows] = await Promise.all([
      this.#deps.orchestration.queryWorkflows({ tags: [APP_TAG, HEAD_TAG, conversationTag(id)], take: 5 }),
      this.#all([APP_TAG, JOB_TAG, conversationTag(id)]),
    ]);
    const head = newestHead(heads.items);
    const now = this.#now().toISOString();
    const turns = (head?.metadata.turns ?? []).map(turnFrom).sort((a, b) => a.seq - b.seq);
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
    };
    const jobs = jobWorkflows.flatMap((workflow) => {
      const metadata = jobMetadataOf(workflow);
      return metadata ? [{ metadata, workflow }] : [];
    });
    this.#emit('conversation-change');
    return { conversation: this.current, jobs };
  }

  startNew(): Conversation {
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
    conversation.updatedAt = now;
    this.#submits.set(submitKey(conversation.id, seq), this.#submitHead(conversation, seq));
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
    return turn;
  }

  async completeTurn(turn: Turn): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    await this.#submits.get(submitKey(conversation.id, turn.seq));
    const head = this.#heads.get(conversation.id);
    if (head?.seq === turn.seq) {
      await this.#writeHead(head.workflowId, () => this.#metadata(conversation));
    } else {
      const submit = this.#submitHead(conversation, turn.seq);
      this.#submits.set(submitKey(conversation.id, turn.seq), submit);
      // A submit that timed out may have landed: the externalId hands back that workflow as it was.
      const workflowId = await submit;
      if (workflowId) await this.#writeHead(workflowId, () => this.#metadata(conversation));
    }
    this.#touchSummary(conversation);
    this.#emit('conversation-change');
  }

  async savePost(id: string, post: SavedPost): Promise<void> {
    const conversation = this.current;
    if (!conversation) return;
    conversation.posts = { ...conversation.posts, [id]: post };
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
  #writeHead(workflowId: string, metadata: () => ConversationMetadata): Promise<void> {
    const write = (this.#writes.get(workflowId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.#deps.api.updateWorkflow(workflowId, { metadata: metadata() }));
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
    const newest = conversation.turns.at(-1);
    if (newest && newest.assistant.status !== 'streaming') await this.completeTurn(newest);
  }

  async rename(id: string, title: string): Promise<void> {
    if (this.current?.id === id) return this.setTitle(title, 'user');
    const summary = this.summaries.find((s) => s.id === id);
    if (!summary) return;
    const metadata: ConversationMetadata = { ...summary.head.metadata, title: clampTitle(title), titleSource: 'user' };
    await this.#writeHead(summary.head.workflowId, () => metadata);
    this.summaries = this.summaries.map((s) => (s.id === id ? { ...s, title: metadata.title, titleSource: 'user', head: { ...s.head, metadata } } : s));
    this.#emit('list-change');
  }

  async remove(id: string): Promise<void> {
    const workflows = await this.#all([APP_TAG, conversationTag(id)]);
    await Promise.all(workflows.map((workflow) => (workflow.id ? this.#deps.api.deleteWorkflow(workflow.id) : undefined)));
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
    this.#touchSummary(conversation);
    if (previous && previous.workflowId !== workflowId) {
      this.#deps.api.removeTag(previous.workflowId, HEAD_TAG).catch((error) => console.warn('[chat-cvt] an older save still counts as the latest', error));
    }
    return workflowId;
  }

  #metadata(conversation: Conversation): ConversationMetadata {
    return {
      v: 2,
      app: 'chat-cvt',
      conversationId: conversation.id,
      title: conversation.title,
      titleSource: conversation.titleSource,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      turns: conversation.turns.map(saved),
      ...(conversation.posts ? { posts: conversation.posts } : {}),
      ...(conversation.panels ? { panels: conversation.panels } : {}),
      ...(this.#deps.scope ? { scope: this.#deps.scope } : {}),
    };
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

  #emit(type: 'list-change' | 'conversation-change'): void {
    this.dispatchEvent(new Event(type));
  }
}

function submitKey(conversationId: string, seq: number): string {
  return `${conversationId}:${seq}`;
}

function summaryOf(workflowId: string, metadata: ConversationMetadata): ConversationSummary {
  return { id: metadata.conversationId, title: metadata.title, titleSource: metadata.titleSource, updatedAt: metadata.updatedAt, head: { workflowId, metadata } };
}

function newestHead(workflows: Workflow[]): { workflowId: string; metadata: ConversationMetadata } | undefined {
  let best: { workflowId: string; metadata: ConversationMetadata } | undefined;
  for (const workflow of workflows) {
    const metadata = conversationMetadataOf(workflow);
    if (!metadata || !workflow.id) continue;
    if (!best || lastSeq(metadata) > lastSeq(best.metadata)) best = { workflowId: workflow.id, metadata };
  }
  return best;
}

function lastSeq(metadata: ConversationMetadata): number {
  return Math.max(0, ...metadata.turns.map((turn) => turn.seq));
}

function saved(turn: Turn): SavedTurn {
  const { assistant, ...rest } = turn;
  return assistant.status === 'streaming' ? rest : { ...rest, assistant };
}

function persistable(attachment: Attachment): Attachment {
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

function clampTitle(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim().replace(/^["'“”]+|["'“”.]+$/g, '').trim();
  return (flat || 'New chat').slice(0, TITLE_MAX);
}

export function conversationMetadataOf(workflow: Workflow): ConversationMetadata | null {
  const metadata = workflow.metadata as Partial<ConversationMetadata> | null | undefined;
  if (!metadata || metadata.app !== 'chat-cvt' || metadata.v !== 2 || !workflow.tags?.includes(HEAD_TAG)) return null;
  if (typeof metadata.conversationId !== 'string' || !Array.isArray(metadata.turns)) return null;
  return metadata as ConversationMetadata;
}

export function jobMetadataOf(workflow: Workflow): JobMetadata | null {
  const metadata = workflow.metadata as Partial<JobMetadata> | null | undefined;
  if (!metadata || metadata.app !== 'chat-cvt' || !workflow.tags?.includes(JOB_TAG)) return null;
  if (typeof metadata.job !== 'string' || typeof metadata.tool !== 'string') return null;
  return { ...(metadata as JobMetadata), seq: Number(metadata.seq) };
}

function turnFrom(turn: SavedTurn): Turn {
  return {
    seq: turn.seq,
    createdAt: turn.createdAt,
    user: { content: turn.user.content, attachments: turn.user.attachments ?? [], ...(turn.user.refs ? { refs: turn.user.refs } : {}) },
    assistant: turn.assistant ?? { messages: [], status: 'error', error: CUT_OFF },
  };
}
