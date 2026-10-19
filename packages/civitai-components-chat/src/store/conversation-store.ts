import type { ModelMessage } from 'ai';

import type { SavedPanel } from '../panels/panel.js';
import type { SavedPost } from '../posting/post.js';
import type { Attachment, Conversation, SavedTurn, TitleSource, Turn } from '../types.js';
import type { OpenedConversation } from './thread-store.js';

/**
 * Why `open` rejects when the viewer opened or started another chat before it finished: its result is
 * stale, and the caller drops it without a word.
 */
export const SUPERSEDED = 'superseded';

export function supersededError(): Error {
  return Object.assign(new Error('Another chat was opened meanwhile.'), { code: SUPERSEDED });
}

export function isSuperseded(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === SUPERSEDED;
}

/** A row of the chat list. */
export interface ListedConversation {
  id: string;
  title: string;
  /** ISO 8601; the list groups by it (Today, Yesterday, …). */
  updatedAt: string;
}

/**
 * What the chat asks of wherever its conversations live: the orchestrator (`ThreadStore`, the
 * default) or a host's own storage (`HostThreadStore`). It holds the open conversation and the list,
 * and fires `list-change` and `conversation-change`.
 */
export interface ConversationStore extends EventTarget {
  summaries: ListedConversation[];
  current: Conversation | null;
  readonly hasMore: boolean;
  /** What the latest save cost the viewer, when saving costs anything. */
  saveCost?: number;
  /**
   * Governs one thing only: `remove` takes a chat off the list as it starts, so the element may leave a
   * chat being deleted at once; without it, it leaves once the delete worked (unless the viewer picked
   * another chat meanwhile). The name is historical. Every store's `open` rejects as superseded
   * (`isSuperseded`) when another chat was opened or started before it finished, whatever this says.
   */
  readonly supersedesOpens?: boolean;
  refreshList(): Promise<void>;
  loadMore(): Promise<void>;
  open(id: string): Promise<OpenedConversation>;
  startNew(): Conversation;
  appendUserTurn(content: string, attachments: Attachment[], refs?: string[]): Turn;
  completeTurn(turn: Turn): Promise<void>;
  /**
   * A reply to `turn` starts in this tab (`send`, or Retry/Continue): a store that saves progress marks it
   * as this tab's, so a reload of this tab knows a reply it finds unfinished died here.
   */
  replyStarted?(turn: Turn): void;
  /**
   * The reply to `turn` has got this far: `messages` is every step that finished so far. A store that
   * saves progress (`ThreadStore`, as a v3 head with the reply `running`) may save it now or with a later
   * save, and saves it now when `force` (a step that ran a tool, or a reply carrying on from saved steps);
   * `completeTurn` saves how it ended.
   */
  checkpoint?(turn: Turn, progress: { messages: ModelMessage[]; force: boolean }): Promise<void>;
  savePost(id: string, post: SavedPost): Promise<void>;
  setModel(model: string | undefined): Promise<void>;
  savePanel(panel: SavedPanel): Promise<void>;
  setTitle(title: string, source: TitleSource): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
}

/** One saved turn: the user's message and, once the reply finished, the reply's messages. Opaque JSON to a store. */
export type ChatSavedTurn = SavedTurn;

/** A conversation as a host's store keeps it: save it as JSON, hand it back unchanged. */
export interface ChatConversation {
  id: string;
  title: string;
  /** Who named it: `first-message` (its first words), `llm` (the assistant) or `user`. */
  titleSource: TitleSource;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601; the time of its latest message. */
  updatedAt: string;
  turns: ChatSavedTurn[];
  /** The model this chat picked; unset, it follows the default. */
  model?: string;
  /** The chat's `scope`, when it has one. */
  scope?: string;
}

/** A row of `list()`. */
export interface ChatConversationSummary {
  id: string;
  title: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** Where a host keeps its viewer's conversations. Every method may reject; the chat shows a short error. */
export interface ChatConversationStore {
  /** The viewer's conversations in this scope, newest first; `next` is a cursor for the following page, absent when there is none. */
  list(options: { scope?: string; cursor?: string }): Promise<{ items: ChatConversationSummary[]; next?: string | null }>;
  /** One conversation as last saved, or `null` when there is no such conversation. */
  load(id: string, options: { scope?: string }): Promise<ChatConversation | null>;
  /** Creates or replaces the whole conversation. Saves of one conversation come one at a time, in order. */
  save(conversation: ChatConversation): Promise<void>;
  delete(id: string, options: { scope?: string }): Promise<void>;
}
