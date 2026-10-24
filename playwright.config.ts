import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  outputDir: "./artifacts/browser-test-results",
  reporter: "list",
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/auth",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_public_only",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_public_only",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
