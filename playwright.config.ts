import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  outputDir: 'test-results/playwright-artifacts',
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: { timeout: 10_000 },
  use: {
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
