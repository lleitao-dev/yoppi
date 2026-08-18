import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: process.env.YOPPI_WEB_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
});
