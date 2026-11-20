import type { ReactNode } from 'react';

import { useDomainMaturity } from './useDomainMaturity.js';

/**
 * Props for {@link SfwGate}.
 */
export interface SfwGateProps {
  /** Rendered only when the gate is open (domain is SFW, or `level` allowed). */
  children: ReactNode;
  /**
   * When set, gate on `isLevelAllowed(level)` (a single `BrowsingLevel` bit)
   * instead of the coarse `isSfw`. Lets a block reveal a level-specific
   * affordance (e.g. an R-rated toggle) only when that level is permitted —
   * by the domain AND by the viewer's own browsing-level setting.
   */
  level?: number;
  /** Rendered when the gate is closed. Defaults to `null` (render nothing). */
  fallback?: ReactNode;
}

/**
 * Convenience wrapper that renders `children` only when the current viewer may
 * be shown them here, else `fallback` — so a block can hide/blur mature
 * affordances without wiring {@link useDomainMaturity} by hand.
 *
 * Gating (both delegate to the hook, so both account for the DOMAIN's ceiling
 * AND the VIEWER's own browsing level — see `effectiveBrowsingLevel`):
 *  - no `level` prop → renders `children` when nothing mature may be shown
 *    (`isSfw`).
 *  - `level` prop set → renders `children` when that browsing-level bit is
 *    permitted (`isLevelAllowed(level)`).
 *
 * 🔴 A red-domain viewer who turned NSFW off closes this gate. That is the
 * point: before the per-viewer ceiling existed, the gate opened for everyone on
 * a mature domain regardless of their own setting.
 *
 * **Fail-closed SFW**: before `BLOCK_INIT` lands, and against a host that
 * projects no ceiling at all, the gate is treated as SFW — `children` show only
 * for SFW content, mature content shows `fallback`.
 *
 * @example
 * // Hide a mature-only carousel on a SFW domain:
 * <SfwGate fallback={<SafePlaceholder />}>
 *   <MatureCarousel />
 * </SfwGate>
 *
 * @example
 * // Reveal an R-rated control only when the domain allows R:
 * <SfwGate level={BrowsingLevel.R}>
 *   <RRatedToggle />
 * </SfwGate>
 */
export function SfwGate({ children, level, fallback = null }: SfwGateProps): ReactNode {
  const { isSfw, isLevelAllowed } = useDomainMaturity();
  const open = level === undefined ? isSfw : isLevelAllowed(level);
  return open ? children : fallback;
}
