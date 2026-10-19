// The eBay card in Settings and checking synced eBay sales, in a real browser against the pretend Supabase
// and a pretend /api/ebay that runs the real matching rules from js/core.js. No network, no cost.
const { test, expect } = require("@playwright/test");
const { useFakeSupabase } = require("./fake-supabase");
const R = require("../js/core.js");

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on("pageerror", e => page.errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/fonts\.g|status of (400|401|403|404|406|409|502|503)/.test(m.text())) page.errors.push(m.text()); });
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+01:00"));
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

const NOW = "2026-10-18T08:00:00.000Z";
const order = (id, title, price = "60.00") => ({ orderId: id, creationDate: "2026-10-16T12:00:00.000Z", orderFulfillmentStatus: "FULFILLED", orderPaymentStatus: "PAID",
  cancelStatus: { cancelState: "NONE_REQUESTED" }, totalMarketplaceFee: { value: "8.00" },
  lineItems: [{ lineItemId: id + "1", title, quantity: 1, lineItemCost: { value: price }, deliveryCost: { shippingCost: { value: "0" } }, lineItemFulfillmentStatus: "FULFILLED" }] });

// A pretend /api/ebay. "orders" are what eBay would hand over on the next sync.
async function useFakeEbay(page, store, { connected = false, lastSyncAt = NOW, orders = [] } = {}) {
  const st = { configured: true, env: "sandbox", connected, username: connected ? "rhq_seller" : undefined, lastSyncAt: connected ? lastSyncAt : undefined,
    lastSync: connected ? { ok: true, at: lastSyncAt, added: 0, matched: 0, linked: 0, updated: 0, undone: 0, finances: "ok" } : undefined };
  const api = { st, orders, syncs: 0 };
  let n = 0;
  await page.route("**/fake-ebay-signin", route => { st.connected = true; st.username = "rhq_seller"; return route.fulfill({ status: 302, headers: { location: "/?ebay=connected" } }); });
  await page.route(u => u.pathname === "/api/ebay", async route => {
    const action = new URL(route.request().url()).searchParams.get("action");
    if (action === "status") return route.fulfill({ json: st });
    if (action === "connect") return route.fulfill({ json: { url: "/fake-ebay-signin" } });
    if (action === "disconnect") {
      Object.assign(st, { connected: false, username: undefined, lastSyncAt: undefined, lastSync: undefined });
      store.items.forEach(i => { if (i.source === "ebay") i.source_ref = null; });
      return route.fulfill({ json: { disconnected: true } });
    }
    if (action === "sync") {
      api.syncs++;
      const plan = R.planEbaySync(store.items, R.ebaySales(api.orders));
      for (const r of plan.inserts) store.items.push({ ask_price: null, bought: null, listed: null, notes: "", order_id: null, import_id: null, ...r, id: "eb-" + ++n, user_id: "user-1", created_at: NOW, updated_at: NOW });
      for (const u of plan.updates) Object.assign(store.items.find(i => i.id === u.id), u.patch);
      store.items = store.items.filter(i => !plan.deletes.includes(i.id));
      const result = { ok: true, orders: api.orders.length, ...plan.counts, finances: "ok", at: new Date().toISOString() };
      Object.assign(st, { lastSyncAt: result.at, lastSync: result });
      return route.fulfill({ json: result });
    }
    return route.fulfill({ status: 404, json: { error: { code: "unknown_action" } } });
  });
  return api;
}
async function openSettings(page) {
  await expect(page.locator(".shell")).toBeVisible();
  const direct = page.locator('nav.menu [data-tab="set"], .railfoot [data-tab="set"]').filter({ visible: true });
  if (await direct.count()) await direct.first().click();
  else { await page.click('nav.tabbar [data-sheet="moreSheet"]'); await page.click('#moreSheet [data-tab="set"]'); }
  await expect(page.locator("#set")).toBeVisible();
}
const stock = (f) => ({ size: "", cost: 40, status: "In stock", bought: "2026-09-01", ...f });

test("not set up yet: the card says so", async ({ page }) => {
  await useFakeSupabase(page);
  await page.goto("/");
  await openSettings(page);
  await expect(page.locator("#ebayCard")).toContainText("eBay isn't set up on this website yet");
});

