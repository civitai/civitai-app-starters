import { useEffect } from 'react';

import type { BlockToken } from '@civitai/app-sdk/blocks';

import { getTransport } from '../internal/singleton.js';
import { sendTypedRequest } from '../internal/transport.js';
import { useTransportSnapshot } from './useBlockContext.js';

/** Refresh fires `REFRESH_LEAD_MS` before the token's `expiresAt`. */
const REFRESH_LEAD_MS = 2 * 60 * 1000;

/**
 * Returns the current block-scoped JWT and keeps it fresh.
 *
 * Iframe path: schedules a `REQUEST_TOKEN` postMessage T-2min before expiry.
 * The host replies with `TOKEN_REFRESH_RESPONSE`, the transport updates its
 * snapshot, and the hook re-renders with the new token.
 *
 * Consumers also get a `refresh()` callable for the 401-retry path. Call it
 * after any API request returns 401 — it forces an immediate token mint and
 * resolves once the new token is applied to the snapshot.
 *
 * @returns The {@link BlockToken} fields (`raw`, `scopes`, `expiresAt`,
 * `buzzBudget`, …) plus a `refresh()` for the 401-retry path.
 *
 * @example
 * const { raw, scopes, expiresAt, buzzBudget, refresh } = useBlockToken();
 * // after a 401: await refresh(); then retry the request once with the new `raw`.
 */
export function useBlockToken(): BlockToken & { refresh: () => Promise<void> } {
  const snap = useTransportSnapshot();
  const token = snap.token;
  const instanceId = snap.blockInstanceId;

  useEffect(() => {
    if (!snap.ready) return;
    const msUntilRefresh = token.expiresAt.getTime() - Date.now() - REFRESH_LEAD_MS;
    if (msUntilRefresh <= 0) {
      // Already past the refresh window — refresh now.
      // Background refresh — swallow errors. The next 401 will re-trigger
      // via the explicit refresh() callable below.
      requestRefresh(instanceId).catch(() => {});
      return;
    }
    const id = setTimeout(() => {
      // Background refresh — swallow errors. The next 401 will re-trigger
      // via the explicit refresh() callable below.
      requestRefresh(instanceId).catch(() => {});
    }, msUntilRefresh);
    return () => clearTimeout(id);
  }, [snap.ready, token.expiresAt, instanceId]);

  return { ...token, refresh: () => requestRefresh(instanceId) };
}

/**
 * In-flight dedup, keyed by `blockInstanceId`. Both the scheduled-timeout path
 * and the "already past" synchronous path can fire while a previous refresh is
 * still pending — coalescing into a single round-trip avoids fanning out
 * duplicate REQUEST_TOKEN messages, which would otherwise hit the host once per
 * snapshot update.
 *
 * The key MUST include `blockInstanceId`: in iframe mode there is one module per
 * iframe so any key works, but on the INLINE transport (v2) several block
 * instances share one module context. A module-global singleton would coalesce
 * across instances, so instance B's 401-retry `refresh()` would resolve on
 * instance A's in-flight `REQUEST_TOKEN` and B would never mint its OWN token.
 */
const inFlightRefreshByInstance = new Map<string, Promise<void>>();

/**
 * Mint/await a token refresh for one block instance, coalescing concurrent calls
 * for the SAME `blockInstanceId`. Exported for the inline-mode multi-instance
 * dedup test — hooks call it via `useBlockToken().refresh`.
 */
export async function requestRefresh(blockInstanceId: string): Promise<void> {
  const existing = inFlightRefreshByInstance.get(blockInstanceId);
  if (existing) return existing;
  const transport = getTransport();
  const refresh = sendTypedRequest(
    transport,
    { type: 'REQUEST_TOKEN', payload: { blockInstanceId } },
    'TOKEN_REFRESH_RESPONSE',
  )
    .then(() => undefined)
    .finally(() => {
      inFlightRefreshByInstance.delete(blockInstanceId);
    });
  inFlightRefreshByInstance.set(blockInstanceId, refresh);
  return refresh;
}
