import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DevOptions {
  port: string;
}

/**
 * Convenience wrapper for `pnpm dev:harness` — flips `VITE_DEV_HARNESS=true`
 * and runs Vite. Users who already know about the harness flag should just
 * run `pnpm dev:harness` directly; this exists so `civitai dev` "just works"
 * after `civitai init`.
 */
export async function devCommand(opts: DevOptions): Promise<void> {
  const cwd = process.cwd();
  if (!existsSync(resolve(cwd, 'vite.config.ts')) && !existsSync(resolve(cwd, 'vite.config.js'))) {
    throw new Error(
      'No vite.config.{ts,js} in the current directory. Run `civitai dev` from a scaffolded ' +
        'block project (try `civitai init <name>` first).',
    );
  }

  const port = Number.parseInt(opts.port, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
    throw new Error(`--port must be a number between 1 and 65535 (got "${opts.port}")`);
  }

  // eslint-disable-next-line no-console
  console.log(`→ Starting Vite with VITE_DEV_HARNESS=true on http://localhost:${port}`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn('npx', ['vite', '--port', String(port)], {
      stdio: 'inherit',
      env: { ...process.env, VITE_DEV_HARNESS: 'true' },
    });
    child.on('error', rejectPromise);
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolvePromise();
      else rejectPromise(new Error(`vite exited with code ${code}`));
    });
  });
}
