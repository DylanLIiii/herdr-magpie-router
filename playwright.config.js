import { defineConfig } from '@playwright/test';

// An installed Herdr bridge may already own 4317. Always test this checkout.
const port = 44117;
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `PORT=${port} npm start`,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
