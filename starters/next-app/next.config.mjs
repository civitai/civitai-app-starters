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
};

export default nextConfig;
