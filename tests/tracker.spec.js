// The Dashboard and Orders screens in a real browser, against the pretend Supabase (no network, no cost).
const { test, expect } = require("@playwright/test");
const { useFakeSupabase } = require("./fake-supabase");

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|status of (400|401|403|404|406|502|503)/.test(m.text())) page.errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+01:00")); // Sunday 18 October 2026
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

const isPhone = page => page.viewportSize().width < 760;
async function goOrders(page) {
  await page.locator('nav.menu [data-tab="orders"]:not([data-filter]), nav.tabbar [data-tab="orders"]').filter({ visible: true }).first().click();
  await expect(page.locator("#orders")).toBeVisible();
}
// The + button on a phone, the Add order button on a computer.
async function startOrder(page) {
  await page.click(isPhone(page) ? ".fab" : '#dash [data-sheet="addSheet"]');
  await page.click('#addSheet [data-add="order"]');
  await expect(page.locator("#orderSheet")).toBeVisible();
}
const card = (page, text) => page.locator("#ordList .ocard", { hasText: text });

test("add an order, move it along, then into stock", async ({ page }) => {
  const store = await useFakeSupabase(page);
  await page.goto("/");
  await expect(page.locator("#dashOut")).toContainText("Tap Add to put in an order");
  await startOrder(page);
  await page.click('#orderForm [type="submit"]');
  await expect(page.locator("#orderForm .formmsg")).toHaveText("Say what you ordered.");
  await page.fill('#orderForm [name="item"]', "30th Celebration Mini Tin");
  await page.fill('#orderForm [name="shop"]', "Pokémon Center");
  await page.fill('#orderForm [name="order_ref"]', "PC-48207");
  await page.fill('#orderForm [name="cost"]', "35.97");
  await page.fill('#orderForm [name="qty"]', "3");
  await page.click('#orderForm [type="submit"]');
  await expect(page.locator("#orderSheet")).toBeHidden();
  expect(store.orders).toHaveLength(1);
  expect(store.orders[0]).toMatchObject({ item: "30th Celebration Mini Tin", shop: "Pokémon Center", qty: 3, cost: 35.97, status: "Ordered", ordered: "2026-10-18", user_id: "user-1" });

  // The dashboard counts it as on the way.
  await expect(page.locator('[data-box="pending"]')).toContainText("1 order");
  await expect(page.locator('[data-box="pending"]')).toContainText("£35.97 committed");

  await goOrders(page);
  const c = card(page, "Mini Tin");
  await expect(c).toContainText("Pokémon Center · Order PC-48207 · 18 Oct");
  await expect(c).toContainText("Tracking number not added yet");
  await expect(c.locator(".steps4 .lit")).toHaveCount(1);
  await c.getByRole("button", { name: "Mark shipped" }).click();
  await expect(c.locator(".pill")).toHaveText("Shipped");
  await c.getByRole("button", { name: "Mark out for delivery" }).click();
  await c.getByRole("button", { name: "Mark delivered" }).click();
  await expect(c.locator(".pill")).toHaveText("Delivered");
  await expect(c.locator(".steps4.good .lit")).toHaveCount(4);
  expect(store.orders[0].status).toBe("Delivered");

  await c.getByRole("button", { name: "Move into stock" }).click();
  await expect(page.locator("#toast")).toHaveText("Added 3 items to your stock.");
  await expect(c).toContainText("added to stock");
  await expect(c.getByRole("button", { name: "Move into stock" })).toHaveCount(0);
  expect(store.items.map(i => i.cost)).toEqual([11.99, 11.99, 11.99]);
  expect(store.items.every(i => i.name === "30th Celebration Mini Tin" && i.status === "In stock")).toBe(true);

  await page.locator('nav.menu [data-tab="dash"], nav.tabbar [data-tab="dash"]').filter({ visible: true }).first().click();
  await expect(page.locator('[data-box="stock"]')).toContainText("3 items");
  await expect(page.locator('[data-box="stock"]')).toContainText("£36 cost");
});

