import { expect, signIn, test } from './fixtures';

test.describe('Generation cost preview', () => {
  test('estimate (whatif=true) returns a non-negative Buzz cost', async ({ page, baseURL }) => {
    await page.goto(baseURL!);

    // Sign in only if storage state didn't carry a session.
    const loginBtn = page.getByRole('button', { name: /sign in with civitai/i });
    if (await loginBtn.isVisible().catch(() => false)) {
      await signIn(page);
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
