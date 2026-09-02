/**
 * DRIFT GUARD — the vendored px breakpoint scale vs civitai/civitai's live
 * `src/utils/breakpoints.json`.
 *
 * Sibling of `theme-drift.test.ts` and deliberately a SEPARATE file with a
 * SEPARATE source path: the palette is vendored from `ThemeProvider.tsx`, the
 * breakpoints from `breakpoints.json`, and neither file mentions the other. Same
 * availability contract:
 *   - `CIVITAI_REPO` (default `/home/zach/workspace/civit/civitai`) points at the
 *     civitai checkout.
 *   - `REQUIRE_DRIFT_GUARD=1` makes an absent/unreadable source a FAILURE (set in
 *     CI, whose sparse checkout must therefore include `src/utils` as well as
 *     `src/providers`). Without it, absence SKIPS with a clear message.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BREAKPOINT_KEYS, civitaiBreakpointsSource } from '../src/breakpoints.source.js';

const CIVITAI_REPO = process.env.CIVITAI_REPO ?? '/home/zach/workspace/civit/civitai';
const BREAKPOINTS_JSON = join(CIVITAI_REPO, 'src/utils/breakpoints.json');
const REQUIRED = process.env.REQUIRE_DRIFT_GUARD === '1';
const available = existsSync(BREAKPOINTS_JSON);

describe('breakpoint drift guard vs civitai/civitai breakpoints.json', () => {
  it('civitai breakpoints.json is present (required in CI via REQUIRE_DRIFT_GUARD=1)', () => {
    if (!available) {
      if (REQUIRED) {
        throw new Error(
          `REQUIRE_DRIFT_GUARD=1 but civitai breakpoints are not readable at ${BREAKPOINTS_JSON}. ` +
            `In CI, check out civitai/civitai (sparse: src/providers AND src/utils) and set ` +
            `CIVITAI_REPO to it.`
        );
      }
      console.warn(
        `[breakpoint-drift] SKIPPING drift assertions: civitai source not found at ` +
          `${BREAKPOINTS_JSON}. Set CIVITAI_REPO to enable it locally, or REQUIRE_DRIFT_GUARD=1 ` +
          `to make absence a failure.`
      );
    }
    expect(true).toBe(true);
  });

  it.runIf(available)('every vendored breakpoint matches the live px scale exactly', () => {
    const live = JSON.parse(readFileSync(BREAKPOINTS_JSON, 'utf8')) as Record<string, string>;

    const mismatches: string[] = [];
    for (const key of BREAKPOINT_KEYS) {
      if (live[key] !== civitaiBreakpointsSource[key]) {
        mismatches.push(
          `  ${key}: live=${JSON.stringify(live[key])} vendored=${JSON.stringify(
            civitaiBreakpointsSource[key]
          )}`
        );
      }
    }

    // Both directions: a key ADDED upstream (a new `2xl`) is drift too — the
    // vendored scale would silently stay a strict subset and nothing would say so.
    const liveKeys = Object.keys(live).sort();
    const vendoredKeys = [...BREAKPOINT_KEYS].sort();
    if (JSON.stringify(liveKeys) !== JSON.stringify(vendoredKeys)) {
      mismatches.push(
        `  key set: live=${JSON.stringify(liveKeys)} vendored=${JSON.stringify(vendoredKeys)}`
      );
    }

    if (mismatches.length > 0) {
      throw new Error(
        `breakpoints.source.ts has DRIFTED from civitai/civitai's live px scale ` +
          `(src/utils/breakpoints.json).\nRe-vendor the changed values into ` +
          `packages/civitai-theme/src/breakpoints.source.ts, then rebuild ` +
          `(\`pnpm --filter @civitai/theme build\`) and commit the regenerated ` +
          `src/tokens.generated.ts.\nMismatches:\n${mismatches.join('\n')}`
      );
    }
  });
});
