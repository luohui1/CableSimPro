import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './e2e', timeout: 90000, expect: {timeout: 15000},
  fullyParallel: false, workers: 1, retries: 0,
  reporter: [['list'], ['html', {open: 'never'}], ['junit', {outputFile: 'test-results/browser-tests.xml'}]],
  use: {
    baseURL: 'http://127.0.0.1:8000', trace: 'retain-on-failure',
    screenshot: 'only-on-failure', video: 'off',
  },
  projects: [
    {name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 1000},
      launchOptions: {args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']}}},
    {name: 'webkit', use: {...devices['Desktop Safari'], viewport: {width: 1440, height: 1000}}},
    {name: 'mobile-webkit', use: {...devices['iPhone 13'], browserName: 'webkit'}},
  ],
  webServer: {
    command: 'python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',
    cwd: '..', url: 'http://127.0.0.1:8000/api/health', timeout: 60000,
    reuseExistingServer: !process.env.CI,
    env: {CABLESIM_DB: path.resolve(process.cwd(), '../.data/e2e.sqlite')},
  },
});
