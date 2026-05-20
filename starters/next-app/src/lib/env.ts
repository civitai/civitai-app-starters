import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Build-time-validated env. Misconfigured vars fail the `next build` (and the
 * first dev render) with a single readable error listing every problem at
 * once. Keep in sync with `.env.example`.
 *
 * `client` block: vars must be `NEXT_PUBLIC_`-prefixed and are bundled into
 * the browser. `server` block: server-only, never reach the client.
 */
export const env = createEnv({
  server: {
    CIVITAI_CLIENT_ID: z.string().min(1),
    CIVITAI_CLIENT_SECRET: z.string().min(1),
    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET must be ≥32 chars. Generate with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`.'),
    CIVITAI_BASE_URL: z.string().url().default('https://civitai.com'),
    ORCHESTRATOR_URL: z.string().url().default('https://orchestration.civitai.com'),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },
  runtimeEnv: {
    CIVITAI_CLIENT_ID: process.env.CIVITAI_CLIENT_ID,
    CIVITAI_CLIENT_SECRET: process.env.CIVITAI_CLIENT_SECRET,
    SESSION_SECRET: process.env.SESSION_SECRET,
    CIVITAI_BASE_URL: process.env.CIVITAI_BASE_URL,
    ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
  // CI runs `next build` without real env. Setting SKIP_ENV_VALIDATION=1 in
  // that path turns validation off so the build is reproducible; production
  // deploys (Vercel, Render, etc.) leave it unset and fail fast on missing.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

export const REDIRECT_URI = `${env.NEXT_PUBLIC_APP_URL}/api/auth/callback/civitai`;