test("edit, search, filter and delete orders, and pre-orders", async ({ page }) => {
  const store = await useFakeSupabase(page, { seed: { orders: [
    { item: "Nike Dunk Low Panda", shop: "Nike", ordered: "2026-10-14", cost: 99.99, status: "Shipped", courier: "DPD", tracking: "15502938" },
    { item: "Moltres tin", shop: "Pokémon Center", ordered: "2026-10-15", cost: 11.99, status: "Cancelled" },
  ] } });
  await page.goto("/");
  await goOrders(page);
  await expect(page.locator("#ordFilters")).toContainText("All2");
  await page.fill("#ordSearch", "1550");
  await expect(page.locator("#ordList .ocard")).toHaveCount(1);
  await page.fill("#ordSearch", "");
  await page.click('[data-filter-chip="cancelled"]');
  await expect(page.locator("#ordList .ocard")).toHaveCount(1);
  await expect(page.locator("#ordList")).toContainText("Moltres tin");
  await page.click('[data-filter-chip="all"]');

  // Add a pre-order from the Orders screen.
  await page.click('#orders [data-add="order"]');
  await page.fill('#orderForm [name="item"]', "Surging Sparks Booster Box");
  await page.fill('#orderForm [name="cost"]', "129.99");
  await expect(page.locator("#orderForm [data-pre]")).toBeHidden();
  await page.check('#orderForm [name="preorder"]');
  await page.fill('#orderForm [name="release"]', "2026-11-07");
  await page.click('#orderForm [type="submit"]');
  await expect(card(page, "Surging Sparks").locator(".pill")).toHaveText("Pre-order");
  await expect(card(page, "Surging Sparks")).toContainText("Releases 7 Nov");
  await page.click('[data-filter-chip="preorders"]');
  await expect(page.locator("#ordList .ocard")).toHaveCount(1);
  await page.click('[data-filter-chip="all"]');

  // Tap a card to edit it.
  await card(page, "Nike Dunk").click();
  await expect(page.locator("#orderTitle")).toHaveText("Edit order");
  await expect(page.locator('#orderForm [name="tracking"]')).toHaveValue("15502938");
  await page.fill('#orderForm [name="item"]', "Nike Dunk Low Panda UK 9");
  await page.click('#orderForm [type="submit"]');
  await expect(page.locator("#ordList")).toContainText("Nike Dunk Low Panda UK 9");
  expect(store.orders.find(o => o.shop === "Nike").item).toBe("Nike Dunk Low Panda UK 9");

  // Deleting asks first.
  await card(page, "Moltres").click();
  page.once("dialog", d => d.dismiss());
  await page.click("#orderForm [data-delete]");
  expect(store.orders).toHaveLength(3);
  page.once("dialog", d => d.accept());
  await page.click("#orderForm [data-delete]");
  await expect(page.locator("#ordList")).not.toContainText("Moltres");
  expect(store.orders).toHaveLength(2);

  // The dashboard shows the pre-order separately from what's on the way.
  await page.locator('nav.menu [data-tab="dash"], nav.tabbar [data-tab="dash"]').filter({ visible: true }).first().click();
  await expect(page.locator('[data-box="preorders"]')).toContainText("1 locked in");
  await expect(page.locator('[data-box="preorders"]')).toContainText("£129.99 paid · next release 7 Nov");
  await expect(page.locator('[data-box="pending"]')).toContainText("1 order");
});

