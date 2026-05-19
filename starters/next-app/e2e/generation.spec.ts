import { expect, test } from './fixtures';

test.describe('Generation cost preview', () => {
  test('estimate (whatif=true) returns a non-negative Buzz cost', async ({ page, baseURL }) => {
    await page.goto(baseURL!);

    // Sign in to the starter if not already (resilient to running this spec
    // in isolation).
    const loginBtn = page.getByRole('button', { name: /sign in with civitai/i });
    if (await loginBtn.isVisible().catch(() => false)) {
      await Promise.all([
        page.waitForURL(/\/\?notice=connected|\/login\/oauth\/authorize/, { timeout: 30_000 }),
        loginBtn.click(),
      ]);
      if (page.url().includes('/login/oauth/authorize')) {
        const approveBtn = page
          .getByRole('button', { name: /^(allow|authorize|approve|continue)$/i })
          .first();
        await Promise.all([
          page.waitForURL(/\/\?notice=connected/, { timeout: 30_000 }),
          approveBtn.click(),
        ]);
      }
    }

    await expect(page.getByText(/signed in as/i)).toBeVisible();

    const previewBtn = page.getByRole('button', { name: /preview buzz cost/i });
    await expect(previewBtn).toBeEnabled();
    await previewBtn.click();

    const costLine = page.getByText(/this will cost\s+\d+\s+buzz/i);
    await expect(costLine).toBeVisible({ timeout: 30_000 });

    const text = (await costLine.textContent()) ?? '';
    const match = text.match(/this will cost\s+(\d+)\s+buzz/i);
    expect(match, `cost text didn't match expected shape: "${text}"`).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(0);
  });
});
