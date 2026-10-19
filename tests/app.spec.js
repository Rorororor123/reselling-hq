// Clicks through the app in a real browser. Claude is faked, so these runs cost nothing.
const { test, expect } = require("@playwright/test");
const path = require("path");
const { useFakeSupabase, STORAGE_KEY } = require("./fake-supabase");

// The old tracker's rows, as they'd be in the app after bringing it in.
const RHQ = require("../js/core.js");
const fs = require("fs");
const tracker = RHQ.parseImport(["tracker.csv", "expenses.csv"].map(f => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8")));
const seed = { items: tracker.items, expenses: tracker.expenses };
const analysis = {
  summary: "A steady week with one good sale.",
  actions: ["Drop the New Balance 550 by 10%", "Relist the Paldean Fates bundle on eBay", "Add a cost for the Stone Island overshirt"],
  stale: [{ name: "New Balance 550", call: "DROP PRICE", advice: "Try 10% lower on Vinted." }],
  drops: [{ name: "Test Pokémon set", when: "November", rating: "HIGH", why: "Test reason." }],
  niches: [{ name: "Test niche", buy: "£10", sell: "£30", rating: "MEDIUM", why: "Test why.", test: "Buy 3." }],
  records: ["Keep receipts for packaging."],
};

const visible = (page, sel) => page.locator(sel).filter({ visible: true }).first();
// Opens a screen the way a person would: the sidebar on a computer, the tab bar (or More) on a phone.
async function openTab(page, tab, filter) {
  const sel = `[data-tab="${tab}"]` + (filter ? `[data-filter="${filter}"]` : ":not([data-filter])");
  const direct = page.locator(`nav.menu ${sel}, nav.tabbar ${sel}, .mobilebar ${sel}, .railfoot ${sel}`).filter({ visible: true });
  if (await direct.count()) await direct.first().click();
  else { await page.click('nav.tabbar [data-sheet="moreSheet"]'); await page.click(`#moreSheet ${sel}`); }
  await expect(page.locator("#" + tab)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|status of (400|401|403|502|503)/.test(m.text())) page.errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+01:00"));
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

test("every screen opens", async ({ page }) => {
  await useFakeSupabase(page);
  await page.goto("/");
  await expect(page.locator("#taxyr")).toHaveText("UK tax year 2026/27");
  await expect(page.locator("#dash")).toBeVisible();
  for (const tab of ["orders", "inv", "sales", "exp", "check", "list", "reply", "hist", "help", "set", "dash"]) {
    await openTab(page, tab);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(wide, tab + " sticks out sideways").toBe(false);
  }
  await openTab(page, "orders", "preorders");
  await expect(page.locator('#ordFilters [aria-pressed="true"]')).toContainText("Pre-orders");
  // Nothing should stick out sideways on a phone.
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});

test("weekly check from the built-in tracker with Claude's advice", async ({ page }) => {
  let sent, auth;
  const store = await useFakeSupabase(page, { seed });
  await page.route("**/api/claude", async route => {
    sent = route.request().postDataJSON();
    auth = route.request().headers().authorization;
    await route.fulfill({ json: { text: JSON.stringify(analysis), truncated: false } });
  });
  await page.goto("/");

  await openTab(page, "check");
  await expect(page.locator("#csvIn")).toHaveCount(0); // no more Google Sheet or CSV files
  await page.click("#runBtn");
  await expect(page.locator("#status")).toContainText("Done. Report saved", { timeout: 15000 });

  expect(sent.webSearch).toBe(true);
  expect(auth).toMatch(/^Bearer ey/); // sent as the signed-in person, no app password
  const report = page.locator("#report");
  await expect(report.locator(".tile").nth(0)).toContainText("£25.50"); // profit this tax year
  await expect(report.locator(".tile").nth(1)).toContainText("£23.00"); // last 7 days
  await expect(report.locator(".tile").nth(2)).toContainText("£130.00"); // stock at cost
  await expect(report.locator(".tile").nth(3)).toContainText("2"); // stale items
  await expect(report).toContainText("Paldean Fates booster bundle");
  await expect(report).toContainText("Try 10% lower on Vinted.");
  await expect(report).toContainText("A steady week with one good sale.");
  await expect(page.locator('#steps li[data-s="done"]')).toHaveCount(4);

  // Same numbers as the old Google Sheet gave (see tests/stock-sales.test.js).
  await expect(report).toContainText("Reselling HQ ·");
  await expect(page.locator("#c-stock")).toHaveClass(/ok/);
  // The report is saved and shows in History.
  await openTab(page, "hist");
  await expect(page.locator("#histList button")).toHaveCount(1);
  await expect(page.locator("#histList")).toContainText("7-day profit £23.00");
  // ...and it's saved in the account, not the browser.
  expect(store.reports).toHaveLength(1);
  expect(store.reports[0].data.nums.week.profit).toBe(23);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("rhq-")))).toEqual([]);
});

