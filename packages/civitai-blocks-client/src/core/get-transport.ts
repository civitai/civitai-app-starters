import { IframeTransport } from './transports/iframe-transport.js';
import type { BlockTransport } from './transport.js';

/** First match wins across the VITE_ / NEXT_PUBLIC_ / PUBLIC_ spellings. */
function readAllowedOriginsFromEnv(): string[] {
  const raw = readViteVar() ?? readNextPublicVar() ?? readPublicVar();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

interface BlockOriginEnv {
  readonly VITE_BLOCK_ALLOWED_PARENT_ORIGINS?: string;
  readonly NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS?: string;
  readonly PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS?: string;
}

declare const process: { env: BlockOriginEnv };

// Every key is spelled as a literal member access. Bundlers substitute only that
// form: a computed `import.meta.env[key]` makes Vite inline the whole env object,
// every VITE_* secret included, and `process.env[key]` is never replaced at all.
// The try/catch is what makes a bare `process` safe in a browser.

function readViteVar(): string | undefined {
  try {
    const v = (import.meta as { env?: BlockOriginEnv }).env?.VITE_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
  } catch {}
  try {
    return process.env.VITE_BLOCK_ALLOWED_PARENT_ORIGINS || undefined;
  } catch {
    return undefined;
  }
}

function readNextPublicVar(): string | undefined {
  try {
    const v = (import.meta as { env?: BlockOriginEnv }).env?.NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
  } catch {}
  try {
    return process.env.NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS || undefined;
  } catch {
    return undefined;
  }
}

function readPublicVar(): string | undefined {
  try {
    const v = (import.meta as { env?: BlockOriginEnv }).env?.PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
  } catch {}
  try {
    return process.env.PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fallback for consumers with no build step to read env from (a CDN bundle).
 * `*.civit.ai` is deliberately absent — blocks are *served* there, so allowing
 * it as a parent would let one block drive another's bridge.
 */
const DEFAULT_ALLOWED_PARENT_ORIGINS: readonly string[] = [
  'https://civitai.com',
  'https://civitai.red',
  'https://civitai.green',
  'https://*.civitai.com',
  'https://*.civitaic.com',
];

export interface DetectOptions {
  /** Overrides the env-derived allowlist and the built-in default. */
  allowedParentOrigins?: string[];
  /** Override `globalThis.window`. Tests use this with `happy-dom`'s window. */
  window?: Window;
}

function detectTransport(opts: DetectOptions = {}): BlockTransport {
  // An explicit `[]` from the caller is an assertion, not an omission — leave
  // it empty so IframeTransport still throws.
  const fromEnv = readAllowedOriginsFromEnv();
  const allowedParentOrigins =
    opts.allowedParentOrigins ??
    (fromEnv.length ? fromEnv : [...DEFAULT_ALLOWED_PARENT_ORIGINS]);
  return new IframeTransport({ allowedParentOrigins, window: opts.window });
}

// On globalThis, not a module `let`: a CDN copy and a bundled copy are separate
// module instances, and one transport each means a duplicate BLOCK_READY.
const CACHE_KEY = Symbol.for('civitai.blocks.transport');

type TransportGlobal = { [CACHE_KEY]?: BlockTransport | null };

function slot(): TransportGlobal {
  return globalThis as unknown as TransportGlobal;
}

/** Options apply on first call only; `__resetTransport()` to re-detect. */
export function getTransport(opts?: DetectOptions): BlockTransport {
  const g = slot();
  const cached = g[CACHE_KEY];
  if (cached) return cached;
  const created = detectTransport(opts);
  g[CACHE_KEY] = created;
  return created;
}

/** Test-only. */
export function __resetTransport(): void {
  const g = slot();
  // Some transports allocate listeners; dispose if possible.
  const disposable = g[CACHE_KEY] as (BlockTransport & { dispose?: () => void }) | null | undefined;
  disposable?.dispose?.();
  g[CACHE_KEY] = null;
}
