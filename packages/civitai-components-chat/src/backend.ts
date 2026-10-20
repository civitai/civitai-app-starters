import type { AppClient } from '@civitai/sdk';

import type { ChatModelOption } from './config.js';
import type { ChatConversationStore } from './store/conversation-store.js';

/**
 * A host that runs its own model gateway and storage. With it the chat starts without an `app`, sends
 * every reply to `url` and keeps conversations in `store`; nothing that needs Civitai's services
 * (making media, uploads, voice, posting, Buzz, model search) is offered.
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
}

/** The models a viewer may pick besides the backend's default: usable ids only, the default left out. */
export function backendModels(backend: ChatBackend): ChatModelOption[] {
  return (backend.models ?? []).filter((model) => typeof model?.id === 'string' && model.id.trim() !== '' && model.id !== backend.model);
}

/** The model a new chat starts on as its own: `newChatModel` when it is one of `models` (not `model` itself), else none. */
export function newChatModelOf(backend: ChatBackend): string | undefined {
  const wanted = typeof backend.newChatModel === 'string' ? backend.newChatModel.trim() : '';
  return wanted && backendModels(backend).some((model) => model.id === wanted) ? wanted : undefined;
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