test("dashboard figures, goal, chart and choosing boxes", async ({ page }) => {
  const store = await useFakeSupabase(page, { seed: {
    items: [
      { name: "Pokémon 151 bundle", status: "Sold", sold: "2026-10-16", sale_price: 48, cost: 25, fees: 6, postage: 3, platform: "eBay", category: "Pokémon", posted: true },
      { name: "Pokémon 151 bundle", status: "Sold", sold: "2026-10-08", sale_price: 48, cost: 25, fees: 6, postage: 3, platform: "eBay", category: "Pokémon", posted: true },
      { name: "Nike Tech Fleece", status: "Sold", sold: "2026-10-17", sale_price: 65, cost: 30, platform: "Vinted", category: "Clothing" },
      { name: "Jordan 1 Mocha", status: "Listed", cost: 140, ask_price: 185, listed: "2026-09-01", category: "Shoes" },
    ],
    expenses: [{ date: "2026-01-05", description: "Bot subscription", category: "Software and bots", amount: 60, repeat: "monthly" }],
  } });
  await page.goto("/");
  const profit = page.locator('[data-box="profit"]');
  await expect(profit).toContainText("£63.00"); // 14 + 14 + 35
  await expect(profit).toContainText("This week£49.00");
  await expect(profit).toContainText("Month after expenses£3.00");
  await expect(page.locator('[data-box="stock"]')).toContainText("£140 cost · est. £185 value");
  await expect(page.locator("#dashOut .dashhead p")).toHaveText("1 listing past your stale limit and 1 sale to post.");
  await expect(page.locator('[data-box="actions"]')).toContainText("Jordan 1 Mocha, 47 days listed");
  await expect(page.locator('[data-box="best"]')).toContainText("Pokémon 151 bundle");
  await page.click('[data-pref="bestBy"][data-val="profit"]');
  await expect(page.locator('[data-box="best"]')).toContainText("Nike Tech Fleece");
  await expect(page.locator('[data-box="expenses"]')).toContainText("£60.00/mo");
  await expect(page.locator('[data-box="platform"]')).toContainText("eBay");

  // Chart: switch period and what it shows; the choice is saved in the account.
  await expect(page.locator('[data-box="chart"] .legend')).toContainText("Revenue £161.00");
  await page.click('[data-pref="chartPeriod"][data-val="7d"]');
  await expect(page.locator('[data-box="chart"]')).toContainText("Last 7 days");
  await expect(page.locator('[data-box="chart"] .legend')).toContainText("Revenue £113.00");
  await page.click('[data-pref="chartShow"][data-val="profit"]');
  await expect(page.locator('[data-box="chart"] .legend')).not.toContainText("Revenue");
  await expect(page.locator('[data-box="chart"] svg path')).toHaveCount(1);
  await expect.poll(() => store.settings[0] && store.settings[0].data).toMatchObject({ chartPeriod: "7d", chartShow: "profit", bestBy: "profit" });

  // Goal ring.
  await page.click("#editGoal");
  await page.fill('#goalForm [name="goal"]', "200");
  await page.click('#goalForm [type="submit"]');
  await expect(page.locator('[data-box="goal"]')).toContainText("32%");
  await expect(page.locator('[data-box="goal"]')).toContainText("£137 to go · 13 days left");

  // Customise: switch the expenses box off; it stays off after a reload.
  await page.click("#dashCustomise");
  await page.uncheck('#custList [name="expenses"]');
  await page.click('#custForm [type="submit"]');
  await expect(page.locator('[data-box="expenses"]')).toHaveCount(0);
  await expect.poll(() => store.settings[0].data.dashHide).toEqual(["expenses"]);
  await page.reload();
  await expect(page.locator('[data-box="profit"]')).toBeVisible();
  await expect(page.locator('[data-box="expenses"]')).toHaveCount(0);
  await expect(page.locator('[data-box="goal"]')).toContainText("32%");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(wide).toBe(false);
});

test("says how to finish setup when the tracker tables aren't in the database yet", async ({ page }) => {
  await useFakeSupabase(page, { tracker: false });
  await page.goto("/");
  await expect(page.locator("#dashOut")).toContainText("the tracker isn't in your database yet");
  await expect(page.locator("#dashOut")).toContainText("002_tracker.sql");
  await goOrders(page);
  await expect(page.locator("#ordList")).toContainText("002_tracker.sql");
});
