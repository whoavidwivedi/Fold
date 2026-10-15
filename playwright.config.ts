import { defineConfig, devices } from "@playwright/test"

/**
 * Browser smoke tests.
 *
 * These exist because curl could not catch four of the five bugs in the first session:
 * missing CORS, orval emitting relative URLs, a poisoned token cache, and a session with
 * no active workspace. Every one of them passed every command-line check and failed in a
 * real browser. See docs/adr/0008.
 *
 * They run against a live stack — Postgres, Go on :8080, Next on :3000 — so they are
 * closer to an integration test than a unit test. That is the point.
 */
export default defineConfig({
  testDir: "./tests",
  // Serial on purpose. These hit one shared database and one shared dev server, so
  // parallel workers would race on workspaces and ports.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})