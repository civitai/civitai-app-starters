import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { BLOCK_SCOPES, defineBlock, type BlockManifest } from '@civitai/app-sdk/blocks';

const BLOCK_ID_PATTERN = /^[a-z0-9-]{3,64}$/;
const KNOWN_SLOTS = [
  'model.sidebar_top',
  'model.below_images',
  'model.actions_extra',
] as const;
const CONTENT_RATINGS = ['g', 'pg', 'pg13', 'r', 'x'] as const;

export interface InitOptions {
  destination?: string;
  blockId?: string;
  appId?: string;
  slot?: string;
  contentRating?: string;
  starterRef?: string;
}

/**
 * Scaffold a new block project. Shells out to `npx tiged ...` so the
 * template stays a thin GitHub pull — no need to bundle the starter
 * inside the CLI tarball or keep two copies in lockstep.
 *
 * After cloning, patches `block.manifest.json` with the user's chosen
 * blockId/appId/slot/contentRating (validating via `defineBlock`) and
 * `civitai.app.json` with the appId.
 */
export async function initCommand(opts: InitOptions): Promise<void> {
  const destination = opts.destination ?? 'my-block';
  const absDestination = resolve(process.cwd(), destination);
  if (existsSync(absDestination)) {
    throw new Error(
      `Destination "${destination}" already exists. Choose a fresh directory name.`,
    );
  }

  const blockId = opts.blockId ?? destination;
  if (!BLOCK_ID_PATTERN.test(blockId)) {
    throw new Error(
      `--block-id "${blockId}" must match ${BLOCK_ID_PATTERN}. ` +
        `(lowercase letters, digits, and hyphens; 3-64 chars). ` +
        `Override with --block-id <id>.`,
    );
  }

  const slot = opts.slot ?? KNOWN_SLOTS[0];
  if (!(KNOWN_SLOTS as readonly string[]).includes(slot)) {
    throw new Error(
      `--slot "${slot}" is not a known slot. Known slots: ${KNOWN_SLOTS.join(', ')}. ` +
        `If your block targets a slot that ships later, pass it explicitly — this list ` +
        `is a convenience filter, not the source of truth.`,
    );
  }

  const contentRating = (opts.contentRating ?? 'pg') as (typeof CONTENT_RATINGS)[number];
  if (!(CONTENT_RATINGS as readonly string[]).includes(contentRating)) {
    throw new Error(
      `--content-rating "${contentRating}" must be one of ${CONTENT_RATINGS.join(', ')}.`,
    );
  }

  const appId = opts.appId ?? 'app_REPLACE_ME';

  const starterRef = opts.starterRef ?? 'main';
  const tigedTarget = `civitai/civitai-app-starters/starters/civitai-block-starter${
    starterRef === 'main' ? '' : `#${starterRef}`
  }`;

  // eslint-disable-next-line no-console
  console.log(`→ Scaffolding ${destination} from ${tigedTarget}`);
  await runNpx(['tiged', tigedTarget, destination]);

  // Patch the manifest with the user-supplied fields. Validation happens
  // through defineBlock so a bad combo (e.g. an invalid sandbox token in
  // the template) surfaces here, not at deploy time.
  const manifestPath = resolve(absDestination, 'block.manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as BlockManifest;
  manifest.blockId = blockId;
  manifest.appId = appId;
  manifest.contentRating = contentRating;
  if (manifest.targets[0]) {
    manifest.targets[0].slotId = slot;
  }
  defineBlock({ manifest });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  const appConfigPath = resolve(absDestination, 'civitai.app.json');
  await writeFile(
    appConfigPath,
    JSON.stringify(
      {
        appId,
        baseUrl: 'https://civitai.com',
        blocks: ['./block.manifest.json'],
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  // eslint-disable-next-line no-console
  console.log(
    [
      '',
      `✓ ${destination} created.`,
      '',
      'Next:',
      `  cd ${destination}`,
      '  cp .env.example .env',
      '  pnpm install',
      '  pnpm dev:harness',
      '',
      `Manifest scopes (edit ${manifest.scopes.length === 1 ? 'this' : 'these'} to fit your block):`,
      `  ${manifest.scopes.join(', ')}`,
      '',
      `Available scope constants: ${Object.values(BLOCK_SCOPES).join(', ')}`,
    ].join('\n'),
  );
}

/** Spawn `npx <args...>` inheriting stdio. */
function runNpx(args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('npx', args, { stdio: 'inherit' });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`npx ${args.join(' ')} exited with code ${code}`));
    });
  });
}