test("connect eBay, come back, and the sales since 6 April come in matched to stock", async ({ page }) => {
  const store = await useFakeSupabase(page, { seed: { items: [stock({ name: "Jordan 4 Military Black", size: "UK 9", status: "Listed", cost: 120 })] } });
  const api = await useFakeEbay(page, store, { orders: [order("O1", "Air Jordan 4 Military Black UK 9", "190.00"), order("O2", "Pokemon Surging Sparks ETB", "55.00")] });
  await page.goto("/");
  await openSettings(page);
  const card = page.locator("#ebayCard");
  await expect(card).toContainText("Bring in your eBay sales automatically");
  await expect(card).toContainText("never sees your eBay password");
  await card.getByRole("button", { name: "Connect eBay" }).click();
  // eBay sends you back; the app opens Settings and brings the sales in.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("#set")).toBeVisible();
  await expect(card).toContainText("Connected as rhq_seller");
  await expect(card).toContainText("1 new sale, 1 matched to your stock.");
  await expect(page.locator("#toast")).toContainText("2 sales to check on the dashboard");
  expect(api.syncs).toBe(1);
  expect(store.items.find(i => i.name === "Jordan 4 Military Black")).toMatchObject({ status: "Sold", sale_price: 190, fees: 8, source_ref: "ebay:O1:O11:1", needs_review: "match" });

  // Sync now again: nothing new, nothing doubled.
  await card.getByRole("button", { name: "Sync now" }).click();
  await expect(page.locator("#toast")).toContainText("eBay: No new eBay sales.");
  expect(store.items).toHaveLength(2);
});

