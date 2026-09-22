/**
 * Direct-load (unembedded) detection helpers.
 *
 * A block is served from its OWN origin `<slug>.civit.ai` but is designed to
 * run EMBEDDED inside the civitai.com host iframe at
 * `civitai.com/apps/run/<slug>`, which delivers the runtime context (viewer,
 * scoped token, theme) via the postMessage `BLOCK_INIT` handshake. When a block
 * is opened DIRECTLY — a top-level navigation to its bare `<slug>.civit.ai`
 * origin (shared link, social crawl, someone pasting the URL) — no parent ever
 * sends `BLOCK_INIT`, so the block's `ready` gate never flips and it hangs on a
 * loading spinner forever. These helpers let the SDK degrade that into a
 * branded "Open on Civitai" landing.
 *
 * Pure + framework-agnostic on purpose — {@link hostToRunUrl} is exhaustively
 * unit-testable, and the React glue (the `useDirectLoad` hook + the
 * `<BlockGate>` / `<DirectLoadFallback>` UI) builds on it.
 */

/**
 * Default milliseconds to wait for `BLOCK_INIT` before concluding a TOP-LEVEL
 * load is a direct (unembedded) load and showing the fallback.
 *
 * Chosen well ABOVE the dev harness's init latency and below anything a human
 * would tolerate staring at a spinner. The `createMockHost` / `<Harness>` dev
 * host posts `BLOCK_INIT` on a `setTimeout(0)` macrotask (see
 * `mockHost.ts` → `after(0, … BLOCK_INIT …)`), so `ready` flips almost
 * immediately there and this timeout NEVER elapses in the harness — the
 * fallback is reserved for the genuine "nobody is ever going to send
 * BLOCK_INIT" case. Overridable via the hook/component `timeoutMs` prop.
 */
export const DIRECT_LOAD_TIMEOUT_MS = 2000;

/** The Civitai host that serves the embedded block run route. */
export const CIVITAI_HOST = 'civitai.com';

/** The deployed-block origin suffix (`<slug>.civit.ai`). */
export const CIVIT_AI_SUFFIX = '.civit.ai';

/** A single DNS label (the slug), lowercased. */
const DNS_LABEL = /^[a-z0-9-]+$/;

/**
 * Derive the canonical Civitai host route for a block served from a
 * `<slug>.civit.ai` origin.
 *
 * - A deployed block host (`<slug>.civit.ai`) → `https://civitai.com/apps/run/<slug>`,
 *   where the slug is the FIRST DNS label of the hostname.
 * - Anything else — `localhost` (dev without the harness), an IP, a bare
 *   `civit.ai`, or a non-civit.ai host — → `null`. The caller MUST NOT render a
 *   `civitai.com/apps/run/…` redirect in that case (there is no meaningful
 *   target — never a broken `apps/run/localhost` link); show a neutral
 *   "waiting for the host" state instead.
 *
 * Case-insensitive (hostnames are), tolerant of a trailing FQDN dot.
 *
 * @example hostToRunUrl('model-benchmarking.civit.ai') // 'https://civitai.com/apps/run/model-benchmarking'
 * @example hostToRunUrl('localhost')                   // null
 * @example hostToRunUrl('civit.ai')                    // null
 */
export function hostToRunUrl(hostname: string | null | undefined): string | null {
  if (!hostname) return null;
  // Normalize: trim, lowercase, strip any trailing FQDN dot(s). The trailing-dot
  // strip is a manual linear trim rather than a `/\.+$/` regex, which backtracks
  // O(n^2) on a string of many dots (ReDoS — CodeQL js/polynomial-redos).
  const normalized = hostname.trim().toLowerCase();
  let end = normalized.length;
  while (end > 0 && normalized.charCodeAt(end - 1) === 46 /* '.' */) end -= 1;
  const host = normalized.slice(0, end);
  if (!host.endsWith(CIVIT_AI_SUFFIX)) return null; // not a deployed block host
  // The slug is the FIRST DNS label (`<slug>.civit.ai`). Extra labels beyond
  // the first are ignored — deployed block origins are single-label — but the
  // first label must be a valid, non-empty DNS label.
  const slug = host.slice(0, host.length - CIVIT_AI_SUFFIX.length).split('.')[0] ?? '';
  if (!slug || !DNS_LABEL.test(slug)) return null;
  return `https://${CIVITAI_HOST}/apps/run/${slug}`;
}
