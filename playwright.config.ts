import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 8099);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  outputDir: "test-results/playwright/artifacts",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/playwright/results.json" }],
    ["html", { outputFolder: "test-results/playwright/html", open: "never" }],
  ],
  use: {
    baseURL,
    actionTimeout: 20_000,
    navigationTimeout: 120_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: `node scripts/serve-dist.mjs ${port}`,
    url: baseURL,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "smoke-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "ui-360-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 780 },
      },
    },
    {
      name: "ui-390-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "ui-412-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 412, height: 915 },
      },
    },
    {
      name: "ui-768-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "ui-1024-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1024, height: 900 },
      },
    },
    {
      name: "ui-1440-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "ui-webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 412, height: 915 },
      },
    },
    {
      name: "ui-firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 768, height: 1024 },
      },
    },
  ],
});
