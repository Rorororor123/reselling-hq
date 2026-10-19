// Stage 4 second half: the weekly check from the built-in tracker, the stock, sales and expenses screens,
// bringing in an old tracker, and the backup file.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import RHQ from "../js/core.js";
import X from "../js/xlsx.js";
const { trackerToCrunch, crunch, itemAge, itemFilter, itemMatches, salesView, expenseRows, parseImport, planImport, backupSheets, normInventory, normExpenses, tableFrom } = RHQ;

const NOW = new Date(2026, 9, 18, 9, 0); // the browser tests' date too
const fixture = f => fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8");
const settings = { stale: 30, stalePk: 90 };

describe("weekly check from the built-in tracker", () => {
  it("gives the same numbers as the old Google Sheet did", () => {
    const old = crunch(normInventory(tableFrom(fixture("tracker.csv"), "item name")), normExpenses(tableFrom(fixture("expenses.csv"), "amount")), settings, NOW);
    const imported = parseImport([fixture("tracker.csv"), fixture("expenses.csv")]);
    const { inv, exp } = trackerToCrunch(imported.items, imported.expenses, NOW);
    const now = crunch(inv, exp, settings, NOW);
    for (const k of ["counts", "stockValue", "week", "ty", "byCat", "byPlat", "stale"]) expect(now[k], k).toEqual(old[k]);
  });
  it("counts each monthly expense once per month so far", () => {
    const { exp } = trackerToCrunch([], [{ date: "2026-08-20", description: "Bot", amount: 60, repeat: "monthly" }], NOW);
    expect(exp.map(e => e.date.getMonth())).toEqual([7, 8]); // 20 Aug, 20 Sep; 20 Oct hasn't come yet
  });
  it("a sold item with no price isn't counted as stock or a sale", () => {
    const { inv } = trackerToCrunch([{ name: "x", status: "Sold", cost: 5 }], [], NOW);
    expect(crunch(inv, [], settings, NOW).counts).toMatchObject({ sold: 0, inStock: 0 });
  });
});

describe("stock screen helpers", () => {
  const items = [
    { name: "Jordan 1 Mocha", status: "Listed", listed: "2026-09-01", category: "Shoes", size: "UK 9" },
    { name: "Paldean Fates ETB", status: "Listed", listed: "2026-08-01", category: "Pokémon" },
    { name: "Stone Island", status: "In stock", category: "Clothing" },
    { name: "Sold tee", status: "Sold", sale_price: 10 },
  ];
  it("days listed against your limits", () => {
    expect(itemAge(items[0], settings, NOW)).toEqual({ days: 47, limit: 30, stale: true });
    expect(itemAge(items[1], settings, NOW)).toEqual({ days: 78, limit: 90, stale: false });
    expect(itemAge(items[2], settings, NOW).days).toBeNull();
  });
  it("filters and search", () => {
    const names = f => items.filter(itemFilter(f, settings, NOW)).map(i => i.name);
    expect(names("unsold")).toEqual(["Jordan 1 Mocha", "Paldean Fates ETB", "Stone Island"]);
    expect(names("stale")).toEqual(["Jordan 1 Mocha"]);
    expect(names("inStock")).toEqual(["Stone Island"]);
    expect(items.filter(i => itemMatches(i, "uk 9")).length).toBe(1);
  });
});

describe("sales screen", () => {
  const items = [
    { name: "A", status: "Sold", sold: "2026-10-16", sale_price: 48, cost: 25, fees: 6, postage: 3, platform: "eBay", posted: true },
    { name: "B", status: "Sold", sold: "2026-10-02", sale_price: 65, cost: 30, platform: "vinted", posted: false },
    { name: "C", status: "Sold", sold: "2026-09-25", sale_price: 100, cost: 60, platform: "Vinted", posted: true },
    { name: "D", status: "Sold", sold: "2026-04-01", sale_price: 50, cost: 10, platform: "StockX", posted: true },
    { name: "E", status: "Listed", cost: 5 },
  ];
  it("this month, newest first, with totals", () => {
    const v = salesView(items, { period: "month" }, NOW);
    expect(v.rows.map(r => r.name)).toEqual(["A", "B"]);
    expect(v.totals).toEqual({ count: 2, revenue: 113, profit: 49, fees: 6, postage: 3 });
    expect(v.toPost).toBe(1);
  });
  it("other periods, a platform and sales to post", () => {
    expect(salesView(items, { period: "30d" }, NOW).rows.map(r => r.name)).toEqual(["A", "B", "C"]);
    expect(salesView(items, { period: "ty" }, NOW).rows).toHaveLength(3); // 1 April is last tax year
    expect(salesView(items, { period: "all", platform: "Vinted" }, NOW).rows.map(r => r.name)).toEqual(["B", "C"]);
    expect(salesView(items, { toPost: true }, NOW).rows.map(r => r.name)).toEqual(["B"]);
    expect(salesView(items, {}, NOW).platforms).toEqual(["eBay", "StockX", "vinted"]); // "vinted" and "Vinted" are one platform
  });
});

describe("expenses list", () => {
  it("running subscriptions first, then newest", () => {
    const rows = expenseRows([
      { id: 1, date: "2026-10-05", repeat: "once" },
      { id: 2, date: "2026-01-05", repeat: "monthly" },
      { id: 3, date: "2026-02-01", repeat: "monthly", end_date: "2026-05-01" },
    ], NOW);
    expect(rows.map(r => [r.id, r.active, !!r.ended])).toEqual([[2, true, false], [1, false, false], [3, false, true]]);
  });
});

