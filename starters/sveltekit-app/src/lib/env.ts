import { createEnv } from '@t3-oss/env-core';
import { env as runtimeEnv } from '$env/dynamic/private';
import { z } from 'zod';

/**
 * Build-time-validated env. Misconfigured vars fail the first request (or
 * the `vite build`) with a single readable error listing every problem at
 * once. Keep in sync with `.env.example`.
 *
 * SvelteKit's `$env/dynamic/private` reads server-only env at request time,
 * so this module is safe to import from `hooks.server.ts`, `+page.server.ts`,
 * and `+server.ts` — never from client code.
 */
export const config = createEnv({
  server: {
    CIVITAI_CLIENT_ID: z.string().min(1),
    CIVITAI_CLIENT_SECRET: z.string().min(1),
    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET must be ≥32 chars. Generate with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`.'),
    APP_URL: z.string().url(),
    CIVITAI_BASE_URL: z.string().url().default('https://civitai.com'),
    ORCHESTRATOR_URL: z.string().url().default('https://orchestration.civitai.com'),
  },
  runtimeEnv,
  emptyStringAsUndefined: true,
  // CI runs `vite build` without real env. Setting SKIP_ENV_VALIDATION=1 in
  // that path turns validation off so the build is reproducible; production
  // deploys leave it unset and fail fast on missing.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

export const REDIRECT_URI = `${config.APP_URL}/api/auth/callback/civitai`;
