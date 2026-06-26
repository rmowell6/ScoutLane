import { defineConfig, devices } from '@playwright/test'

// E2E happy-path tests (Engineering Plan §8/§11). Next.js recommends E2E for async
// Server Components. Specs live in tests/ as *.spec.ts (Vitest owns *.test.ts).
const PORT = 3000
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use a pre-installed Chromium when provided (sandboxes that ship browsers at a
        // different revision than this Playwright pins). Unset in CI -> managed browser.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined },
      },
    },
  ],
  // Build once, then serve the production bundle — mirrors what Vercel runs.
  webServer: {
    command: 'npm run build && npm run start',
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
})
