// Browser tests: the app at phone size (light and dark) and desktop size, in Chromium.
const { defineConfig, devices } = require("@playwright/test");
const phone = { ...devices["iPhone 13"], browserName: "chromium", defaultBrowserType: "chromium" };
module.exports = defineConfig({
  testDir: "tests",
  testMatch: "*.spec.js",
  retries: 0,
  use: { baseURL: "http://localhost:4173", timezoneId: "Europe/London", locale: "en-GB", serviceWorkers: "block" },
  projects: [
    { name: "phone-light", use: { ...phone, colorScheme: "light" } },
    { name: "phone-dark", use: { ...phone, colorScheme: "dark" } },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 900 } } },
  ],
  webServer: { command: "node tests/serve.js 4173", url: "http://localhost:4173", reuseExistingServer: true },
});
