#!/usr/bin/env node
import { Command } from 'commander';

import { initCommand } from './commands/init.js';
import { devCommand } from './commands/dev.js';
import { deployCommand } from './commands/deploy.js';
import { bundleCommand } from './commands/bundle.js';
import { uploadCommand } from './commands/upload.js';
import { publishCommand } from './commands/publish.js';

const program = new Command();

program
  .name('civitai')
  .description('Command-line tools for shipping Civitai App Blocks')
  .version('0.0.0');

program
  .command('init [destination]')
  .description('Scaffold a new block project (Vite + React) from the official starter')
  .option('--block-id <id>', 'Block ID (must match /^[a-z0-9-]{3,64}$/)')
  .option('--app-id <id>', 'OauthClient app ID this block belongs to')
  .option('--slot <slot>', 'Target slot (e.g. model.sidebar_top)')
  .option('--content-rating <rating>', 'g | pg | pg13 | r | x', 'pg')
  .option(
    '--starter-ref <ref>',
    'civitai-app-starters branch / tag / commit to scaffold from',
    'main',
  )
  .action(async (destination: string | undefined, opts) => {
    await initCommand({ destination, ...opts });
  });

program
  .command('dev')
  .description('Run the block in local dev mode with the harness mounted')
  .option('-p, --port <port>', 'Port for the Vite dev server', '5173')
  .action(async (opts) => {
    await devCommand({ port: opts.port });
  });

program
  .command('deploy')
  .description('Register or update block manifests on civitai.com')
  .option('--config <path>', 'Path to civitai.app.json', './civitai.app.json')
  .action(async (opts) => {
    await deployCommand({ configPath: opts.config });
  });

program
  .command('bundle')
  .description('Build a static asset bundle for host-mode (inline) deployment [coming soon]')
  .action(async () => {
    await bundleCommand();
  });

program
  .command('upload')
  .description("Push bundled assets to Civitai's CDN for host-mode rendering [coming soon]")
  .action(async () => {
    await uploadCommand();
  });

program
  .command('publish')
  .description('Release a new block version after asset upload [coming soon]')
  .action(async () => {
    await publishCommand();
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof Error) {
    // eslint-disable-next-line no-console
    console.error(`✖ ${err.message}`);
  } else {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  process.exit(1);
});
