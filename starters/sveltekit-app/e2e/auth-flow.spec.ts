import { expect, test } from './fixtures';

test.describe('OAuth + session', () => {
  test('signs in via Civitai OAuth and shows balance', async ({ page, baseURL }) => {
    await page.goto(baseURL!);
    await expect(page.getByRole('heading', { name: /civitai app starter/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with civitai/i })).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/\?notice=connected|\/login\/oauth\/authorize/, { timeout: 30_000 }),
      page.getByRole('button', { name: /sign in with civitai/i }).click(),
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

    await expect(page.getByText(/signed in as/i)).toBeVisible();
    await expect(page.getByText(/buzz balance/i)).toBeVisible();
    await expect(page.getByText(/granted scopes/i)).toBeVisible();
  });
});
