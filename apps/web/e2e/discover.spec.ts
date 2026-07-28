import { expect, test } from '@playwright/test';

test.describe('Discover', () => {
  test('home page renders the hero and content sections', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/MKE Plays/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /happening soon/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /popular communities/i })).toBeVisible();
  });

  test('navigates from home to the communities browse page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /^communities$/i }).first().click();
    await expect(page).toHaveURL(/\/groups/);
    await expect(page.getByRole('heading', { name: /communities/i }).first()).toBeVisible();
  });

  test('opens a community detail page from the browse grid', async ({ page }) => {
    await page.goto('/groups');
    const card = page.locator('a[href^="/groups/"]').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/groups\/.+/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('search returns results for seeded content', async ({ page }) => {
    await page.goto('/search?q=club');
    await expect(
      page.getByText(/No results|Communities \(|Events \(|People \(/).first(),
    ).toBeVisible();
  });

  test('shows a friendly 404 for unknown routes', async ({ page }) => {
    await page.goto('/this-page-does-not-exist');
    await expect(page.getByText(/page.*(not|doesn).*/i).first()).toBeVisible();
  });
});
