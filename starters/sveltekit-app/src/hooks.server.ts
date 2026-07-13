import { dev } from '$app/environment';
import { config } from '$lib/env';
import { readSession } from '$lib/session';
import type { Handle } from '@sveltejs/kit';

/**
 * Security headers applied to every response. The production hardening path
 * is a CSP nonce wired into SvelteKit's `transformPageChunk` — see
 * https://svelte.dev/docs/kit/configuration#csp. The static policy here is
 * deliberately conservative-but-not-strict so HMR keeps working in dev.
 */
const CIVITAI_HOSTS_BASE = [
  'https://civitai.com',
  'https://*.civitai.com',
  'https://civitai.red',
  'https://*.civitai.red',
  'https://orchestration.civitai.com',
  'https://orchestration-new.civitai.com',
  'https://image.civitai.com',
];

/** Fold the configured CIVITAI_AUTH_URL / CIVITAI_BASE_URL / ORCHESTRATOR_URL
 * origins into the CSP allow-list so a self-hosted Civitai dev (e.g.
 * https://civitai-dev.blue) works without users hand-editing CSP. */
function originOrNull(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}

const CIVITAI_HOSTS = Array.from(
  new Set(
    [
      ...CIVITAI_HOSTS_BASE,
      originOrNull(config.CIVITAI_AUTH_URL),
      originOrNull(config.CIVITAI_BASE_URL),
      originOrNull(config.ORCHESTRATOR_URL),
    ].filter((host): host is string => Boolean(host)),
  ),
);

const csp = [
  `default-src 'self'`,
  `img-src 'self' data: blob: ${CIVITAI_HOSTS.join(' ')}`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `font-src 'self' data:`,
  `connect-src 'self' ws: ${CIVITAI_HOSTS.join(' ')}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self' ${CIVITAI_HOSTS.join(' ')}`,
  `object-src 'none'`,
].join('; ');

const SECURITY_HEADERS: Array<[string, string]> = [
  ['Content-Security-Policy', csp],
  ['X-Frame-Options', 'DENY'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
];

/**
 * Populate `event.locals.session` for every request. `+page.server.ts` /
 * `+server.ts` handlers should read this instead of reaching for cookies.
 */
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.session = await readSession(event.cookies, !dev);
  const response = await resolve(event);
  for (const [name, value] of SECURITY_HEADERS) response.headers.set(name, value);
  return response;
};
