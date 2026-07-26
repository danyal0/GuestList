import { expect, test } from '@playwright/test';

const PASSWORD = 'E2ePassw0rd!';

test.describe('Authentication', () => {
  test('signs up a new user and lands signed in', async ({ page }) => {
    const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.dev`;

    await page.goto('/signup');
    await page.getByLabel(/name/i).fill('E2E Tester');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /create account|join/i }).click();

    // Redirected home with an authenticated shell (avatar menu present).
    await page.waitForURL('/');
    await expect(page.getByRole('button', { name: /account menu|open menu|profile/i }).or(
      page.locator('header').getByRole('img'),
    ).first()).toBeVisible({ timeout: 10_000 });
  });

  test('rejects invalid credentials with a visible error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('nobody@test.dev');
    await page.getByLabel(/password/i).fill('WrongPassw0rd!');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test('client-side validation blocks weak passwords on signup', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel(/name/i).fill('Weak Password');
    await page.getByLabel(/email/i).fill('weak@test.dev');
    await page.getByLabel(/password/i).fill('short');
    await page.getByRole('button', { name: /create account|join/i }).click();
    // The password field is flagged invalid with a visible validation message.
    await expect(page.getByLabel(/password/i)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: /character|number|letter/i })).toBeVisible();
  });

  test('protected pages prompt for sign-in', async ({ page }) => {
    await page.goto('/messages');
    await expect(page.getByText(/sign in to see your messages/i)).toBeVisible();
  });
});
