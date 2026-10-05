import { defineConfig, devices } from '@playwright/test';

const E2E_PORT = Number(process.env.E2E_PORT ?? 41731);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${E2E_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build:client && npx tsx e2e/server.ts',
    url: `http://localhost:${E2E_PORT}/api/v1/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
