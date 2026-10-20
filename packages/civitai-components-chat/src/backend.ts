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
  /** Where conversations are kept. */
  store: ChatConversationStore;
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
  /** Where conversations are kept. */
  store: ChatConversationStore;
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
