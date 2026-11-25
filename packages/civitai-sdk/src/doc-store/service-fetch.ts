import { sleep } from '../http/retry.js';

/**
 * The app-data service's retry rules (civitai/civitai `apps/app-data-go`, WRITES-DESIGN.md
 * "Retries"), applied below the JSON client so the 401 token refresh above it is unchanged:
 *
 * - A READ (a `GET`) answered `503` with a `Retry-After` is sent again after that many seconds:
 *   the service names the delay on every refusal a later read can clear (`floor_not_met`,
 *   `not_live`, `capacity`, …). Not one whose code no wait clears ({@link NOT_WORTH_WAITING}).
 * - A WRITE (any other method) is sent again only on `503` whose `code` is `not_forwarded`: the
 *   service refused it before anything reached the store, so a resend is the first write.
 * - Nothing else is sent again. `504 outcome_unknown` above all: that write may have landed.
 *
 * Bounded: at most {@link SERVICE_RETRIES} resends per call, and a `Retry-After` that is not a
 * whole number of seconds, or asks for more than {@link SERVICE_RETRY_MAX_WAIT_MS}, is not waited
 * out here; the `503` reaches the caller.
 */
export const SERVICE_RETRIES = 3;
export const SERVICE_RETRY_MAX_WAIT_MS = 5_000;

/** `Retry-After` as delay-seconds only (`RFC 9110`'s other form, a date, is not waited out). */
function retryAfterMs(header: string | null): number | undefined {
  if (header === null || !/^\d{1,6}$/.test(header.trim())) return undefined;
  const ms = Number(header.trim()) * 1000;
  return ms <= SERVICE_RETRY_MAX_WAIT_MS ? ms : undefined;
}

/**
 * Read `503`s that carry a `Retry-After` but that no wait clears: a stream over its bound
 * (`too_large`), an adapter without keys (`unkeyed`), the registry path off (`registry_off`).
 */
export const NOT_WORTH_WAITING: ReadonlySet<string> = new Set(['too_large', 'unkeyed', 'registry_off']);

/**
 * The code of a response, read from a clone so the body is still there: `code`, or for a read,
 * `error` (the service's read refusals carry the code there). A write's code is `code` only.
 */
async function codeOf(response: Response, read: boolean): Promise<unknown> {
  try {
    const body = (await response.clone().json()) as { code?: unknown; error?: unknown } | null;
    return body?.code ?? (read ? body?.error : undefined);
  } catch {
    return undefined;
  }
}

export function createServiceFetch(base?: typeof fetch): typeof fetch {
  return async (input, init = {}) => {
    const doFetch = base ?? globalThis.fetch;
    const read = (init.method ?? 'GET').toUpperCase() === 'GET';
    for (let resends = 0; ; resends += 1) {
      const response = await doFetch(input, init);
      if (response.status !== 503 || resends >= SERVICE_RETRIES) return response;
      const wait = retryAfterMs(response.headers.get('Retry-After'));
      if (wait === undefined) return response;
      const code = await codeOf(response, read);
      if (read ? typeof code === 'string' && NOT_WORTH_WAITING.has(code) : code !== 'not_forwarded') return response;
      if (init.signal?.aborted) throw init.signal.reason;
      await sleep(wait, init.signal ?? undefined);
    }
  };
}
