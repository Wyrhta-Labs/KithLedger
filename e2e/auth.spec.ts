import { test, expect } from './fixtures.js';

/**
 * The other specs seed the JWT directly to stay inside the auth rate limit
 * (10 requests per window), so the login form is exercised here — once.
 */
test.describe('Login', () => {
  test('signs in with the admin password and lands on the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#password')).toBeVisible();

    await page.fill('#password', process.env['ADMIN_PASSWORD']!);
    await page.click('button[type="submit"]');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('kith_jwt'))).toBeTruthy();
  });

  test('rejects a wrong password without storing a token', async ({ page }) => {
    await page.goto('/');
    await page.fill('#password', 'definitely-not-the-password');
    await page.click('button[type="submit"]');

    await expect(page.getByText(/invalid password/i)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('kith_jwt'))).toBeNull();
  });
});
