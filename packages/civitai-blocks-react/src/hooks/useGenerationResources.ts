import { useCallback } from 'react';

import type { BlockResourceInfo } from '@civitai/app-sdk/blocks';

import {
  buildGenerationResourcesUrl,
  responseToResources,
} from '../api/generationResources.js';
import { useHostOrigin } from './useHostOrigin.js';
import { useBlockToken } from './useBlockToken.js';

/**
 * Rehydrate a saved set of generation resources by version id, WITHOUT
 * re-opening the resource picker. `fetch(versionIds)` GETs the block-token-gated
 * `/api/v1/blocks/generation-resources` endpoint and returns the SAME widened
 * {@link BlockResourceInfo} projection `useResourcePicker()` yields (public
 * recommended settings — strength + min/max clamp, trained words, clipSkip — plus
 * names), so a picked resource and a rehydrated one look identical to the block.
 *
 * Direct-fetch (bypasses the postMessage bridge) against the VALIDATED host
 * origin (`useHostOrigin()`) with the block bearer token (`useBlockToken().raw`)
 * — the same security-reviewed pattern as any block REST call. The maturity
 * ceiling is server-clamped to the token's signed `maxBrowsingLevel`; the client
 * sends no maturity. Ids are sanitized + capped at 30 by the URL builder.
 *
 * DISCOVERY ONLY: every returned `versionId` is a hint, never an entitlement —
 * the server re-validates + re-prices at estimate/submit.
 *
 * @example
 * const { fetch } = useGenerationResources();
 * const resources = await fetch([691639, 666002]);   // by saved versionIds
 * // resources[0].strength / .minStrength / .maxStrength / .trainedWords / .clipSkip
 */
export function useGenerationResources(): {
  fetch: (versionIds: number[]) => Promise<BlockResourceInfo[]>;
} {
  const host = useHostOrigin();
  const { raw } = useBlockToken();

  const doFetch = useCallback(
    async (versionIds: number[]): Promise<BlockResourceInfo[]> => {
      if (!host) {
        throw new Error(
          'useGenerationResources: host origin not established yet (wait for BLOCK_INIT).',
        );
      }
      const url = host + buildGenerationResourcesUrl(versionIds);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${raw}` },
      });
      if (!res.ok) {
        throw new Error(`generation-resources request failed (${res.status})`);
      }
      const body = (await res.json()) as unknown;
      return responseToResources(body as Parameters<typeof responseToResources>[0]);
    },
    [host, raw],
  );

  return { fetch: doFetch };
}
