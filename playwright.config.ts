import { defineConfig } from "@playwright/test";

// RECORD=1 replays the demo slowly and saves a 1440×900 video as a stage backup.
const record = process.env.RECORD === "1";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: { timeout: record ? 30_000 : 10_000 },
  timeout: record ? 600_000 : 30_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    browserName: "chromium",
    actionTimeout: record ? 30_000 : 10_000,
    ...(record && {
      video: { mode: "on" as const, size: { width: 1440, height: 900 } },
      launchOptions: { slowMo: Number(process.env.SLOWMO ?? 700) },
    }),
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: "**/mobile-cosign.spec.ts" },
    {
      name: "mobile",
      testMatch: "**/mobile-cosign.spec.ts",
      use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
    },
  ],
});