test("clear message when Claude rejects the web search tool", async ({ page }) => {
  await useFakeSupabase(page, { seed });
  await page.route("**/api/claude", route => route.fulfill({
    status: 502,
    json: { error: { code: "search_tool_rejected", message: "tools.0: Input tag 'web_search_20260209' does not match" } },
  }));
  await page.goto("/");
  await openTab(page, "check");
  await page.click("#runBtn");
  const status = page.locator("#status");
  await expect(status).toContainText("rejected the web search tool (version web_search_20260209)");
  await expect(status).toContainText("send this message to Claude Code");
  await expect(status).toHaveClass(/err/);
  // The numbers still show without Claude.
  await expect(page.locator("#report .tile").nth(0)).toContainText("£25.50");
});

test("weekly check says what to do when there's nothing in the tracker", async ({ page }) => {
  await useFakeSupabase(page);
  await page.goto("/");
  await openTab(page, "check");
  await page.click("#runBtn");
  await expect(page.locator("#status")).toContainText("There's no stock or sales in the app yet");
  await expect(page.locator("#status")).toHaveClass(/err/);
});

test("listing writer and reply drafter talk to Claude", async ({ page }) => {
  await useFakeSupabase(page);
  const asks = [];
  await page.route("**/api/claude", async route => {
    asks.push(route.request().postDataJSON());
    await route.fulfill({ json: { text: "Hi! Yes, £45 works.\n\nNote: above your floor.", truncated: false } });
  });
  await page.goto("/");
  await openTab(page, "list");
  await page.fill("#listNotes", "Nike Dunk Low, UK 9, worn twice");
  await page.click("#listBtn");
  await expect(page.locator("#listOut")).toContainText("£45 works");
  await expect(page.locator("#listCopy")).toBeVisible();

  await openTab(page, "reply");
  await page.fill("#rMsg", "Would you take £45?");
  await page.fill("#rPrice", "50");
  await page.click("#rBtn");
  await expect(page.locator("#rOut")).toContainText("£45 works");
  expect(asks.map(a => a.tier)).toEqual(["default", "quick"]);
  expect(asks.every(a => !a.webSearch)).toBe(true);
});

/* ---------- accounts ---------- */

test("signed out: only the sign-in screen shows", async ({ page }) => {
  await useFakeSupabase(page, { signedInAs: null });
  await page.goto("/");
  await expect(page.locator("#gate h2")).toHaveText("Sign in");
  await expect(page.locator(".shell")).toBeHidden();
  await expect(page.locator("#gLinkBtn")).toBeVisible();
  await expect(page.locator("#gPwForm")).toBeHidden();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});

test("sign in with an email link code", async ({ page }) => {
  const store = await useFakeSupabase(page, { signedInAs: null });
  await page.goto("/");
  await page.fill("#gEmail", " Me@Example.com ");
  await page.click("#gLinkBtn");
  await expect(page.locator("#gSentTo")).toHaveText("me@example.com");
  expect(store.otpSentTo[0].email).toBe("me@example.com");
  expect(store.otpSentTo[0].redirect).toBe("http://localhost:4173/"); // back to this same site
  await page.fill("#gCode", "000000");
  await page.click("#gCodeBtn");
  await expect(page.locator("#gateMsg")).toContainText("didn't work or has expired");
  await page.fill("#gCode", "123456");
  await page.click("#gCodeBtn");
  await expect(page.locator("#dash")).toBeVisible();
  await expect(page.locator("#gate")).toBeHidden();
  await expect(page.locator("#c-drive")).toHaveClass(/ok/);
  await openTab(page, "set");
  await expect(page.locator("#accEmail")).toHaveText("me@example.com");
});

test("an email that isn't invited is turned away", async ({ page }) => {
  const store = await useFakeSupabase(page, { signedInAs: null });
  await page.goto("/");
  await page.fill("#gEmail", "stranger@example.com");
  await page.click("#gLinkBtn");
  await expect(page.locator("#gateMsg")).toHaveText("Reselling HQ is private for now, so this email can't sign in.");
  await expect(page.locator(".shell")).toBeHidden();
  expect(store.otpSentTo).toEqual([]);
});

test("sign in with a password", async ({ page }) => {
  await useFakeSupabase(page, { signedInAs: null });
  await page.goto("/");
  await page.click("#gUsePw");
  await page.fill("#gEmail", "me@example.com");
  await page.fill("#gPw", "wrong");
  await page.click("#gPwBtn");
  await expect(page.locator("#gateMsg")).toContainText("don't match");
  await page.fill("#gPw", "correct-horse");
  await page.click("#gPwBtn");
  await expect(page.locator("#dash")).toBeVisible();
});

