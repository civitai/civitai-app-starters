import { IframeTransport } from './iframeTransport.js';
import { InlineTransport } from './inlineTransport.js';
import type { BlockTransport } from './transport.js';

/**
 * Reads the comma-separated allowlist from the build-time env. The block app
 * sets this at bundling time; the transport refuses to mount without at
 * least one origin.
 *
 * Supported env vars (first match wins):
 * - `VITE_BLOCK_ALLOWED_PARENT_ORIGINS` (Vite, the PWA starters)
 * - `NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS` (Next.js)
 * - `PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS` (SvelteKit)
 *
 * In tests / SSR where no env is present, callers should pass
 * `detect({ allowedParentOrigins })` explicitly.
 */
export function readAllowedOriginsFromEnv(): string[] {
  const candidates = [
    readEnv('VITE_BLOCK_ALLOWED_PARENT_ORIGINS'),
    readEnv('NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS'),
    readEnv('PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS'),
  ].filter((v): v is string => !!v);
  if (!candidates.length) return [];
  return candidates[0]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readEnv(key: string): string | undefined {
  // Vite injects import.meta.env at build time; Node exposes process.env.
  // Read each independently, swallowing access errors (e.g. process undefined in browser).
  try {
    const fromImportMeta = (import.meta as { env?: Record<string, string | undefined> }).env?.[key];
    if (fromImportMeta) return fromImportMeta;
  } catch {
    /* ignore */
  }
  try {
    const fromProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
      .process?.env?.[key];
    if (fromProcess) return fromProcess;
  } catch {
    /* ignore */
  }
  return undefined;
}

export interface DetectOptions {
  /** Override the env-derived allowlist. Required for tests and inline-mode dev. */
  allowedParentOrigins?: string[];
  /** Override `globalThis.window`. Tests use this with `happy-dom`'s window. */
  window?: Window;
}

/**
 * Returns the right transport for the current runtime.
 *
 * - `window.__CIVITAI_BLOCK_CONTEXT__` present → `InlineTransport` (v2)
 * - otherwise → `IframeTransport`
 */
export const BlockTransportDetector = {
  detect(opts: DetectOptions = {}): BlockTransport {
    const win = opts.window ?? (globalThis as { window?: Window }).window;
    if (win?.__CIVITAI_BLOCK_CONTEXT__) {
      return new InlineTransport();
    }
    const allowedParentOrigins = opts.allowedParentOrigins ?? readAllowedOriginsFromEnv();
    return new IframeTransport({ allowedParentOrigins, window: opts.window });
  },
};
