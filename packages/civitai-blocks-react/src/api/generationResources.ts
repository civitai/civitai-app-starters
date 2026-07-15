/**
 * REST client for `GET /api/v1/blocks/generation-resources` — the block-token-
 * gated REHYDRATE of generation resources by version id (App Blocks Phase-2a
 * PR-C). When a block loads a saved set of resources it holds only the picked
 * modelVersionIds; this endpoint returns the SAME public "safe subset" the
 * `OPEN_RESOURCE_PICKER` result carries (`projectSafeGenerationResource` on the
 * host), WITHOUT re-opening the picker. It never returns availability /
 * hasAccess / early-access / usageControl / minor / poi / sfwOnly / cover-image
 * internals — only the public recommended settings + trained words a block
 * renders (strength + min/max clamp, trigger words, clipSkip, names).
 *
 * MONEY-SAFETY: the returned data is DISCOVERY ONLY. Every `versionId` is a
 * HINT, never an entitlement — the server re-validates AND re-prices at
 * estimate/submit. The maturity ceiling is AUTHORITATIVELY CLAMPED server-side
 * to the block token's signed `maxBrowsingLevel`; the client sends no maturity.
 *
 * The URL/param builder + response mapper are PURE + node-testable (mirrors the
 * `internal/catalog.ts` pure-builder split); {@link useGenerationResources}
 * layers the React `useHostOrigin()` + bearer-token fetch on top.
 */

import type { BlockResourceInfo } from '@civitai/app-sdk/blocks';

/** The block-token-gated generation-resources rehydrate base. */
export const GENERATION_RESOURCES_API_BASE = '/api/v1/blocks/generation-resources';

/** Server cap on the number of ids per request (mirrors the endpoint's `MAX_IDS`). */
export const MAX_GENERATION_RESOURCE_IDS = 30;

/**
 * Sanitize a list of version ids the way the server's zod schema does: keep only
 * positive integers, de-dupe (preserving first-seen order), and cap the count at
 * {@link MAX_GENERATION_RESOURCE_IDS}. Pure + total.
 */
function sanitizeIds(versionIds: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of versionIds) {
    if (!Number.isInteger(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_GENERATION_RESOURCE_IDS) break; // enforce the ≤30 cap
  }
  return out;
}

/**
 * Build the rehydrate URL for a set of version ids: `?ids=csv`. Ids are
 * sanitized + capped at {@link MAX_GENERATION_RESOURCE_IDS} (extra/junk ids are
 * dropped rather than sent, so the request never 400s on the server's cap).
 * Pure + deterministic. `base` defaults to {@link GENERATION_RESOURCES_API_BASE}.
 */
export function buildGenerationResourcesUrl(
  versionIds: number[],
  base: string = GENERATION_RESOURCES_API_BASE,
): string {
  const ids = sanitizeIds(versionIds);
  const params = new URLSearchParams();
  params.set('ids', ids.join(','));
  return `${base}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Response shape (minimal — only the fields we read). Tolerant of missing
// fields (a malformed row is skipped, never throws).
// ---------------------------------------------------------------------------

interface RawGenerationResource {
  versionId?: number;
  modelId?: number;
  modelName?: string;
  versionName?: string;
  baseModel?: string;
  modelType?: string;
  strength?: number;
  minStrength?: number;
  maxStrength?: number;
  trainedWords?: string[];
  clipSkip?: number | null;
}

interface RawGenerationResourcesResponse {
  items?: RawGenerationResource[];
  maturity?: { browsingLevel?: number; sfwOnly?: boolean };
}

/**
 * Map a raw `{ items: [...] }` response → the widened {@link BlockResourceInfo}[]
 * a block consumes. Skips any row without a usable `versionId`. Carries the
 * public recommended settings (strength + clamp, trained words, clipSkip)
 * through unchanged — the host already applied its defaults in
 * `projectSafeGenerationResource`. Never throws.
 */
export function responseToResources(
  raw: RawGenerationResourcesResponse | null | undefined,
): BlockResourceInfo[] {
  const items = Array.isArray(raw?.items) ? raw!.items! : [];
  const out: BlockResourceInfo[] = [];
  for (const r of items) {
    if (!r || typeof r !== 'object') continue;
    const versionId = r.versionId;
    if (typeof versionId !== 'number' || !Number.isFinite(versionId)) continue;
    out.push({
      versionId,
      modelId: typeof r.modelId === 'number' ? r.modelId : 0,
      modelName: typeof r.modelName === 'string' ? r.modelName : '',
      versionName: typeof r.versionName === 'string' ? r.versionName : '',
      baseModel: typeof r.baseModel === 'string' ? r.baseModel : '',
      modelType: typeof r.modelType === 'string' ? r.modelType : '',
      ...(typeof r.strength === 'number' ? { strength: r.strength } : {}),
      ...(typeof r.minStrength === 'number' ? { minStrength: r.minStrength } : {}),
      ...(typeof r.maxStrength === 'number' ? { maxStrength: r.maxStrength } : {}),
      ...(Array.isArray(r.trainedWords) ? { trainedWords: r.trainedWords } : {}),
      ...(r.clipSkip === null || typeof r.clipSkip === 'number' ? { clipSkip: r.clipSkip } : {}),
    });
  }
  return out;
}
