import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Build-time-validated env for the Hono BFF. Misconfigured vars fail the
 * server boot with a single readable error listing every problem at once.
 * Keep in sync with `.env.example`.
 *
 * .env is bridged into `process.env` by:
 *   - dev:  vite.config.ts (loadEnv + Object.assign)
 *   - prod: `node --env-file=.env dist-server/index.js` (Node ≥20.6 built-in)
 *
 * Never import this from client (`src/`) code — these are server secrets.
 */
export const env = createEnv({
  server: {
    CIVITAI_CLIENT_ID: z.string().min(1),
    CIVITAI_CLIENT_SECRET: z.string().min(1),
    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET must be ≥32 chars. Generate with `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`.'),
    APP_URL: z.string().url(),
    CIVITAI_BASE_URL: z.string().url().default('https://civitai.com'),
    ORCHESTRATOR_URL: z.string().url().default('https://orchestration.civitai.com'),
    PORT: z.coerce.number().int().positive().default(5175),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  // CI runs `vite build` + `tsc -p tsconfig.server.json` without real env.
  // Setting SKIP_ENV_VALIDATION=1 in that path turns validation off so the
  // build is reproducible; production starts via `pnpm start` leave it unset
  // and fail fast on missing.
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});

export const REDIRECT_URI = `${env.APP_URL}/api/auth/callback/civitai`;
