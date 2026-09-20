/**
 * REGRESSION TEST for issue #330 — the closing condition, stated as code.
 *
 * `defineBlock` must accept every `block.manifest.json` this repository ships.
 * At `origin/main` @ 9a060f3 it accepted NONE of the seven: the validator
 * required `iframe.src`, a field the platform REFUSES (it stamps the bundle URL
 * itself), so the scaffold `civitai app init` produces failed the very command
 * `starters/civitai-block-starter/AGENTS.md` told the author to run.
 *
 * RED/GREEN, re-derivable rather than asserted:
 *   git worktree add --detach /tmp/lbi 9a060f3
 *   cp packages/civitai-app-sdk/test/blocks/shipped-manifests.test.ts /tmp/lbi/packages/civitai-app-sdk/test/blocks/
 *   (cd /tmp/lbi && pnpm --filter @civitai/app-sdk exec vitest run test/blocks/shipped-manifests.test.ts)
 *   → 7 failures, each "manifest.iframe.src must be a non-empty string".
 *
 * It SWEEPS rather than naming the seven, so a manifest added later is covered
 * the day it lands — and the count assertion is the positive control that keeps
 * an empty sweep from reading as a pass.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defineBlock } from '../../src/blocks/defineBlock.js';
import type { BlockManifest } from '../../src/blocks/types.js';

const REPO_ROOT = join(__dirname, '../../../..');
const STARTERS_DIR = join(REPO_ROOT, 'starters');

/** Every `block.manifest.json` under `starters/`, recursively. */
function findManifests(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) findManifests(full, out);
    else if (entry.name === 'block.manifest.json') out.push(full);
  }
  return out;
}

const manifestPaths = findManifests(STARTERS_DIR).sort();

describe('every shipped block.manifest.json passes defineBlock', () => {
  it('found the shipped manifests at all (positive control for the sweep)', () => {
    // A zero here is indistinguishable from a sweep wired to the wrong path,
    // which would make every assertion below vacuously green.
    expect(statSync(STARTERS_DIR).isDirectory()).toBe(true);
    expect(manifestPaths.length).toBeGreaterThanOrEqual(7);
  });

  it.each(manifestPaths.map((p) => [p.slice(REPO_ROOT.length + 1), p] as const))(
    '%s',
    (_label, path) => {
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as BlockManifest;
      expect(() => defineBlock({ manifest })).not.toThrow();
    },
  );

  it('rejects a shipped manifest that grows a server-owned iframe.src', () => {
    // MUTATION CONTROL. The sweep above only proves acceptance; a validator
    // that accepted everything would pass it. Break exactly one thing — the
    // field whose REQUIREMENT was the #330 defect — and confirm the gate
    // refuses it, on its own error rather than a neighbour's.
    const manifest = JSON.parse(readFileSync(manifestPaths[0], 'utf8')) as Record<string, unknown>;
    (manifest.iframe as Record<string, unknown>).src = 'https://my-block.civit.ai/';
    try {
      defineBlock({ manifest: manifest as unknown as BlockManifest });
      expect.unreachable('a dev-set iframe.src must be rejected');
    } catch (err) {
      expect((err as { field?: string }).field).toBe('iframe.src');
      expect((err as Error).message).toContain('SERVER-OWNED');
    }
  });
});