test("settings are saved in the account and come back after a reload", async ({ page }) => {
  const store = await useFakeSupabase(page);
  await page.goto("/");
  await openTab(page, "set");
  await page.fill("#sBudget", "350");
  await page.fill("#sStale", "45");
  await page.click('#setForm button[type="submit"]');
  await expect(page.locator("#setMsg")).toHaveText("Saved.");
  expect(store.settings[0].data).toMatchObject({ budget: 350, stale: 45 });
  // A fresh device: nothing in the browser except the sign-in.
  await page.evaluate(k => { for (const x of Object.keys(localStorage)) if (x !== k) localStorage.removeItem(x); }, STORAGE_KEY);
  await page.reload();
  await openTab(page, "set");
  await expect(page.locator("#sBudget")).toHaveValue("350");
  await expect(page.locator("#sStale")).toHaveValue("45");
});

test("old settings and reports on this device can be moved into the account", async ({ page }) => {
  const store = await useFakeSupabase(page);
  const old = { kind: "report", ts: Date.parse("2026-10-11T09:00:00Z"), nums: { week: { profit: 12 }, ty: { sales: 100, cogs: 50, fees: 5, post: 5, expenses: 0 }, counts: { stale: 1 } }, ai: null };
  await page.addInitScript(o => {
    if (sessionStorage.getItem("planted")) return;
    sessionStorage.setItem("planted", "1");
    localStorage.setItem("rhq-settings", JSON.stringify({ budget: 999, inv: "https://docs.google.com/spreadsheets/d/e/x/pub?output=csv" }));
    localStorage.setItem("rhq-pw", "old-password");
    localStorage.setItem("rhq-setup", JSON.stringify({ "c-sheet": true }));
    localStorage.setItem("rhq-data/users/me", JSON.stringify({ r1760173200000: o }));
  }, old);
  await page.goto("/");
  await expect(page.locator("#moveCard")).toBeVisible();
  await expect(page.locator("#moveWhat")).toHaveText("your settings and 1 past report");
  await page.click("#moveYes");
  await expect(page.locator("#moveCard")).toBeHidden();
  await expect(page.locator("#dash")).toBeVisible();
  expect(store.settings[0].data).toMatchObject({ budget: 999, setup: { "c-sheet": true } });
  expect(store.reports.map(r => r.id)).toEqual(["r1760173200000"]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("rhq-")))).toEqual([]); // old password gone too
  await openTab(page, "set");
  await expect(page.locator("#sBudget")).toHaveValue("999");
  await openTab(page, "hist");
  await expect(page.locator("#histList")).toContainText("7-day profit £12.00");
});

test("download my data", async ({ page }) => {
  const store = await useFakeSupabase(page);
  store.settings.push({ user_id: "user-1", data: { budget: 123 } });
  await page.goto("/");
  await openTab(page, "set");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#accDownload")]);
  expect(download.suggestedFilename()).toBe("reselling-hq-my-data-2026-10-18.json");
  const file = JSON.parse(require("fs").readFileSync(await download.path(), "utf8"));
  expect(file.account.email).toBe("me@example.com");
  expect(file.settings.data.budget).toBe(123);
  expect(file.reports).toEqual([]);
});

test("delete my account asks first, then removes everything", async ({ page }) => {
  const store = await useFakeSupabase(page);
  store.settings.push({ user_id: "user-1", data: { budget: 123 } });
  await page.goto("/");
  await openTab(page, "set");
  page.once("dialog", d => d.accept("delete please"));
  await page.click("#accDelete");
  await expect(page.locator("#accMsg")).toHaveText("Not deleted: you need to type DELETE.");
  expect(store.deleted).toEqual([]);
  page.once("dialog", d => d.accept("DELETE"));
  await page.click("#accDelete");
  await expect(page.locator("#gateMsg")).toHaveText("Your account and all its data have been deleted.");
  await expect(page.locator(".shell")).toBeHidden();
  expect(store.deleted).toEqual(["me@example.com"]);
  expect(store.settings).toEqual([]);
  expect(await page.evaluate(k => localStorage.getItem(k), STORAGE_KEY)).toBeNull();
});

test("sign out goes back to the sign-in screen", async ({ page }) => {
  await useFakeSupabase(page);
  await page.goto("/");
  await openTab(page, "set");
  await page.click("#accSignOut");
  await expect(page.locator("#gate h2")).toHaveText("Sign in");
  await expect(page.locator(".shell")).toBeHidden();
});

test("says plainly when sign-in isn't set up on the server", async ({ page }) => {
  await page.route("**/api/config", route => route.fulfill({ status: 503, json: { error: { code: "not_set_up" } } }));
  await page.goto("/");
  await expect(page.locator("#gateMsg")).toContainText("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are missing in Vercel");
  await expect(page.locator("#gEmail")).toBeHidden();
});