test("checking an eBay sale that didn't match: pick the stock item it was", async ({ page }) => {
  const store = await useFakeSupabase(page, { seed: { items: [
    stock({ name: "Nike Tech Fleece Grey", size: "M", cost: 35, status: "Listed" }),
    { name: "Tech Fleece hoodie grey medium", status: "Sold", platform: "eBay", sold: "2026-10-16", sale_price: 60, fees: 8, posted: true, source: "ebay", source_ref: "ebay:O9:O91:1", source_title: "Tech Fleece hoodie grey medium", needs_review: "new" },
  ] } });
  await useFakeEbay(page, store, { connected: true });
  await page.goto("/");
  const action = page.locator('[data-box="actions"] [data-action]', { hasText: "Check eBay sale: Tech Fleece hoodie grey medium" });
  await expect(action).toBeVisible();
  await expect(page.locator('[data-box="actions"]')).not.toContainText("has no cost");
  await action.click();
  const sheet = page.locator("#reviewSheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("didn't match anything in your stock");
  await sheet.locator('[type="submit"]').click();
  await expect(sheet.locator(".formmsg")).toHaveText("Choose which item it was.");
  await sheet.locator('[name="item_id"]').selectOption({ label: "Nike Tech Fleece Grey · M · £35.00" });
  await sheet.locator('[type="submit"]').click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#toast")).toHaveText("Sale moved to Nike Tech Fleece Grey.");
  expect(store.items).toHaveLength(1);
  expect(store.items[0]).toMatchObject({ name: "Nike Tech Fleece Grey", cost: 35, status: "Sold", sale_price: 60, fees: 8, source_ref: "ebay:O9:O91:1", prev_status: "Listed", needs_review: null });
  await expect(page.locator('[data-box="actions"]')).not.toContainText("Check eBay sale");
});

test("checking a name match: yes, or no and keep it as its own item", async ({ page }) => {
  const store = await useFakeSupabase(page, { seed: { items: [
    stock({ name: "151 ETB", status: "Sold", prev_status: "Listed", platform: "eBay", sold: "2026-10-16", sale_price: 55, fees: 7, posted: true, source: "ebay", source_ref: "ebay:A:A1:1", source_title: "Pokemon 151 Elite Trainer Box", needs_review: "match" }),
    stock({ name: "Crown Zenith ETB", status: "Sold", prev_status: "In stock", platform: "eBay", sold: "2026-10-16", sale_price: 70, fees: 9, posted: true, source: "ebay", source_ref: "ebay:B:B1:1", source_title: "Pokemon Crown Zenith Pokemon Center ETB", needs_review: "match" }),
  ] } });
  await useFakeEbay(page, store, { connected: true });
  await page.goto("/");
  await page.locator('[data-box="actions"] [data-action]', { hasText: "Check eBay sale: 151 ETB" }).click();
  const sheet = page.locator("#reviewSheet");
  await expect(sheet).toContainText("matched this eBay sale to 151 ETB in your stock by its name (cost £40.00)");
  await expect(sheet).toContainText("On eBay: Pokemon 151 Elite Trainer Box");
  await sheet.getByRole("button", { name: "Yes, that's right" }).click();
  await expect(sheet).toBeHidden();
  expect(store.items[0].needs_review).toBe(null);

  await page.locator('[data-box="actions"] [data-action]', { hasText: "Check eBay sale: Crown Zenith ETB" }).click();
  await sheet.getByRole("button", { name: "No, it was something else" }).click();
  await sheet.locator('[name="item_id"]').selectOption("new");
  await sheet.locator('[name="cost"]').fill("48");
  await sheet.locator('[type="submit"]').click();
  await expect(sheet).toBeHidden();
  // The wrongly matched item is back in stock; the sale is now its own item with the eBay title and your cost.
  expect(store.items.find(i => i.name === "Crown Zenith ETB")).toMatchObject({ status: "In stock", sale_price: null, source_ref: null, prev_status: null, needs_review: null });
  expect(store.items.find(i => i.name === "Pokemon Crown Zenith Pokemon Center ETB")).toMatchObject({ status: "Sold", cost: 48, sale_price: 70, fees: 9, source_ref: "ebay:B:B1:1", needs_review: null });
});

test("Sales screen: synced sales are labelled, and To check lists the ones to look at", async ({ page }) => {
  await useFakeSupabase(page, { seed: { items: [
    { name: "Synced one", status: "Sold", platform: "eBay", sold: "2026-10-16", sale_price: 60, posted: true, source: "ebay", source_ref: "ebay:O1:1:1", needs_review: "new" },
    { name: "Hand recorded", status: "Sold", platform: "Vinted", sold: "2026-10-15", sale_price: 20, cost: 5, posted: true },
  ] } });
  await page.goto("/");
  await expect(page.locator(".shell")).toBeVisible();
  const direct = page.locator('nav.menu [data-tab="sales"]:not([data-filter]), nav.tabbar [data-tab="sales"]').filter({ visible: true });
  if (await direct.count()) await direct.first().click(); else { await page.click('nav.tabbar [data-sheet="moreSheet"]'); await page.click('#moreSheet [data-tab="sales"]'); }
  const c = page.locator("#saleList .ocard", { hasText: "Synced one" });
  await expect(c).toContainText("eBay (synced)");
  await expect(c.locator(".pill")).toHaveText("Check");
  await page.click('#saleFilters [data-chip="check"]');
  await expect(page.locator("#saleList .ocard")).toHaveCount(1);
  await c.click();
  await expect(page.locator("#reviewSheet")).toBeVisible();
});

test("disconnect keeps your sales", async ({ page }) => {
  const store = await useFakeSupabase(page, { seed: { items: [{ name: "Old eBay sale", status: "Sold", platform: "eBay", sold: "2026-10-16", sale_price: 60, cost: 20, posted: true, source: "ebay", source_ref: "ebay:O1:1:1" }] } });
  const api = await useFakeEbay(page, store, { connected: true });
  await page.goto("/");
  await openSettings(page);
  const card = page.locator("#ebayCard");
  await expect(card).toContainText("Connected as rhq_seller");
  await expect(card).toContainText("Last synced just now."); // recent, so opening the app didn't sync again
  expect(api.syncs).toBe(0);
  page.once("dialog", d => { expect(d.message()).toContain("Your sales stay in your tracker"); d.accept(); });
  await card.getByRole("button", { name: "Disconnect" }).click();
  await expect(card.getByRole("button", { name: "Connect eBay" })).toBeVisible();
  expect(store.items).toHaveLength(1);
  expect(store.items[0]).toMatchObject({ status: "Sold", source_ref: null });
});

test("opening the app syncs on its own when the last sync was over 12 hours ago", async ({ page }) => {
  const store = await useFakeSupabase(page);
  const api = await useFakeEbay(page, store, { connected: true, lastSyncAt: "2026-10-17T18:00:00.000Z", orders: [order("O1", "Jordan 1 Chicago")] });
  await page.goto("/");
  await expect.poll(() => api.syncs).toBe(1);
  await expect(page.locator('[data-box="actions"]')).toContainText("Check eBay sale: Jordan 1 Chicago");
});

test("declining on eBay's page says nothing was connected", async ({ page }) => {
  const store = await useFakeSupabase(page);
  const api = await useFakeEbay(page, store, { connected: false });
  await page.goto("/?ebay=declined");
  await expect(page.locator("#set")).toBeVisible();
  await expect(page.locator("#toast")).toHaveText("Nothing was connected: you didn't agree on eBay's page.");
  await expect(page).toHaveURL(/\/$/);
  expect(api.syncs).toBe(0);
});
