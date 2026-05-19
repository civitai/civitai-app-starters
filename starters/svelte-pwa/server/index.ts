import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app as apiApp } from './app.js';
import { env } from './env.js';

const root = new Hono();
root.route('/', apiApp);
root.use(
  '/*',
  serveStatic({
    root: './dist',
    onFound: (path, c) => {
      if (path.includes('/assets/')) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }),
);
root.get('/*', async (c) => {
  return c.html(await (await fetch(`http://localhost:${env.PORT}/index.html`)).text());
});

serve({ fetch: root.fetch, port: env.PORT }, (info) => {
  console.log(`Listening on http://localhost:${info.port}`);
});
