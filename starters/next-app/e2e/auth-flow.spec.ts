import { expect, test } from './fixtures';

test.describe('OAuth + session', () => {
  test('signs in via Civitai OAuth and shows balance', async ({ page, baseURL }) => {
    // The browser context already has Civitai session cookies (set by
    // global-setup.ts). The starter itself is still logged-out from its
    // own POV — the Civitai session just lets us skip the
    // username/password step at the consent screen.

    await page.goto(baseURL!);
    await expect(page.getByRole('heading', { name: /civitai app starter/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with civitai/i })).toBeVisible();

    // Kick off OAuth. BFF 303s to Civitai authorize. Either:
    //   - Lands on the consent page (first time) — we click Approve, OR
    //   - Skips consent and redirects straight back to the starter.
    await Promise.all([
      page.waitForURL(/\/\?notice=connected|\/login\/oauth\/authorize/, { timeout: 30_000 }),
      page.getByRole('button', { name: /sign in with civitai/i }).click(),
    ]);

    if (page.url().includes('/login/oauth/authorize')) {
      const approveBtn = page
        .getByRole('button', { name: /^(allow|authorize|approve|continue)$/i })
        .first();
      await expect(
        approveBtn,
        'expected an Approve/Allow/Authorize/Continue button on /login/oauth/authorize',
      ).toBeVisible();
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
