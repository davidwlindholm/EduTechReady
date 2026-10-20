import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL runs the suite against another server, e.g. the unzipped
// upload package (see README.md, "Testing the package"). That server must
// already be running; Playwright starts the dev server only for the default.
const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const baseURL = process.env.E2E_BASE_URL || DEFAULT_BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  // One worker: parallel SwiftShader contexts starve each other and flake on the 30 s timeout.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run serve',
    url: `${DEFAULT_BASE_URL}/index.html`,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } },
    },
  ],
});
