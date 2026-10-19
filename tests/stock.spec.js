// Inventory, Sales, Expenses, Settings, bringing in an old tracker and Download backup, in a real browser
// against the pretend Supabase (no network, no cost).
const { test, expect } = require("@playwright/test");
const path = require("path");
const fs = require("fs");
const { useFakeSupabase } = require("./fake-supabase");
const X = require("../js/xlsx.js");
const RHQ = require("../js/core.js");

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|status of (400|401|403|404|406|502|503)/.test(m.text())) page.errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+01:00")); // Sunday 18 October 2026
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

const isPhone = page => page.viewportSize().width < 760;
async function open(page, tab) {
  const direct = page.locator(`nav.menu [data-tab="${tab}"]:not([data-filter]), nav.tabbar [data-tab="${tab}"], .mobilebar [data-tab="${tab}"], .railfoot [data-tab="${tab}"]`).filter({ visible: true });
  if (await direct.count()) await direct.first().click();
  else { await page.click('nav.tabbar [data-sheet="moreSheet"]'); await page.click(`#moreSheet [data-tab="${tab}"]`); }
  await expect(page.locator("#" + tab)).toBeVisible();
}
async function quickAdd(page, what) {
  await page.click(isPhone(page) ? ".fab" : '#dash [data-sheet="addSheet"]');
  await page.click(`#addSheet [data-add="${what}"]`);
}
const card = (page, list, text) => page.locator(`${list} .ocard`, { hasText: text });

test("add stock, list it, sell it, post it", async ({ page }) => {
  const store = await useFakeSupabase(page);
  await page.goto("/");
  await quickAdd(page, "item");
  await expect(page.locator("#itemSheet")).toBeVisible();
  await page.click('#itemForm [type="submit"]');
  await expect(page.locator("#itemForm .formmsg")).toHaveText("Say what the item is.");
  await page.fill('#itemForm [name="name"]', "Jordan 4 Military Black");
  await page.fill('#itemForm [name="size"]', "UK 9");
  await page.fill('#itemForm [name="category"]', "Shoes");
  await page.fill('#itemForm [name="cost"]', "165");
  await page.fill('#itemForm [name="ask_price"]', "210");
  await page.click('#itemForm [type="submit"]');
  await expect(page.locator("#itemSheet")).toBeHidden();
  expect(store.items[0]).toMatchObject({ name: "Jordan 4 Military Black", size: "UK 9", cost: 165, ask_price: 210, status: "In stock", bought: "2026-10-18", user_id: "user-1" });
  await expect(page.locator('[data-box="stock"]')).toContainText("£165 cost · est. £210 value");

  await open(page, "inv");
  const c = card(page, "#invList", "Jordan 4");
  await expect(c).toContainText("Not listed yet");
  await c.getByRole("button", { name: "Mark listed" }).click();
  await expect(c.locator(".pill")).toHaveText("Listed");
  expect(store.items[0]).toMatchObject({ status: "Listed", listed: "2026-10-18" });

  await c.getByRole("button", { name: "Mark as sold" }).click();
  await expect(page.locator("#saleSheet")).toBeVisible();
  await expect(page.locator('#saleForm [name="item_id"]')).toHaveValue(store.items[0].id);
  await page.fill('#saleForm [name="platform"]', "eBay");
  await page.fill('#saleForm [name="sale_price"]', "200");
  await page.fill('#saleForm [name="fees"]', "25.60");
  await page.fill('#saleForm [name="postage"]', "4.40");
  await expect(page.locator("#saleForm [data-profit]")).toContainText("Profit on this sale: £5.00");
  await page.click('#saleForm [type="submit"]');
  await expect(page.locator("#toast")).toContainText("It's on your list to post.");
  expect(store.items[0]).toMatchObject({ status: "Sold", platform: "eBay", sold: "2026-10-18", sale_price: 200, fees: 25.6, postage: 4.4, posted: false });
  await expect(card(page, "#invList", "Jordan 4")).toHaveCount(0);

  await open(page, "sales");
  const s = card(page, "#saleList", "Jordan 4");
  await expect(s.locator(".pill")).toHaveText("To post");
  await expect(s).toContainText("£5.00");
  await expect(page.locator("#saleStats")).toContainText("Revenue£200");
  await s.getByRole("button", { name: "Mark posted" }).click();
  await expect(s.locator(".pill")).toHaveText("Sold");
  expect(store.items[0].posted).toBe(true);

  // Tap the sale to fix it: the form shows the sale details.
  await s.click();
  await expect(page.locator("#itemTitle")).toHaveText("Edit sale");
  await expect(page.locator('#itemForm [data-sold]')).toBeVisible();
  await page.fill('#itemForm [name="sale_price"]', "205");
  await page.click('#itemForm [type="submit"]');
  await expect(s).toContainText("£10.00");
  expect(store.items[0].sale_price).toBe(205);
});

