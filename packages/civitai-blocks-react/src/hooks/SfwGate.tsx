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
   * affordance (e.g. an R-rated toggle) only when the domain permits that level.
   */
  level?: number;
  /** Rendered when the gate is closed. Defaults to `null` (render nothing). */
  fallback?: ReactNode;
}

/**
 * Convenience wrapper that renders `children` only when the surrounding
 * color-domain permits it, else `fallback` — so a block can hide/blur mature
 * affordances on a SFW domain without wiring {@link useDomainMaturity} by hand.
 *
 * Gating:
 *  - no `level` prop → renders `children` when the domain is SFW (`isSfw`).
 *  - `level` prop set → renders `children` when that browsing-level bit is
 *    allowed by the domain ceiling (`isLevelAllowed(level)`).
 *
 * **Fail-closed SFW**: before `BLOCK_INIT` lands, and against a host that
 * predates civitai #2670 (no ceiling field), the gate is treated as SFW —
 * `children` show only for SFW content, mature content shows `fallback`.
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
