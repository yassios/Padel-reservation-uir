import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) },
  webServer: [
    { command: 'npm run test:server', url: 'http://127.0.0.1:3000/api/health', reuseExistingServer: false, timeout: 60_000 },
    { command: 'npm run dev --prefix frontend -- --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: false },
  ],
});
