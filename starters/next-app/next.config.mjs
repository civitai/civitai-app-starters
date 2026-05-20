/**
 * Security headers applied to every response.
 *
 * `'unsafe-inline'` + `'unsafe-eval'` in `script-src` are kept because Next's
 * hydration script is inline and React DevTools / HMR want eval. The
 * production-hardened path is a CSP **nonce** wired through middleware — see
 * https://nextjs.org/docs/app/guides/content-security-policy. Worth the
 * upgrade once your app stops iterating quickly.
 *
 * `frame-ancestors 'none'` + `X-Frame-Options: DENY` together kill
 * clickjacking. `Referrer-Policy: strict-origin-when-cross-origin` keeps the
 * OAuth `code=` query param out of cross-origin Referer headers.
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

/** Read CIVITAI_BASE_URL / ORCHESTRATOR_URL at config-load and fold their
 * origins into the CSP allow-list. Lets the starter point at a self-hosted
 * Civitai dev (e.g. https://civitai-dev.blue) without users having to edit
 * CSP by hand. */
function originOrNull(url) {
  try { return new URL(url).origin; } catch { return null; }
}

const CIVITAI_HOSTS = Array.from(
  new Set(
    [
      ...CIVITAI_HOSTS_BASE,
      originOrNull(process.env.CIVITAI_BASE_URL),
      originOrNull(process.env.ORCHESTRATOR_URL),
    ].filter(Boolean),
  ),
);

const csp = [
  `default-src 'self'`,
  `img-src 'self' data: blob: ${CIVITAI_HOSTS.join(' ')}`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  `font-src 'self' data:`,
  `connect-src 'self' ${CIVITAI_HOSTS.join(' ')}`,
  `frame-ancestors 'none'`,
  `base-uri 'self'`,
  `form-action 'self' ${CIVITAI_HOSTS.join(' ')}`,
  `object-src 'none'`,
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @civitai/app-sdk is a workspace package shipping uncompiled-style ESM.
  // Telling Next to transpile it keeps source-maps and lets us iterate
  // without a separate publish cycle during local development.
  transpilePackages: ['@civitai/app-sdk'],
  images: {
    // The orchestrator returns blob URLs on its CDN. Allow them as image sources.
    remotePatterns: [
      { protocol: 'https', hostname: '*.civitai.com' },
      { protocol: 'https', hostname: '*.civitai.red' },
      { protocol: 'https', hostname: 'image.civitai.com' },
      { protocol: 'https', hostname: 'orchestration.civitai.com' },
      { protocol: 'https', hostname: 'orchestration-new.civitai.com' },
    ],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
};

export default nextConfig;
