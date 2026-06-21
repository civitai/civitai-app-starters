import { isSfwCeiling, isLevelAllowed as isLevelAllowedCeiling } from '@civitai/app-sdk/blocks';
import type { ColorDomain } from '@civitai/app-sdk/blocks';

import { useTransportSnapshot } from './useBlockContext.js';

/**
 * What {@link useDomainMaturity} returns.
 */
export interface DomainMaturity {
  /**
   * The color-domain the block is rendered inside (`green`|`blue`|`red`), or
   * `null`/`undefined` when the host didn't project one (anon read, or a host
   * that predates civitai #2670). Informational ONLY — gate UI on {@link isSfw}
   * / {@link isLevelAllowed}, not on this string.
   */
  domain?: ColorDomain | null;
  /**
   * Authoritative browsing-level ceiling BITMASK from `BLOCK_INIT`
   * (`undefined` before init / when the host doesn't send it). The bits mirror
   * the server `NsfwLevel` (see `BrowsingLevel` in `@civitai/app-sdk/blocks`).
   */
  maxBrowsingLevel?: number;
  /**
   * `true` when the surrounding domain permits NO NSFW content — derived from
   * the {@link maxBrowsingLevel} bitmask (NOT the `domain` string, so the policy
   * stays server-side). **Fail-closed SFW**: `true` before `BLOCK_INIT` lands
   * and whenever the ceiling is absent/non-finite.
   */
  isSfw: boolean;
  /**
   * `true` when a specific browsing-level bit (e.g. `BrowsingLevel.R`) is
   * permitted by the domain ceiling. Fail-closed to SFW-only when the ceiling
   * is absent.
   */
  isLevelAllowed: (level: number) => boolean;
}

/**
 * Read the surrounding color-domain's maturity ceiling that the host projects
 * into `BLOCK_INIT` (civitai #2670), so a block can hide/blur mature
 * affordances on a SFW domain.
 *
 * Reads from the SAME init state as {@link useBlockContext} (the singleton
 * transport snapshot), so it re-renders when `BLOCK_INIT` lands.
 *
 * The SFW decision is derived from the `maxBrowsingLevel` BITMASK — never from
 * the `domain` string — so the policy stays server-side and the SDK won't rot
 * if a domain's policy flips. **Fail-closed SFW**: until `BLOCK_INIT` arrives,
 * or against a host that predates #2670 (fields read `undefined`), `isSfw` is
 * `true` and only SFW levels are allowed.
 *
 * @example
 * const { isSfw } = useDomainMaturity();
 * return isSfw ? <SafeUI /> : <MatureUI />;
 *
 * @example
 * const { isLevelAllowed } = useDomainMaturity();
 * if (isLevelAllowed(BrowsingLevel.R)) showRSlider();
 */
export function useDomainMaturity(): DomainMaturity {
  const snap = useTransportSnapshot();
  const maxBrowsingLevel = snap.maxBrowsingLevel;
  return {
    domain: snap.domain,
    maxBrowsingLevel,
    isSfw: isSfwCeiling(maxBrowsingLevel),
    isLevelAllowed: (level: number) => isLevelAllowedCeiling(level, maxBrowsingLevel),
  };
}
