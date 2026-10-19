/**
 * `blockManifestPlugin()` hands the local manifest's `scopes` and `storage` to
 * `@civitai/sdk` on the DEV SERVER, for a dev-tunnel preview whose document store
 * is local (civitai/civitai-app-starters#710) — and never in a build.
 *
 * Driven through REAL Vite (a dev server's `transformIndexHtml` and a real
 * `build`), not by calling the hook by hand: whether the hook runs, and in which
 * command, is Vite's decision, and that is the property under test.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterAll, describe, expect, it } from 'vitest';
import { build, createServer, type Rollup } from 'vite';

import { blockManifestPlugin, LOCAL_PREVIEW_MANIFEST_GLOBAL } from '../../src/vite/index.js';
import { valid } from './fixtures.js';

const STORAGE = {
  collections: {
    notes: { visibility: 'private' },
    // A `<` in a value must not close the <script> element.
    board: { visibility: 'shared', write: 'own', marks: ['vote'], indexes: { status: 'string' } },
  },
};
const SCOPES = ['apps:storage', 'apps:storage:publish', 'user:read:self'];
const HTML =
  '<!doctype html><html><head><meta charset="UTF-8" /><title>t</title></head>' +
  '<body><script type="module" src="/main.js"></script></body></html>';

const dirs: string[] = [];
function project(manifest: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'local-preview-plugin-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'block.manifest.json'), JSON.stringify(manifest));
  writeFileSync(join(dir, 'index.html'), HTML);
  writeFileSync(join(dir, 'main.js'), 'export {};\n');
  return dir;
}
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Runs the page's inline scripts in a fresh context and returns what they set. */
function runInlineScripts(html: string): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {};
  sandbox.globalThis = sandbox;
  // Plain scanning, not a regex: this reads the dev server's own output, and an
  // HTML-matching regex is what static analysis rightly distrusts.
  const lower = html.toLowerCase();
  const bodies: string[] = [];
  for (let at = lower.indexOf('<script'); at !== -1; at = lower.indexOf('<script', at + 1)) {
    const open = lower.indexOf('>', at);
    const close = lower.indexOf('</script', open);
    if (open === -1 || close === -1) break;
    bodies.push(html.slice(open + 1, close));
  }
  for (const body of bodies) runInNewContext(body, sandbox);
  return sandbox;
}

describe('dev server: the manifest reaches the page', () => {
  it('exposes exactly scopes + storage, before any module script', async () => {
    const root = project(valid({ scopes: SCOPES, storage: STORAGE, name: 'Name </script><b>x' }));
    const server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [blockManifestPlugin()],
      server: { middlewareMode: true, ws: false },
    });
    try {
      const html = await server.transformIndexHtml('/', HTML);
      const exposed = runInlineScripts(html)[LOCAL_PREVIEW_MANIFEST_GLOBAL];

      expect(exposed).toEqual({ scopes: SCOPES, storage: STORAGE });
      // Ahead of the app's own entry, so it is set before `initialize()` runs.
      expect(html.indexOf(LOCAL_PREVIEW_MANIFEST_GLOBAL)).toBeLessThan(html.indexOf('/main.js'));
      // AFTER <meta charset>: a large `storage` block prepended to <head> could push
      // the charset past the 1024-byte prescan, and the page would decode wrongly.
      expect(html.indexOf('<meta charset')).toBeGreaterThanOrEqual(0);
      expect(html.indexOf(LOCAL_PREVIEW_MANIFEST_GLOBAL)).toBeGreaterThan(html.indexOf('<meta charset'));
      // Nothing else of the manifest — the `name` carries a `</script>` that
      // would otherwise also prove the escaping.
      expect(html).not.toContain('fixture-block');
      expect(html).not.toContain('<b>x');
    } finally {
      await server.close();
    }
  });

  it('escapes `<`, so a value cannot close the script element', async () => {
    const storage = { collections: { notes: { visibility: 'private', indexes: { '</script>': 'string' } } } };
    const { localPreviewManifestScript } = await import('../../src/vite/index.js');
    const body = localPreviewManifestScript({ scopes: SCOPES, storage } as never);

    expect(body).not.toContain('<');
    expect(runInlineScripts(`<script>${body}</script>`)[LOCAL_PREVIEW_MANIFEST_GLOBAL]).toEqual({
      scopes: SCOPES,
      storage,
    });
  });
});

describe('build: the manifest never reaches the page', () => {
  it('emits no injected script', async () => {
    const root = project(valid({ scopes: SCOPES, storage: STORAGE }));
    const output = (await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [blockManifestPlugin()],
      build: { write: false },
    })) as Rollup.RollupOutput;
    const html = output.output.find((o) => o.fileName === 'index.html');

    // Positive control: the page WAS emitted and read.
    expect(html && 'source' in html ? String(html.source) : '').toContain('<title>t</title>');
    expect(String((html as Rollup.OutputAsset).source)).not.toContain(LOCAL_PREVIEW_MANIFEST_GLOBAL);
  });
});
