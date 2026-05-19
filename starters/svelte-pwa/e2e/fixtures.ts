import { expect, type Page } from '@playwright/test';

export { test, expect } from '@playwright/test';

/**
 * Click "Sign in with Civitai" and follow the OAuth dance to the connected
 * landing page. The Civitai consent screen only appears if the test user
 * hasn't approved this OAuth app yet.
 */
export async function signIn(page: Page) {
  const loginBtn = page.getByRole('button', { name: /sign in with civitai/i });
  await Promise.all([
    page.waitForURL(/\/\?notice=connected|\/login\/oauth\/authorize/, { timeout: 30_000 }),
    loginBtn.click(),
  ]);

  if (page.url().includes('/login/oauth/authorize')) {
    const approveBtn = page
      .getByRole('button', { name: /^(allow|authorize|approve|continue)$/i })
      .first();
    await expect(approveBtn).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/\?notice=connected/, { timeout: 30_000 }),
      approveBtn.click(),
    ]);
  }
}
