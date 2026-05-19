import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE_PATH } from './e2e/global-setup';

/**
 * E2e suite — exercises the full OAuth flow against a real Civitai dev server.
 * See e2e/global-setup.ts for how the test user is signed in.
 *
 * Prereqs:
 *   - CIVITAI_BASE_URL — your local Civitai (or a TLS host you control).
 *   - APP_URL          — where this Svelte PWA starter is reachable (default 5175).
 *   - OAuth app registered with APP_URL/api/auth/callback/civitai redirect.
 *   - Civitai dev server running.
 *   - This starter's `pnpm dev` running.
 *   - For self-signed certs, NODE_TLS_REJECT_UNAUTHORIZED=0.
 */

const APP_URL = process.env.APP_URL;
if (!APP_URL) {
  throw new Error(
    'APP_URL is required for e2e (e.g. http://localhost:5175). See playwright.config.ts header.',
  );
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: STORAGE_STATE_PATH,
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
