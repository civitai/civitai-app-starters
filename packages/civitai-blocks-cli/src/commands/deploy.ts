import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { defineBlock, type BlockManifest } from '@civitai/app-sdk/blocks';

export interface DeployOptions {
  configPath: string;
}

interface AppConfig {
  appId?: string;
  baseUrl?: string;
  blocks?: string[];
}

/**
 * Stubs the deploy flow today: the platform endpoint
 * `POST /api/v1/developer/block-manifests` is currently `JOB_TOKEN`-gated
 * (see civitai/civitai's `docs/features/app-blocks.md`). Per-app OAuth
 * replacing `JOB_TOKEN` is a Phase 2 follow-up.
 *
 * What we DO run here as a useful preflight:
 *   - Validate every manifest listed in `civitai.app.json.blocks[]` via
 *     `defineBlock` — surfaces authoring mistakes (bad blockId, disallowed
 *     sandbox token, PascalCase scopes) without needing the server.
 *
 * When the OAuth path lands, the same preflight runs first, then the
 * actual POST.
 */
export async function deployCommand(opts: DeployOptions): Promise<void> {
  const configPath = resolve(process.cwd(), opts.configPath);
  let config: AppConfig;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8')) as AppConfig;
  } catch (err) {
    throw new Error(
      `Failed to read ${opts.configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const manifestPaths = config.blocks ?? [];
  if (manifestPaths.length === 0) {
    throw new Error(`${opts.configPath} lists no manifests in "blocks".`);
  }

  // eslint-disable-next-line no-console
  console.log(`→ Validating ${manifestPaths.length} manifest${manifestPaths.length === 1 ? '' : 's'} (preflight)`);

  for (const relPath of manifestPaths) {
    const absPath = resolve(process.cwd(), relPath);
    const manifest = JSON.parse(await readFile(absPath, 'utf8')) as BlockManifest;
    defineBlock({ manifest });
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${relPath} — blockId=${manifest.blockId}, version=${manifest.version}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      '⏳ `civitai deploy` cannot self-publish in v1.',
      '',
      'The platform endpoint POST /api/v1/developer/block-manifests is currently',
      'JOB_TOKEN-gated — only civitai/civitai server jobs can call it. Hand the',
      `validated manifest${manifestPaths.length === 1 ? '' : 's'} to the platform team along with your appId (${
        config.appId ?? '<missing in civitai.app.json>'
      }) for registration.`,
      '',
      'Per-app OAuth replacing JOB_TOKEN is a Phase 2 follow-up. Once it lands,',
      'this command will POST the validated manifests directly. Until then the',
      'preflight is the useful half.',
    ].join('\n'),
  );
}
