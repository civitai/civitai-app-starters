import {
  effectiveBrowsingCeiling,
  isSfwCeiling,
  isLevelAllowed as isLevelAllowedCeiling,
} from '@civitai/app-sdk/blocks';
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
   * The DOMAIN's browsing-level ceiling BITMASK from `BLOCK_INIT` (`undefined`
   * before init / when the host doesn't send it). The bits mirror the server
   * `NsfwLevel` (see `BrowsingLevel` in `@civitai/app-sdk/blocks`).
   *
   * 🔴 THIS IS NOT THE NUMBER TO GATE ON. It is a property of the domain, so
   * it is identical for every viewer on `civitai.red` — including one whose own
   * NSFW setting is off. Gate on {@link isSfw} / {@link isLevelAllowed}, which
   * account for the viewer; read this only when you genuinely need the domain's
   * own ceiling (e.g. to explain WHY something is hidden).
   */
  maxBrowsingLevel?: number;
  /**
   * The ceiling actually in force for THIS viewer: {@link maxBrowsingLevel}
   * narrowed by the viewer's own browsing-level setting. Always a subset of
   * {@link maxBrowsingLevel}.
   *
   * `undefined` before `BLOCK_INIT` lands, and equal to the domain ceiling
   * against a host that does not send the per-viewer field — so a `!==
   * maxBrowsingLevel` comparison tells you the viewer narrowed it, not that the
   * host is old.
   */
  effectiveBrowsingLevel?: number;
  /**
   * `true` when NO NSFW content may be shown to this viewer here — derived from
   * the {@link effectiveBrowsingLevel} bitmask (NOT the `domain` string, so the
   * policy stays server-side). **Fail-closed SFW**: `true` before `BLOCK_INIT`
   * lands and whenever the ceiling is absent/non-finite.
   *
   * 🔴 This became viewer-aware when the platform started projecting the
   * per-viewer ceiling. It can only ever have gone from `false` to `true` for a
   * given session — narrower, never wider — so a block gating mature UI on it
   * cannot start showing MORE than it did before.
   */
  isSfw: boolean;
  /**
   * `true` when a specific browsing-level bit (e.g. `BrowsingLevel.R`) is
   * permitted for this viewer on this domain — i.e. tested against
   * {@link effectiveBrowsingLevel}, not the domain ceiling alone. Fail-closed
   * to SFW-only when the ceiling is absent.
   */
  isLevelAllowed: (level: number) => boolean;
}

/**
 * Read the maturity ceiling in force for the current viewer, as the host
 * projects it into `BLOCK_INIT`, so a block can hide/blur mature affordances.
 *
 * Reads from the SAME init state as {@link useBlockContext} (the singleton
 * transport snapshot), so it re-renders when `BLOCK_INIT` lands.
 *
 * 🔴 THE NAME IS HISTORIC AND NARROWER THAN WHAT THIS DOES. It shipped when
 * the only signal was the DOMAIN ceiling (civitai #2670). The platform now also
 * projects the viewer's own browsing level, and there is deliberately no
 * separate `useViewerMaturity`: two hooks would mean two answers to "may I show
 * this", and the one still named for the domain would be the WIDER of the pair
 * — a footgun that every future block would have an even chance of picking.
 * `isSfw` / `isLevelAllowed` are the single gate, and they account for both.
 *
 * The SFW decision is derived from the BITMASK — never from the `domain`
 * string — so the policy stays server-side and the SDK won't rot if a domain's
 * policy flips. **Fail-closed SFW**: until `BLOCK_INIT` arrives, or against a
 * host that projects no ceiling at all, `isSfw` is `true` and only SFW levels
 * are allowed.
 *
 * **Upgrading is safe.** Against a host that does not send the per-viewer
 * field, the gates read exactly what they read before. Against one that does,
 * the ceiling is the intersection — so the answers can only get NARROWER, never
 * wider. No existing caller can start showing more than it used to.
 *
 * @example
 * const { isSfw } = useDomainMaturity();
 * return isSfw ? <SafeUI /> : <MatureUI />;
 *
 * @example
 * const { isLevelAllowed } = useDomainMaturity();
 * if (isLevelAllowed(BrowsingLevel.R)) showRSlider();
 *
 * @example
 * // Distinguish "this domain forbids it" from "you turned it off in settings".
 * const { maxBrowsingLevel, effectiveBrowsingLevel } = useDomainMaturity();
 * const hiddenByYourSettings = effectiveBrowsingLevel !== maxBrowsingLevel;
 */
export function useDomainMaturity(): DomainMaturity {
  const snap = useTransportSnapshot();
  const maxBrowsingLevel = snap.maxBrowsingLevel;
  // The one number every gate below is computed from. `effectiveBrowsingCeiling`
  // re-applies the intersection the host already did, so the never-wider
  // property holds even against a host that ships a wrong value — and it
  // returns the domain ceiling untouched when the per-viewer field is absent,
  // which is what keeps an older host behaving exactly as it did.
  const effective =
    maxBrowsingLevel === undefined
      ? undefined
      : effectiveBrowsingCeiling(maxBrowsingLevel, snap.effectiveBrowsingLevel);
  return {
    domain: snap.domain,
    maxBrowsingLevel,
    effectiveBrowsingLevel: effective,
    isSfw: isSfwCeiling(effective),
    isLevelAllowed: (level: number) => isLevelAllowedCeiling(level, effective),
  };
}