describe("bringing in an old tracker", () => {
  const imported = parseImport([fixture("tracker.csv"), fixture("expenses.csv")]);
  it("reads every real row and skips the examples", () => {
    expect(imported.items.map(i => i.name)).toEqual(["Jordan 4 Military Black", "Carhartt Detroit jacket, brown", "Yeezy 350 Zebra", "Prismatic Evolutions ETB", "New Balance 550", "Paldean Fates booster bundle", "Stone Island overshirt"]);
    expect(imported.expenses.map(e => e.description)).toEqual(["Postage bags", "Tape"]);
  });
  it("turns each row into a tracker item", () => {
    expect(imported.items[0]).toEqual({ name: "Jordan 4 Military Black", category: "Shoes", size: "UK 9", cost: 60, status: "Sold", bought: "2026-09-01", listed: "2026-09-02",
      ask_price: null, platform: "eBay", sold: "2026-10-15", sale_price: 100, fees: 13, postage: 4, posted: true, notes: "", import_id: "S1" });
    expect(imported.items[3]).toMatchObject({ status: "Listed", sold: null, sale_price: null });
    expect(imported.items[6]).toMatchObject({ status: "In stock", cost: null }); // blank cost stays blank, so it shows in Needs action
  });
  it("adds nothing twice", () => {
    const first = planImport({ items: [], expenses: [], orders: [] }, imported);
    expect(first.items).toMatchObject({ skipped: 0 });
    expect(first.items.add).toHaveLength(7);
    const saved = { items: first.items.add.map((r, k) => ({ ...r, id: "db" + k })), expenses: first.expenses.add, orders: [] };
    const again = planImport(saved, imported);
    expect([again.items.add.length, again.items.skipped, again.expenses.add.length, again.expenses.skipped]).toEqual([0, 7, 0, 2]);
    const twice = planImport({}, { items: [imported.items[0], imported.items[0]], expenses: [], orders: [] });
    expect(twice.items.add).toHaveLength(1);
  });
  it("reads an Excel file with a title row, real dates and two tabs", async () => {
    const sheets = await X.readXlsx(fs.readFileSync(path.join(__dirname, "fixtures", "old-tracker.xlsx")));
    expect(sheets.map(s => s.name)).toEqual(["Inventory", "Expenses"]);
    const p = parseImport(sheets.map(s => X.rowsToTsv(s.rows)));
    expect(p.items.map(i => [i.name, i.status, i.bought, i.sold, i.sale_price])).toEqual([
      ["Jordan 4 Military Black", "Sold", "2026-09-01", "2026-10-15", 100],
      ["Prismatic Evolutions ETB", "Listed", "2026-07-25", null, null]]);
    expect(p.expenses).toMatchObject([{ date: "2026-04-10", description: "Postage bags", amount: 12.5 }]);
  });
});

describe("download backup", () => {
  const data = {
    items: [{ id: "u1", name: "Dunk & <Low>", cost: 50, status: "Sold", sold: "2026-10-01", sale_price: 90, fees: 10, postage: 4, posted: true, listed: "2026-09-20" },
      { id: "u2", name: "Mocha", cost: null, status: "Listed", listed: "2026-09-01", ask_price: 185, posted: false, notes: "tab\there" }],
    orders: [{ id: "o1", item: "Tin", ordered: "2026-10-02", qty: 2, cost: 12, status: "Delivered", stocked_at: "2026-10-05T10:00:00Z", preorder: false }],
    expenses: [{ id: "e1", date: "2026-01-31", description: "Bot", category: "Software", amount: 60, repeat: "monthly", deductible: true }],
  };
  it("has a tab each for stock, orders, expenses and settings", () => {
    const s = backupSheets(data, { goal: 500, setup: { x: true }, dashHide: ["expenses"] });
    expect(s.map(t => t.name)).toEqual(["Inventory", "Orders", "Expenses", "Settings"]);
    expect(s[3].rows).toEqual([["Setting", "Value"], ["goal", 500], ["dashHide", '["expenses"]']]);
  });
  it("is a real Excel file that comes back in with nothing lost or doubled", async () => {
    const bytes = X.writeXlsx(backupSheets(data, {}));
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]); // a zip, like every .xlsx
    const back = parseImport((await X.readXlsx(bytes)).map(t => X.rowsToTsv(t.rows)));
    expect(back.items).toMatchObject([
      { name: "Dunk & <Low>", cost: 50, status: "Sold", sold: "2026-10-01", sale_price: 90, fees: 10, postage: 4, posted: true, import_id: "u1" },
      { name: "Mocha", cost: null, status: "Listed", listed: "2026-09-01", ask_price: 185, posted: false, notes: "tab here" }]);
    expect(back.orders).toMatchObject([{ item: "Tin", ordered: "2026-10-02", qty: 2, cost: 12, status: "Delivered" }]);
    expect(back.expenses).toMatchObject([{ date: "2026-01-31", description: "Bot", amount: 60, repeat: "monthly", deductible: true }]);
    const plan = planImport(data, back);
    expect([plan.items.add.length, plan.orders.add.length, plan.expenses.add.length]).toEqual([0, 0, 0]);
  });
  it("zip checksums are right", () => {
    expect(X.crc32(new TextEncoder().encode("The quick brown fox jumps over the lazy dog")).toString(16)).toBe("414fa339");
  });
});
