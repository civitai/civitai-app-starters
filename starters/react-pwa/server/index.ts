import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app as apiApp } from './app.js';
import { env } from './env.js';

/**
 * Production entry. Serves the built Vite SPA (dist/) and mounts the API.
 * In dev this file is not loaded — vite.config.ts wires the same `apiApp`
 * through @hono/vite-dev-server so the SPA and API share one port.
 *
 * 🔴 PATHS RESOLVE FROM THIS FILE, NOT FROM THE PROCESS CWD. This module is
 * emitted to `dist-server/index.js`, so `dist/` is its sibling. Resolving
 * `./dist` against the CWD meant the server only worked when the launcher
 * happened to `cd` into the package directory first — systemd's
 * `WorkingDirectory`, a container `WORKDIR`, pm2 and monorepo task runners all
 * break that assumption, and the failure was a 404 on every asset with the app
 * still reporting healthy.
 *
 * 🔴 AND THE SERVER NEVER FETCHES ITSELF. The SPA fallback used to be
 * `fetch('http://localhost:' + PORT + '/index.html')`. That is one extra TCP
 * round-trip per deep link at best; at worst — exactly the case above, where
 * the static middleware cannot find `dist/` — `/index.html` falls into the same
 * catch-all, which fetches itself again, forever. Measured on the pre-fix code
 * from a foreign cwd: 25 requests took the process from 20 open file
 * descriptors to over 92,000, and every request timed out. `index.html` is read
 * ONCE at boot and served from memory instead.
 */

// `dist-server/index.js` -> package root -> `dist/`.
const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const INDEX_HTML_PATH = join(DIST_DIR, 'index.html');

/**
 * Read the SPA shell once, at boot. 🔴 FAIL LOUDLY IF IT IS NOT THERE. Without
 * this the process starts happily and answers every non-API route with an
 * error, so a mis-deployed build (wrong image layer, `dist/` not copied, build
 * step skipped) presents as a broken app rather than a failed deploy — and
 * every health check and orchestrator says the service is fine.
 */
let indexHtml: string;
try {
  indexHtml = readFileSync(INDEX_HTML_PATH, 'utf8');
} catch (err) {
  console.error(
    `FATAL: cannot read ${INDEX_HTML_PATH}\n` +
      `The SPA has not been built, or dist/ was not shipped alongside dist-server/.\n` +
      `Run \`pnpm build\` (vite build + tsc -p tsconfig.server.json) before \`pnpm start\`.\n` +
      `${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}

const root = new Hono();

root.route('/', apiApp);

root.use(
  '/*',
  serveStatic({
    root: DIST_DIR,
    onFound: (path, c) => {
      if (path.includes('/assets/')) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);

// SPA fallback: serve index.html for deep links (e.g. /some/route on first load)
// so client-side routing keeps working. Served from the boot-time read above —
// no self-fetch, no filesystem hit per request.
root.get('/*', (c) => c.html(indexHtml));

serve({ fetch: root.fetch, port: env.PORT }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
