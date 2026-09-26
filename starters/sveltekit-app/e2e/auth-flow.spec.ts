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
    await expect(page.getByText(/granted scopes/i)).toBeVisible();

    // 🔴 ASSERT THE VALUE, NOT THE LABEL. This used to be
    // `getByText(/buzz balance/i)).toBeVisible()`, which passed for the whole
    // period the row read `Buzz balance: —` for every real user: the starters
    // sourced `balance` from `/api/v1/me`, which has never returned one. A test
    // titled "shows balance" that cannot tell a balance from its caption is
    // worse than no test, because it stops anyone looking.
    //
    // PRECONDITION: the consent above must grant `BuzzRead` (it is in
    // REQUESTED_SCOPES and in `.env.example`). Without it the row is absent by
    // design — that is the 403 path, covered by scenario D of
    // `starters/next-app/scripts/probe-expired-session.mjs`, and it would
    // legitimately fail here.
    await expect(page.getByText(/buzz balance:\s*[\d,]+/i)).toBeVisible();
  });
});
