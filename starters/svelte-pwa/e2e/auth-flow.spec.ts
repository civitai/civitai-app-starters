import { expect, signIn, test } from './fixtures';

test.describe('OAuth + session', () => {
  test('signs in via Civitai OAuth and shows balance', async ({ page, baseURL }) => {
    await page.goto(baseURL!);
    await expect(page.getByRole('heading', { name: /civitai app starter/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in with civitai/i })).toBeVisible();

    await signIn(page);

    await expect(page.getByText(/signed in as/i)).toBeVisible();
    await expect(page.getByText(/buzz balance/i)).toBeVisible();
    await expect(page.getByText(/granted scopes/i)).toBeVisible();
  });
});
