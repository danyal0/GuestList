import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a production build of the web app proxying to the
 * live API. Both servers are booted automatically unless already running.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: [
    {
      command: 'npm run start --workspace apps/api',
      url: 'http://localhost:4000/api/v1/health',
      reuseExistingServer: true,
      cwd: '../..',
      timeout: 60_000,
    },
    {
      command: 'npm run start --workspace apps/web',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      cwd: '../..',
      timeout: 60_000,
    },
  ],
});
