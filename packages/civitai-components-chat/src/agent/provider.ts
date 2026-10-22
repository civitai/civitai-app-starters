import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { AppClient } from '@civitai/sdk';
import type { LanguageModel } from 'ai';

import { chatConfig, ORCH_URL } from '../config.js';
import { withoutTrailingSlashes, workflowRecoveryFetch, type WorkflowRecoveryOptions } from './workflow-recovery.js';

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
 *
 * `recoverWorkflows` (Civitai's orchestration only, so only with `app`): a step whose stream was cut
 * and is asked for again reuses the workflow orchestration already ran for it, and a request given
 * up on cancels its workflow (see `workflow-recovery.ts`). Off unless set, so a caller that does its
 * own (a server runner) is not changed; `<civitai-chat>` sets it.
 */
export function createAssistantModel(
  app: Pick<AppClient, 'getToken'> | null,
  {
    baseUrl = ORCH_URL,
    model = chatConfig.model,
    fetch: doFetch,
    wrap = (inner) => inner,
    recoverWorkflows,
  }: {
    baseUrl?: string;
    model?: string;
    fetch?: typeof fetch;
    wrap?: (inner: typeof fetch) => typeof fetch;
    recoverWorkflows?: boolean | Pick<WorkflowRecoveryOptions, 'waitMs' | 'pollMs'>;
  } = {},
): LanguageModel {
  const send = app ? authedFetch(app, doFetch) : (doFetch ?? ((input, init) => globalThis.fetch(input, init)));
  const root = withoutTrailingSlashes(baseUrl);
  // Under `wrap`, so it sees each request that actually goes out (a free start given up on and sent paid is two).
  const tracked =
    app && recoverWorkflows
      ? workflowRecoveryFetch(send, { baseUrl: root, control: send, ...(typeof recoverWorkflows === 'object' ? recoverWorkflows : {}) })
      : send;
  // Civitai's closing usage carries what the call was charged (`chargeFetch`).
  const provider = createOpenAICompatible({ name: app ? PROVIDER : HOST_PROVIDER, baseURL: `${root}/v1`, fetch: wrap(tracked), ...(app ? { includeUsage: true } : {}) });
  return provider.chatModel(model);
}

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}