test("record a sale of something that wasn't in stock, filter sales, and the posting list", async ({ page }) => {
  const store = await useFakeSupabase(page, { seed: { items: [
    { name: "Old sale", status: "Sold", sold: "2026-09-01", sale_price: 30, cost: 10, platform: "Vinted", posted: true },
    { name: "Stone Island", status: "In stock", cost: 40 },
  ] } });
  await page.goto("/");
  await open(page, "sales");
  await page.click('#sales [data-add="sale"]');
  await expect(page.locator('#saleForm [name="item_id"]')).toHaveValue("");
  await page.click('#saleForm [type="submit"]');
  await expect(page.locator("#saleForm .formmsg")).toHaveText("Choose which item you sold.");
  await page.selectOption('#saleForm [name="item_id"]', "new");
  await page.fill('#saleForm [name="name"]', "Nike Tech Fleece");
  await page.fill('#saleForm [name="cost"]', "30");
  await page.fill('#saleForm [name="platform"]', "Vinted");
  await page.fill('#saleForm [name="sale_price"]', "65");
  await page.check('#saleForm [name="posted"]');
  await page.click('#saleForm [type="submit"]');
  expect(store.items.find(i => i.name === "Nike Tech Fleece")).toMatchObject({ status: "Sold", cost: 30, sale_price: 65, platform: "Vinted", posted: true });
  await expect(page.locator("#saleList .ocard")).toHaveCount(1); // this month only
  await page.click('[data-chip="all"]');
  await expect(page.locator("#saleList .ocard")).toHaveCount(2);
  await page.selectOption("#salePlatform", "Vinted");
  await expect(page.locator("#saleList .ocard")).toHaveCount(2);
  await page.click('[data-chip="toPost"]');
  await expect(page.locator("#saleList")).toContainText("Everything's posted.");
});

test("expenses: subscriptions and one-off costs", async ({ page }) => {
  const store = await useFakeSupabase(page);
  await page.goto("/");
  await quickAdd(page, "expense");
  await page.fill('#expForm [name="description"]', "Bot subscription");
  await page.fill('#expForm [name="amount"]', "60");
  await page.fill('#expForm [name="date"]', "2026-10-01");
  await page.fill('#expForm [name="category"]', "Software and bots");
  await expect(page.locator("#expForm [data-end]")).toBeHidden();
  await page.selectOption('#expForm [name="repeat"]', "monthly");
  await expect(page.locator("#expForm [data-end]")).toBeVisible();
  await page.click('#expForm [type="submit"]');
  expect(store.expenses[0]).toMatchObject({ description: "Bot subscription", amount: 60, repeat: "monthly", deductible: true, date: "2026-10-01" });
  await expect(page.locator('[data-box="expenses"]')).toContainText("£60.00/mo");

  await open(page, "exp");
  await page.click('#exp [data-add="expense"]');
  await page.fill('#expForm [name="description"]', "Takeaway");
  await page.fill('#expForm [name="amount"]', "9.50");
  await page.uncheck('#expForm [name="deductible"]');
  await page.click('#expForm [type="submit"]');
  await expect(page.locator("#expStats")).toContainText("This month£69.50");
  await expect(page.locator("#expStats")).toContainText("Tax-deductible£60.00");
  await expect(card(page, "#expList", "Takeaway")).toContainText("Not tax-deductible");
  await expect(card(page, "#expList", "Bot subscription").locator(".pill")).toHaveText("Monthly");

  await card(page, "#expList", "Takeaway").click();
  page.once("dialog", d => d.accept());
  await page.click("#expForm [data-delete]");
  await expect(card(page, "#expList", "Takeaway")).toHaveCount(0);
  expect(store.expenses).toHaveLength(1);
});

