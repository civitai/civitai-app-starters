import type { ModelMessage } from 'ai';

import type { ErrorTrace } from './agent/error-trace.js';
import type { SavedPanel } from './panels/panel.js';
import type { SavedPost } from './posting/post.js';

export type MediaKind = 'image' | 'video' | 'audio';

export type AttachmentSource =
  | { type: 'upload'; blobId: string }
  | { type: 'result'; workflowId: string; job: string; path: string };

/**
 * A file the conversation can refer to. Uploads are `up<seq>-<n>`, results are
 * `gen<seq>-<call>-<n>`: both derive from persisted positions, so ids survive a reload.
 */
export interface Attachment {
  id: string;
  kind: MediaKind;
  source: AttachmentSource;
  url?: string;
  mime?: string;
  name?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  caption?: string;
  nsfwLevel?: string;
  blocked?: boolean;
}

export type TurnStatus = 'streaming' | 'done' | 'error' | 'aborted';

export interface Turn {
  seq: number;
  createdAt: string;
  user: TurnUser;
  /**
   * `errorDetail` is what the service said, shown only under Details; `errorTrace` is where the reply
   * failed, kept for this session only. `ranOut`: the reply used every step it may take. `stopped`:
   * the page ended the reply (`beforeToolCall` answered `stop: true`), and these are the words shown.
   * `networkRetries`: where the browser's network cut the reply off each time it then retried by
   * itself, oldest first; kept for this session only, like `errorTrace`. `resume`: on a failed reply,
   * where asking for it again can carry on from without running a tool twice; also kept for this
   * session only (see {@link ResumePoint}).
   */
  assistant: {
    messages: ModelMessage[];
    status: TurnStatus;
    error?: string;
    errorDetail?: string;
    errorKind?: string;
    errorTrace?: ErrorTrace;
    networkRetries?: ErrorTrace[];
    resume?: ResumePoint;
    ranOut?: boolean;
    stopped?: string;
    /**
     * On a reply read back from a save made before it ended (cut off): when that save was made (ISO).
     * The turn's start for a v2 save, the latest step's save for a v3 one. While it is recent the reply
     * may still be running in another tab or window (see `replyElsewhere`). Not saved again.
     */
    savedAt?: string;
    /**
     * Read back unfinished, it is the reply this tab started, and no one saved it since this tab last
     * did: nothing runs it now (the tab reloaded), so it reads as gone at once. Not saved.
     */
    orphaned?: boolean;
  };
}

/**
 * Where a failed reply can be asked for again from: the steps that finished before the failure (their
 * messages, with every tool call and its result) and how many there were. A failed reply has one only
 * when the step that failed had called no tool, so asking again never runs a tool a second time: a
 * call in the failed step may have run and is in no finished step to send as it is. `at` is when the
 * reply failed (ms since the epoch).
 */
export interface ResumePoint {
  messages: ModelMessage[];
  steps: number;
  at: number;
}

/** `refs` name earlier results the user pointed at ("animate this") without uploading anything. */
export interface TurnUser {
  content: string;
  attachments: Attachment[];
  refs?: string[];
}

export type TitleSource = 'first-message' | 'llm' | 'user';

export interface Conversation {
  id: string;
  title: string;
  titleSource: TitleSource;
  createdAt: string;
  updatedAt: string;
  turns: Turn[];
  /** Outcomes of posts the assistant offered, by tool call id. */
  posts?: Record<string, SavedPost>;
  /** Panels the assistant built, by handle. */
  panels?: Record<string, SavedPanel>;
  /** The assistant's model for this chat; unset, it follows the viewer's default. */
  model?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  titleSource: TitleSource;
  updatedAt: string;
  head: { workflowId: string; metadata: StoredConversationMetadata };
}

/** A turn still streaming is saved without its reply, so a reload shows it as cut off. */
export interface SavedTurn {
  seq: number;
  createdAt: string;
  user: TurnUser;
  assistant?: { messages: ModelMessage[]; status: TurnStatus; error?: string };
}

export interface ConversationMetadata {
  v: 2;
  app: 'chat-cvt';
  conversationId: string;
  title: string;
  titleSource: TitleSource;
  createdAt: string;
  updatedAt: string;
  turns: SavedTurn[];
  posts?: Record<string, SavedPost>;
  panels?: Record<string, SavedPanel>;
  scope?: string;
  model?: string;
}

/**
 * A saved reply's status in a v3 head: v2's, plus `running`, a reply that had not ended when it was
 * saved. Its `messages` are the steps it had finished by then (each with every tool call and its
 * result), so a reader shows the progress made instead of losing the whole reply.
 */
export type SavedTurnStatusV3 = TurnStatus | 'running';

/**
 * A turn in a v3 head; as {@link SavedTurn}, except that its reply may be saved `running`, with
 * `savedAt` (ISO), when that save was made. A `running` reply's `messages` are whole finished steps
 * only: every tool call in them comes with its result.
 */
export interface SavedTurnV3 extends Omit<SavedTurn, 'assistant'> {
  assistant?: { messages: ModelMessage[]; status: SavedTurnStatusV3; error?: string; savedAt?: string };
}

/**
 * The v3 conversation head: v2 with replies that may be saved while they run (one save after each
 * step that finished). This version reads v3 and still writes v2: a v2 reader leaves a v3 head out
 * of its list, so readers ship before any writer does.
 */
export interface ConversationMetadataV3 extends Omit<ConversationMetadata, 'v' | 'turns'> {
  v: 3;
  turns: SavedTurnV3[];
}

/** Every head this version reads. */
export type StoredConversationMetadata = ConversationMetadata | ConversationMetadataV3;

export interface JobMetadata {
  v: 1;
  app: 'chat-cvt';
  conversationId: string;
  seq: number;
  job: string;
  toolCallId: string;
  tool: string;
  panel?: string;
}

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  allowMature: boolean;
  autoRunLimit: number;
  /**
   * The viewer's own cap on what one step of a reply may write; the page's default when unset. Left
   * out of `defaultSettings()` on purpose: saving any setting writes the whole object, which would
   * freeze today's default for this viewer and hide a later change of `configureChat({ maxOutputTokens })`.
   */
  maxOutputTokens?: number;
  /** Sent with every request as the user's standing instructions to the assistant. */
  customInstructions?: string;
  /** The model a chat uses when it has none of its own; the configured default when unset. */
  assistantModel?: string;
  /** The language the viewer speaks to the microphone in. */
  voiceLanguage?: string;
  /**
   * How replies are paid for: `auto` (the default) uses free replies while they last and then Buzz,
   * `free` uses only free replies, `paid` always uses Buzz.
   */
  assistantTier?: 'auto' | 'free' | 'paid';
  lastConversationId?: string;
}

export interface ModelRecommendation {
  id: number;
  name: string;
  type?: string;
  air?: string;
}

export interface ChoiceOption {
  label: string;
  description?: string;
  image?: string;
}
