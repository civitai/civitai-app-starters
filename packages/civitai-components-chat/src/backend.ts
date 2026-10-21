import type { AppClient } from '@civitai/sdk';

import type { ChatModelOption } from './config.js';
import type { ChatConversationStore } from './store/conversation-store.js';

/** What {@link ChatTranscribe} is called with besides the recording. */
export interface ChatTranscribeOptions {
  /** The language the viewer speaks, as they chose it beside the microphone (else the browser's): a code such as `'en'`. */
  language?: string;
  /** Aborted when the viewer cancels the recording or stops the transcription; the result is then ignored. */
  signal?: AbortSignal;
}

/** What {@link ChatTranscribe} resolves to: the words spoken. */
export interface ChatTranscription {
  text: string;
}

/**
 * A host's own speech-to-text, for the microphone on a chat with a backend. Called with a playable
 * recording (`audio/webm`, or `audio/mp4` where the browser records only that) of one phrase: the chat
 * cuts a recording at the viewer's pauses and calls this for each phrase as it ends, so it may run
 * several times, concurrently, for one recording. The words of every phrase go into the message box in
 * the order spoken. A rejection shows the viewer that the recording could not be turned into text.
 */
export type ChatTranscribe = (audio: Blob, options: ChatTranscribeOptions) => Promise<ChatTranscription>;

/**
 * A host that runs its own model gateway and storage. With it the chat starts without an `app`, sends
 * every reply to `url` and keeps conversations in `store`; nothing that needs Civitai's services
 * (making media, uploads, voice conversations, posting, Buzz, model search) is offered. The microphone
 * is offered only with `transcribe`.
 */
export interface ChatBackend {
  /** An OpenAI-compatible API: replies are `POST ${url}/v1/chat/completions`. May be relative to the page. */
  url: string;
  /**
   * Makes every request to `url`, so the host decides how it is signed in: a session cookie, a CSRF
   * header. `fetch` itself when unset.
   */
  fetch?: typeof fetch;
  /** The model id a chat uses unless the viewer picks one of `models`; chats are named with it too. */
  model: string;
  /** Other models the viewer may pick for a chat. Without any, the model button is hidden. */
  models?: ChatModelOption[];
  /**
   * The model a new chat starts on, e.g. the one the viewer last picked (`model-change`): one of
   * `models`, else new chats start on `model`. Read each time a new chat starts. A saved chat keeps
   * its own model, and one saved without a model keeps following `model`.
   */
  newChatModel?: string;
  /** Where conversations are kept. */
  store: ChatConversationStore;
  /** Optional: the host's own speech-to-text. With it the microphone is offered and dictation goes here; without it there is no microphone. */
  transcribe?: ChatTranscribe;
}

/**
 * Experimental, with `runner: 'remote'` only: a host that keeps the conversations, while every reply
 * runs on the server runner. The chat starts without an `app`, lists, opens, renames and deletes chats
 * through `store`, and offers `model` and `models` in the picker; the runner writes each reply into
 * the host's store itself. No `url` or `fetch`: the page sends no model request, so a backend that
 * names a gateway is refused in remote mode, as is one without `url` in the browser.
 */
export interface ChatStoreBackend {
  /** The model id a chat uses unless the viewer picks one of `models`; sent with each run. */
  model: string;
  /** Other models the viewer may pick for a chat. Without any, the model button is hidden. */
  models?: ChatModelOption[];
  /** The model a new chat starts on, as for {@link ChatBackend.newChatModel}. */
  newChatModel?: string;
  /** Where conversations are kept. */
  store: ChatConversationStore;
  /** Optional: the host's own speech-to-text, as for {@link ChatBackend.transcribe}. */
  transcribe?: ChatTranscribe;
  url?: never;
  fetch?: never;
}

/**
 * Whether the backend sets a gateway `url`: anything the model client takes (a string, or a URL
 * object), but not a missing or blank one. The one test for a `url`, in the browser and in remote mode.
 */
export function hasGatewayUrl(backend: ChatBackend | ChatStoreBackend): boolean {
  const url = (backend as Partial<ChatBackend>).url as unknown;
  if (url === undefined || url === null) return false;
  return typeof url !== 'string' || url.trim() !== '';
}

/** Whether the backend names a model gateway (a `url`, by {@link hasGatewayUrl}, or a `fetch`), which only a page-run reply uses. */
export function namesGateway(backend: ChatBackend | ChatStoreBackend): backend is ChatBackend {
  return hasGatewayUrl(backend) || (backend as Partial<ChatBackend>).fetch !== undefined;
}

/** The models a viewer may pick besides the backend's default: usable ids only, the default left out. */
export function backendModels(backend: Pick<ChatBackend, 'model' | 'models'>): ChatModelOption[] {
  return (backend.models ?? []).filter((model) => typeof model?.id === 'string' && model.id.trim() !== '' && model.id !== backend.model);
}

/** The model a new chat starts on as its own: `newChatModel` when it is one of `models` (not `model` itself), else none. */
export function newChatModelOf(backend: ChatBackend | ChatStoreBackend): string | undefined {
  const wanted = typeof backend.newChatModel === 'string' ? backend.newChatModel.trim() : '';
  return wanted && backendModels(backend).some((model) => model.id === wanted) ? wanted : undefined;
}

/** Whether the backend brings its own speech-to-text: a `transcribe` function. The one test for it. */
export function hasTranscribe(backend: ChatBackend | ChatStoreBackend): boolean {
  return typeof backend.transcribe === 'function';
}

/**
 * One phrase through the backend's `transcribe`: its words, trimmed. Rejects when the backend has
 * none, or answers anything but `{ text: string }`.
 */
export async function transcribeOnHost(backend: ChatBackend | ChatStoreBackend, audio: Blob, options: ChatTranscribeOptions): Promise<string> {
  if (!hasTranscribe(backend)) throw new Error('This chat has no speech-to-text: its backend sets no transcribe.');
  const result = (await backend.transcribe!.call(backend, audio, options)) as Partial<ChatTranscription> | null | undefined;
  if (typeof result?.text !== 'string') throw new Error('backend.transcribe must resolve to { text: string }.');
  return result.text.trim();
}

const UNAVAILABLE = 'Not available: this chat runs on its host backend, without a Civitai sign-in.';

/**
 * Stands in for the `AppClient` a chat on a host backend does not have. Nothing in that mode should
 * reach it; if something does, it fails here, before any request leaves the page.
 */
export function unavailableApp(): AppClient {
  const refuse = (): Promise<never> => Promise.reject(new Error(UNAVAILABLE));
  return {
    getToken: refuse,
    requestGrants: async () => false,
    site: { get: refuse, post: refuse },
    orchestration: { submitWorkflow: refuse, queryWorkflows: refuse, cancelWorkflow: refuse, getWorkflow: refuse },
  } as unknown as AppClient;
}

/** The model client needs an absolute URL; a relative `url` is taken against the page's own address. */
export function absoluteUrl(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).href;
  } catch {
    return url;
  }
}