test("needs action opens the right thing", async ({ page }) => {
  await useFakeSupabase(page, { seed: { items: [
    { name: "Jordan 1 Mocha", status: "Listed", cost: 140, listed: "2026-09-01", category: "Shoes" },
    { name: "Nike Tech Fleece", status: "Sold", sold: "2026-10-17", sale_price: 65, cost: 30, posted: false },
  ] } });
  await page.goto("/");
  const actions = page.locator('[data-box="actions"]');
  await expect(actions).toContainText("Download your first backup");
  await actions.getByRole("button", { name: /Jordan 1 Mocha, 47 days listed/ }).click();
  await expect(page.locator("#itemTitle")).toHaveText("Edit stock");
  await expect(page.locator('#itemForm [name="name"]')).toHaveValue("Jordan 1 Mocha");
  await page.locator("#itemSheet [data-close]").first().click();
  await actions.getByRole("button", { name: /1 sale to post/ }).click();
  await expect(page.locator("#sales")).toBeVisible();
  await expect(page.locator('[data-chip="toPost"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#saleList .ocard")).toHaveCount(1);
});

test("settings: no sheet links, monthly goal, colours", async ({ page }) => {
  const store = await useFakeSupabase(page);
  await page.goto("/");
  await open(page, "set");
  await expect(page.locator("#set")).not.toContainText("CSV link");
  await expect(page.locator("#sInv")).toHaveCount(0);
  await page.fill("#sGoal", "600");
  await page.click('#setForm button[type="submit"]');
  await expect(page.locator("#setMsg")).toHaveText("Saved.");
  expect(store.settings[0].data.goal).toBe(600);
  await page.selectOption("#sTheme", "light");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  await page.selectOption("#sTheme", "dark");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.locator('[data-box="goal"]')).toContainText("of £600");
});

test("bring in an old tracker, then again with nothing doubled", async ({ page }) => {
  const store = await useFakeSupabase(page);
  await page.goto("/");
  await open(page, "set");
  await page.setInputFiles("#importIn", ["tracker.csv", "expenses.csv"].map(f => path.join(__dirname, "fixtures", f)));
  const out = page.locator("#importOut");
  await expect(out).toContainText("Ready to add: 4 stock items and 3 sales, 2 expenses.");
  await page.click("#importGo");
  await expect(out).toContainText("Added 7 items, 0 orders and 2 expenses.");
  expect(store.items).toHaveLength(7);
  expect(store.expenses).toHaveLength(2);
  expect(store.items.every(i => i.user_id === "user-1")).toBe(true);
  // Sold items from an old tracker were posted long ago.
  expect(store.items.filter(i => i.status === "Sold").every(i => i.posted)).toBe(true);

  await page.setInputFiles("#importIn", ["tracker.csv", "expenses.csv"].map(f => path.join(__dirname, "fixtures", f)));
  await expect(out).toContainText("Everything in that file is already in the app (9 rows)");
  // The same tracker as an Excel file: all of it is already here.
  await page.setInputFiles("#importIn", path.join(__dirname, "fixtures", "old-tracker.xlsx"));
  await expect(out).toContainText("Everything in that file is already in the app (3 rows)");
  await page.setInputFiles("#importIn", { name: "notes.csv", mimeType: "text/csv", buffer: Buffer.from("hello,world\n1,2") });
  await expect(out).toContainText("Couldn't find a tracker table");

  await open(page, "inv");
  await expect(page.locator("#invList .ocard")).toHaveCount(4);
});

test("download backup gives an Excel file that comes back in with nothing lost", async ({ page }) => {
  const store = await useFakeSupabase(page, { seed: {
    items: [{ name: "Dunk Low", status: "Sold", sold: "2026-10-12", sale_price: 90, cost: 60, platform: "Vinted", posted: true }, { name: "Mocha", status: "Listed", cost: 140, listed: "2026-10-01" }],
    orders: [{ item: "Mini tin", shop: "Pokémon Center", status: "Shipped", cost: 11.99, ordered: "2026-10-14" }],
    expenses: [{ description: "Proxies", amount: 36.75, date: "2026-10-02", repeat: "monthly", category: "Proxies" }],
  } });
  await page.goto("/");
  await open(page, "set");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#backupBtn")]);
  expect(download.suggestedFilename()).toBe("reselling-hq-backup-2026-10-18.xlsx");
  await expect(page.locator("#backupMsg")).toHaveText("Downloaded: 2 items, 1 order, 1 expense.");
  await expect.poll(() => store.settings[0] && store.settings[0].data.lastBackup).toBeTruthy();

  const sheets = await X.readXlsx(fs.readFileSync(await download.path()));
  expect(sheets.map(s => s.name)).toEqual(["Inventory", "Orders", "Expenses", "Settings"]);
  const back = RHQ.parseImport(sheets.map(s => X.rowsToTsv(s.rows)));
  expect(back.items.map(i => [i.name, i.status, i.sale_price])).toEqual([["Dunk Low", "Sold", 90], ["Mocha", "Listed", null]]);
  expect(back.orders).toMatchObject([{ item: "Mini tin", status: "Shipped", cost: 11.99 }]);
  expect(back.expenses).toMatchObject([{ description: "Proxies", amount: 36.75, repeat: "monthly" }]);

  // Bringing the backup back into the same account adds nothing twice (the file has no .xlsx ending here, which is fine).
  await page.setInputFiles("#importIn", await download.path());
  await expect(page.locator("#importOut")).toContainText("Everything in that file is already in the app (4 rows)");
  await page.locator('nav.menu [data-tab="dash"], nav.tabbar [data-tab="dash"]').filter({ visible: true }).first().click();
  await expect(page.locator('[data-box="actions"]')).not.toContainText("backup");
});
