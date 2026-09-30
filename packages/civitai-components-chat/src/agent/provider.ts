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

export function createAssistantModel(
  app: Pick<AppClient, 'getToken'>,
  { baseUrl = ORCH_URL, model = chatConfig.model, fetch: doFetch }: { baseUrl?: string; model?: string; fetch?: typeof fetch } = {},
): LanguageModel {
  const provider = createOpenAICompatible({ name: PROVIDER, baseURL: `${baseUrl}/v1`, fetch: authedFetch(app, doFetch) });
  return provider.chatModel(model);
}
