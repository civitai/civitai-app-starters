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
  const candidates = [readViteVar(), readNextPublicVar(), readPublicVar()].filter(
    (v): v is string => !!v,
  );
  if (!candidates.length) return [];
  return candidates[0]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 🔴 EVERY ENV READ BELOW MUST SPELL ITS KEY AS A LITERAL MEMBER ACCESS.
 * Never reintroduce a `readEnv(key)` helper, a `Record<string, …>` index, or any
 * other computed-key form — `import.meta.env[k]` / `process.env[k]`. Both halves
 * of that break, in opposite directions, and neither is visible to a unit test
 * that only asserts the returned array (see `test/detectorEnvBundle.test.ts`,
 * which bundles this file and asserts on the EMITTED code):
 *
 * 1. LEAK (`import.meta.env[k]`). Vite substitutes `import.meta.env.SOME_LITERAL`
 *    at build time by static analysis. A computed key cannot be analysed, so Vite
 *    falls back to inlining the ENTIRE env object — putting every `VITE_*` var the
 *    block app has defined into its production bundle, `VITE_LIVE_BLOCK_TOKEN`
 *    included. Measured against published `@civitai/blocks-react@0.55.0`, whose
 *    `dist/internal/detector.js:33` reads `import.meta.env?.[key]`.
 *    Optional chaining is FINE: `import.meta.env?.VITE_X` is still substituted
 *    (measured with Vite 8) — it is the computed KEY that defeats the analysis.
 *
 * 2. SILENT MISS (`process.env[k]`). webpack/Next.js `DefinePlugin` replaces the
 *    literal member expression `process.env.NEXT_PUBLIC_FOO` and nothing else. A
 *    computed read is left alone, and a browser bundle has no real `process` to
 *    fall back to — so `NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS` never resolved
 *    for a Next.js block app at all. Note the bare `process.env.X` spelling is
 *    load-bearing too: `globalThis.process.env.X` is NOT a DefinePlugin key
 *    either, so it would keep the bug. The `try`/`catch` is what makes a bare
 *    `process` safe — an unsubstituted reference throws `ReferenceError` in the
 *    browser and is swallowed here, exactly as before.
 */
interface BlockOriginEnv {
  readonly VITE_BLOCK_ALLOWED_PARENT_ORIGINS?: string;
  readonly NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS?: string;
  readonly PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS?: string;
}

/** `VITE_…` — Vite / the PWA starters. import.meta first, then process.env. */
function readViteVar(): string | undefined {
  try {
    const v = (import.meta as { env?: BlockOriginEnv }).env?.VITE_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
  } catch {
    /* ignore */
  }
  try {
    const v = process.env.VITE_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
  } catch {
    /* ignore */
  }
  return undefined;
}

/** `NEXT_PUBLIC_…` — Next.js. import.meta first, then process.env. */
function readNextPublicVar(): string | undefined {
  try {
    const v = (import.meta as { env?: BlockOriginEnv }).env
      ?.NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
  } catch {
    /* ignore */
  }
  try {
    const v = process.env.NEXT_PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
  } catch {
    /* ignore */
  }
  return undefined;
}

/** `PUBLIC_…` — SvelteKit. import.meta first, then process.env. */
function readPublicVar(): string | undefined {
  try {
    const v = (import.meta as { env?: BlockOriginEnv }).env?.PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
  } catch {
    /* ignore */
  }
  try {
    const v = process.env.PUBLIC_BLOCK_ALLOWED_PARENT_ORIGINS;
    if (v) return v;
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
