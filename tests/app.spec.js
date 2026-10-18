// Clicks through the app in a real browser. Claude is faked, so these runs cost nothing.
const { test, expect } = require("@playwright/test");
const path = require("path");

const fixtures = ["tracker.csv", "expenses.csv"].map(f => path.join(__dirname, "fixtures", f));
const analysis = {
  summary: "A steady week with one good sale.",
  actions: ["Drop the New Balance 550 by 10%", "Relist the Paldean Fates bundle on eBay", "Add a cost for the Stone Island overshirt"],
  stale: [{ name: "New Balance 550", call: "DROP PRICE", advice: "Try 10% lower on Vinted." }],
  drops: [{ name: "Test Pokémon set", when: "November", rating: "HIGH", why: "Test reason." }],
  niches: [{ name: "Test niche", buy: "£10", sell: "£30", rating: "MEDIUM", why: "Test why.", test: "Buy 3." }],
  records: ["Keep receipts for packaging."],
};

const visible = (page, sel) => page.locator(sel).filter({ visible: true }).first();

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|status of 502/.test(m.text())) page.errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+01:00"));
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

test("every screen opens", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#taxyr")).toHaveText("UK tax year 2026/27");
  await expect(page.locator("#home")).toBeVisible();
  for (const tab of ["list", "reply", "hist", "help", "home"]) {
    await visible(page, `nav.menu button[data-tab="${tab}"]`).click();
    await expect(page.locator("#" + tab)).toBeVisible();
  }
  await visible(page, '[data-go="set"]').click();
  await expect(page.locator("#set")).toBeVisible();
  // Nothing should stick out sideways on a phone.
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});

test("weekly check from CSV files with Claude's advice", async ({ page }) => {
  let sent;
  await page.route("**/api/claude", async route => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { text: JSON.stringify(analysis), truncated: false } });
  });
  await page.goto("/");
  await visible(page, '[data-go="set"]').click();
  await page.fill("#sPw", "test-password");
  await page.click('#setForm button[type="submit"]');
  await expect(page.locator("#setMsg")).toHaveText("Saved.");
  await visible(page, 'nav.menu button[data-tab="home"]').click();

  await page.setInputFiles("#csvIn", fixtures);
  await expect(page.locator("#status")).toContainText("2 CSV files ready");
  await page.click("#runBtn");
  await expect(page.locator("#status")).toContainText("Done. Report saved", { timeout: 15000 });

  expect(sent.webSearch).toBe(true);
  const report = page.locator("#report");
  await expect(report.locator(".tile").nth(0)).toContainText("£25.50"); // profit this tax year
  await expect(report.locator(".tile").nth(1)).toContainText("£23.00"); // last 7 days
  await expect(report.locator(".tile").nth(2)).toContainText("£130.00"); // stock at cost
  await expect(report.locator(".tile").nth(3)).toContainText("2"); // stale items
  await expect(report).toContainText("Paldean Fates booster bundle");
  await expect(report).toContainText("Try 10% lower on Vinted.");
  await expect(report).toContainText("A steady week with one good sale.");
  await expect(page.locator('#steps li[data-s="done"]')).toHaveCount(4);

  // The report is saved and shows in History.
  await visible(page, 'nav.menu button[data-tab="hist"]').click();
  await expect(page.locator("#histList button")).toHaveCount(1);
  await expect(page.locator("#histList")).toContainText("7-day profit £23.00");
});

test("clear message when Claude rejects the web search tool", async ({ page }) => {
  await page.route("**/api/claude", route => route.fulfill({
    status: 502,
    json: { error: { code: "search_tool_rejected", message: "tools.0: Input tag 'web_search_20260209' does not match" } },
  }));
  await page.goto("/");
  await page.setInputFiles("#csvIn", fixtures);
  await page.click("#runBtn");
  const status = page.locator("#status");
  await expect(status).toContainText("rejected the web search tool (version web_search_20260209)");
  await expect(status).toContainText("send this message to Claude Code");
  await expect(status).toHaveClass(/err/);
  // The numbers still show without Claude.
  await expect(page.locator("#report .tile").nth(0)).toContainText("£25.50");
});

test("listing writer and reply drafter talk to Claude", async ({ page }) => {
  const asks = [];
  await page.route("**/api/claude", async route => {
    asks.push(route.request().postDataJSON());
    await route.fulfill({ json: { text: "Hi! Yes, £45 works.\n\nNote: above your floor.", truncated: false } });
  });
  await page.goto("/");
  await visible(page, 'nav.menu button[data-tab="list"]').click();
  await page.fill("#listNotes", "Nike Dunk Low, UK 9, worn twice");
  await page.click("#listBtn");
  await expect(page.locator("#listOut")).toContainText("£45 works");
  await expect(page.locator("#listCopy")).toBeVisible();

  await visible(page, 'nav.menu button[data-tab="reply"]').click();
  await page.fill("#rMsg", "Would you take £45?");
  await page.fill("#rPrice", "50");
  await page.click("#rBtn");
  await expect(page.locator("#rOut")).toContainText("£45 works");
  expect(asks.map(a => a.tier)).toEqual(["default", "quick"]);
  expect(asks.every(a => !a.webSearch)).toBe(true);
});
