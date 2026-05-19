import { defineConfig, devices } from '@playwright/test';
import { STORAGE_STATE_PATH } from './e2e/global-setup';

/**
 * The e2e suite exercises the full OAuth flow against a real Civitai dev
 * server. A globalSetup signs the test user in via the `testing-login`
 * NextAuth credentials provider (dev/test only on Civitai's side) and saves
 * the resulting browser storage state to disk. Specs load it via
 * `use.storageState` and start their tests already signed in to Civitai.
 *
 * Prereqs (the suite fails loudly if missing):
 *   - CIVITAI_BASE_URL — your local Civitai (or a TLS host you control).
 *   - APP_URL          — where this Next starter is reachable.
 *   - OAuth app registered on that Civitai instance, with APP_URL/api/auth/callback/civitai
 *     as a registered redirect URI. Set the app's id/secret in .env.
 *   - Civitai dev server running (`pnpm dev` in the `civitai/civitai` repo).
 *   - This starter's dev server running (`pnpm dev`) — Playwright won't boot
 *     it for you because you may want to test against a deployed build too.
 *
 * Defaults pick TEST_USER_ID=1 unless you override.
 */

const APP_URL = process.env.APP_URL;
if (!APP_URL) {
  throw new Error(
    'APP_URL is required for e2e (e.g. http://localhost:3333). See playwright.config.ts header.',
  );
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // Sequential — the OAuth consent record is shared user state.
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    storageState: STORAGE_STATE_PATH,
    // Accept self-signed certs on local Civitai dev hosts (e.g. civitai-dev.blue).
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
