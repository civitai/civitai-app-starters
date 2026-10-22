import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AppClient } from '@civitai/sdk';
import type { LanguageModel } from 'ai';

import { chatConfig, ORCH_URL } from '../config.js';

export const PROVIDER = 'civitai';

/** Extra body fields the openai-compatible provider forwards untouched. */
export const PROVIDER_OPTIONS = {
  [PROVIDER]: { chat_template_kwargs: { enable_thinking: false } },
};

export function authedFetch(app: Pick<AppClient, 'getToken'>, doFetch: typeof fetch = fetch.bind(globalThis)): typeof fetch {
  return async (input, init) => {
    const attempt = async (fresh: boolean) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${await app.getToken({ fresh })}`);
      return doFetch(input, { ...init, headers });
    };
    const first = await attempt(false);
    return first.status === 401 ? attempt(true) : first;
  };
}

/**
 * A host's own gateway is named apart, so the options above (which only Civitai's model server
 * understands) never reach it: the provider forwards only the options under its own name.
 */
export const HOST_PROVIDER = 'chat-backend';

/**
 * The chat model behind an OpenAI-compatible `${baseUrl}/v1`. With `app`, every request carries the
 * viewer's Civitai token; with `null` (a host's own gateway) requests go out through `fetch` as they
 * are, and the host's `fetch` signs them in its own way.
 */
export function createAssistantModel(
  app: Pick<AppClient, 'getToken'> | null,
  {
    baseUrl = ORCH_URL,
    model = chatConfig.model,
    fetch: doFetch,
    wrap = (inner) => inner,
  }: { baseUrl?: string; model?: string; fetch?: typeof fetch; wrap?: (inner: typeof fetch) => typeof fetch } = {},
): LanguageModel {
  const send = app ? authedFetch(app, doFetch) : (doFetch ?? ((input, init) => globalThis.fetch(input, init)));
  // Civitai's closing usage carries what the call was charged (`chargeFetch`).
  const provider = createOpenAICompatible({ name: app ? PROVIDER : HOST_PROVIDER, baseURL: `${baseUrl.replace(/\/+$/, '')}/v1`, fetch: wrap(send), ...(app ? { includeUsage: true } : {}) });
  return provider.chatModel(model);
}
