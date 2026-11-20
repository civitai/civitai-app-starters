export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Answers each request with the next scripted response, and records it. */
export function fakeFetch(responses: Array<(call: FetchCall) => Response>) {
  const calls: FetchCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: FetchCall = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`no response scripted for ${call.method} ${call.url}`);
    return next(call);
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
