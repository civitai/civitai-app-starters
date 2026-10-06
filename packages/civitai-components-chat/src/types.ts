import type { ModelMessage } from 'ai';

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
  /** `errorDetail` is what the service said, shown only under Details. */
  assistant: { messages: ModelMessage[]; status: TurnStatus; error?: string; errorDetail?: string; errorKind?: string };
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
}

export interface ConversationSummary {
  id: string;
  title: string;
  titleSource: TitleSource;
  updatedAt: string;
  head: { workflowId: string; metadata: ConversationMetadata };
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
}

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
  /** Sent with every request as the user's standing instructions to the assistant. */
  customInstructions?: string;
  /** The assistant's model for this viewer; the configured default when unset. */
  assistantModel?: string;
  /** The language the viewer speaks to the microphone in. */
  voiceLanguage?: string;
  /** Send replies free while the daily allowance lasts; on unless turned off. */
  useFreeAllowance?: boolean;
  /** When the free allowance cannot serve a reply (used up, or slow to start), send it on Buzz without asking. */
  payWhenFreeRunsOut?: boolean;
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
