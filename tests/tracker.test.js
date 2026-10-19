// The dashboard and Orders screen maths in js/core.js, against a small made-up tracker.
import { describe, it, expect } from "vitest";
import RHQ from "../js/core.js";
const { dashboard, chartSeries, expenseDates, orderCounts, orderFilter, orderMatches, orderStep, orderLabel, nextStatus, isPreorder } = RHQ;

const NOW = new Date(2026, 9, 19, 14, 0); // Monday 19 October 2026, 2pm
const sold = (name, sold, sale, cost, extra = {}) => ({ id: name + sold, name, status: "Sold", sold, sale_price: sale, cost, fees: 0, postage: 0, posted: true, platform: "eBay", category: "Shoes", ...extra });
const items = [
  sold("Dunk Low", "2026-10-19", 100, 60, { fees: 13, postage: 4 }),                 // this week: 23 profit
  sold("Dunk Low", "2026-10-12", 90, 60, { platform: "Vinted" }),                    // this month: 30
  sold("Pokémon 151 bundle", "2026-10-02", 48, 25, { category: "Pokémon", posted: false }), // this month: 23
  sold("Pokémon 151 bundle", "2026-10-03", 48, 25, { category: "Pokémon" }),         // this month: 23
  sold("Old jacket", "2026-04-05", 50, 10, { category: "Clothing" }),                // last tax year
  sold("Spring jacket", "2026-04-06", 40, 10, { category: "Clothing", platform: "Vinted" }), // first day of this tax year: 30
  sold("September tee", "2026-09-10", 30, 10, { category: "Clothing" }),             // last month, by the 19th: 20
  { id: "s1", name: "Jordan 4", status: "Listed", cost: 150, ask_price: 200, listed: "2026-09-01", category: "Shoes" },       // 48 days > 30
  { id: "s2", name: "Paldean Fates ETB", status: "Listed", cost: 45, listed: "2026-08-01", category: "Pokémon TCG" },        // 79 days < 90
  { id: "s3", name: "Stone Island overshirt", status: "In stock", cost: null },
];
const orders = [
  { id: "o1", item: "Prismatic ETB", shop: "Pokémon Center", status: "Out for delivery", cost: 59.99, ordered: "2026-10-15", status_at: "2026-10-19T08:00:00Z" },
  { id: "o2", item: "Dunk Low Panda", shop: "Nike", status: "Shipped", cost: 99.99, ordered: "2026-10-14", tracking: "1550 2938", courier: "DPD" },
  { id: "o3", item: "Mini tin", shop: "Pokémon Center", status: "Ordered", cost: 11.99, ordered: "2026-10-05" },          // 14 days, not shipped
  { id: "o4", item: "Surging Sparks box", shop: "Smyths", status: "Ordered", cost: 129.99, ordered: "2026-10-02", preorder: true, release: "2026-10-24" },
  { id: "o5", item: "Late pre-order", status: "Ordered", cost: 20, ordered: "2026-09-01", preorder: true, release: "2026-10-01" }, // release passed: normal order now
  { id: "o6", item: "Crewneck", status: "Delivered", cost: 85, ordered: "2026-10-10", status_at: "2026-10-13T10:00:00Z" },
  { id: "o7", item: "Old delivery", status: "Delivered", cost: 5, ordered: "2026-09-01", status_at: "2026-09-05T10:00:00Z", stocked_at: "2026-09-05T11:00:00Z" },
  { id: "o8", item: "Moltres tin", status: "Cancelled", cost: 11.99, ordered: "2026-10-15" },
];
const expenses = [
  { id: "e1", date: "2026-01-31", description: "Bot subscription", category: "Software and bots", amount: 60, repeat: "monthly", deductible: true },
  { id: "e2", date: "2026-10-03", description: "Postage bags", category: "Packaging and postage", amount: 12.5, repeat: "once", deductible: true },
  { id: "e3", date: "2026-05-10", description: "Proxies yearly", category: "Proxies", amount: 120, repeat: "yearly", deductible: true },
  { id: "e4", date: "2026-10-05", description: "Takeaway", category: "Other", amount: 9, repeat: "once", deductible: false },
  { id: "e5", date: "2026-06-01", description: "Old tool", category: "Software and bots", amount: 10, repeat: "monthly", end_date: "2026-08-31" },
];
const settings = { stale: 30, stalePk: 90, goal: 200 };
const d = dashboard({ items, orders, expenses }, settings, NOW);

describe("dashboard profit", () => {
  it("week (from Monday), month and tax year (from 6 April)", () => {
    expect(d.profit.week).toEqual({ revenue: 100, profit: 23, count: 1 });
    expect(d.profit.month).toMatchObject({ revenue: 286, profit: 99, count: 4 });
    expect(d.profit.taxYear).toMatchObject({ revenue: 356, profit: 149, count: 6 }); // not the 5 April sale
  });
  it("takes expenses off for the month and the tax year", () => {
    // October: bot 60 (31st -> 31 Oct) + bags 12.5 + takeaway 9 = 81.5
    expect(d.profit.month.expenses).toBeCloseTo(81.5);
    expect(d.profit.month.afterExpenses).toBeCloseTo(17.5);
    // Tax year to today: bot Apr-Sep (6 x 60, the October one is on the 31st) + proxies 120 + old tool Jun-Aug 30 + 12.5 + 9
    expect(d.profit.taxYear.expenses).toBeCloseTo(360 + 120 + 30 + 21.5);
  });
  it("compares with the same days of last month", () => {
    expect(d.profit.month.lastMonthSameDay).toBe(20);
  });
});

describe("orders, pre-orders and stock", () => {
  it("counts what's on the way, without pre-orders", () => {
    expect(d.pending).toEqual({ count: 4, committed: 59.99 + 99.99 + 11.99 + 20, oldestDays: 48, outForDelivery: 1 });
  });
  it("keeps paid-but-not-released pre-orders separate", () => {
    expect(d.preorders.count).toBe(1);
    expect(d.preorders.paid).toBe(129.99);
    expect(d.preorders.nextRelease).toEqual(new Date(2026, 9, 24));
  });
  it("stock held, cost and estimated value (asking price, else cost)", () => {
    expect(d.stock).toEqual({ count: 3, cost: 195, value: 245, listed: 2 });
  });
  it("monthly goal", () => {
    expect(d.goal).toMatchObject({ target: 200, profit: 99, toGo: 101, daysLeft: 12 });
    expect(d.goal.pct).toBeCloseTo(0.495);
    expect(dashboard({ items }, {}, NOW).goal.pct).toBe(0);
  });
});

describe("best seller this month", () => {
  it("by units, profit or revenue", () => {
    expect(d.best.units).toMatchObject({ name: "Dunk Low", units: 2, avgProfit: 26.5, platform: "eBay" }); // a tie on units goes to more profit
    const more = dashboard({ items: [...items, sold("pokémon 151  bundle", "2026-10-04", 48, 25)] }, {}, NOW);
    expect(more.best.units).toMatchObject({ name: "Pokémon 151 bundle", units: 3, profit: 69, avgProfit: 23 });
    expect(d.best.profit.name).toBe("Dunk Low"); // 53 profit
    expect(d.best.revenue).toMatchObject({ name: "Dunk Low", revenue: 190 });
    expect(dashboard({}, {}, NOW).best.units).toBeNull();
  });
});

describe("expenses", () => {
  it("one-off vs recurring, total, biggest, tax-deductible and by category", () => {
    expect(d.expenses).toMatchObject({ month: 81.5, oneOff: 21.5, recurring: 60, recurringPerMonth: 70, recurringCount: 2, deductible: 72.5, biggest: { name: "Bot subscription", amount: 60 } });
    expect(d.expenses.byCategory[0]).toEqual({ name: "Software and bots", amount: 60 });
  });
  it("repeats monthly on the same day, using the last day of shorter months, and stops at the end date", () => {
    const e = { date: "2026-01-31", amount: 1, repeat: "monthly" };
    expect(expenseDates(e, new Date(2026, 1, 1), new Date(2026, 3, 30)).map(x => x.getDate())).toEqual([28, 31, 30]);
    expect(expenseDates({ ...e, end_date: "2026-02-28" }, new Date(2026, 0, 1), new Date(2026, 11, 31))).toHaveLength(2);
    expect(expenseDates({ date: "2025-05-10", amount: 1, repeat: "yearly" }, new Date(2026, 0, 1), new Date(2026, 11, 31))).toEqual([new Date(2026, 4, 10)]);
    expect(expenseDates({ date: "2026-10-03", amount: 1 }, new Date(2026, 9, 4), new Date(2026, 9, 31))).toEqual([]);
  });
});

describe("needs action", () => {
  const titles = d.actions.map(a => a.title);
  it("lists stale listings by your own limits", () => {
    expect(titles).toContain("Jordan 4, 48 days listed");
    expect(titles.join()).not.toContain("Paldean Fates ETB,");
  });
  it("sales to post, deliveries to stock, unshipped orders, releases and missing info", () => {
    expect(titles).toContain("1 sale to post");
    expect(titles).toContain("1 delivered order to move into stock");
    expect(titles).toContain("Mini tin hasn't shipped");
    expect(titles).toContain("Surging Sparks box releases 24 Oct");
    expect(titles).toContain("Stone Island overshirt has no cost");
  });
  it("starts with the most urgent", () => {
    expect(d.actions[0].level).toBe("bad");
  });
  it("is empty for an empty tracker", () => {
    expect(dashboard({}, settings, NOW).actions).toEqual([]);
  });
});

describe("activity, breakdowns and summary", () => {
  it("newest first, with status labels", () => {
    expect(d.activity[0]).toMatchObject({ title: "Prismatic ETB", status: "Out for delivery" });
    const few = dashboard({ orders: orders.slice(2, 5) }, {}, NOW).activity;
    expect(few.map(a => a.title)).toEqual(["Mini tin", "Surging Sparks box", "Late pre-order"]);
    expect(few[1]).toMatchObject({ status: "Pre-order", kind: "preorder", meta: "Pre-order · Smyths · releases 24 Oct" });
    expect(d.activity.find(a => a.kind === "sale")).toMatchObject({ status: "Sold" });
    expect(d.activity).toHaveLength(8);
  });
  it("profit by platform and category for the tax year", () => {
    expect(d.byPlatform.map(p => [p.name, p.profit])).toEqual([["eBay", 89], ["Vinted", 60]]);
    expect(d.byCategory.map(p => [p.name, p.profit])).toEqual([["Shoes", 53], ["Clothing", 50], ["Pokémon", 46]]);
  });
  it("one plain sentence", () => {
    expect(d.summary).toBe("1 order out for delivery, 1 listing past your stale limit and 1 sale to post.");
  });
});

describe("chart", () => {
  it("7, 30 and 90 days are daily up to today", () => {
    const c = chartSeries(items, "7d", NOW);
    expect(c.buckets).toHaveLength(7);
    expect(c.buckets.at(-1)).toMatchObject({ label: "19 Oct", revenue: 100, profit: 23 });
    expect(c.revenue).toBe(100);
    expect(chartSeries(items, "30d", NOW).profit).toBe(99); // from 20 September
    expect(chartSeries(items, "90d", NOW).buckets).toHaveLength(90);
  });
  it("this month starts on the 1st; all time goes monthly for long spans", () => {
    expect(chartSeries(items, "month", NOW).buckets).toHaveLength(19);
    const all = chartSeries(items, "all", NOW);
    expect(all.monthly).toBe(true);
    expect(all.buckets[0].label).toBe("Apr 26");
    expect(all.revenue).toBe(406);
  });
  it("copes with no sales", () => {
    expect(chartSeries([], "all", NOW).buckets).toHaveLength(30);
  });
});

describe("Orders screen helpers", () => {
  it("counts per status, with delivered in the last 7 days", () => {
    expect(orderCounts(orders, NOW)).toMatchObject({ Ordered: 2, Shipped: 1, "Out for delivery": 1, Delivered: 1, Cancelled: 1, all: 8, onTheWay: 4, delivered: 2, preorders: 1 });
  });
  it("filters and search", () => {
    expect(orders.filter(orderFilter("preorders", NOW)).map(o => o.id)).toEqual(["o4"]);
    expect(orders.filter(orderFilter("onTheWay", NOW)).map(o => o.id)).toEqual(["o1", "o2", "o3", "o5"]);
    expect(orders.filter(o => orderMatches(o, "dpd")).map(o => o.id)).toEqual(["o2"]);
    expect(orders.filter(o => orderMatches(o, "  pokémon  center")).length).toBe(2);
  });
  it("progress bar, labels and the next status", () => {
    expect(orderStep(orders[0], NOW)).toEqual({ steps: 3, tone: "on" });
    expect(orderStep(orders[3], NOW)).toEqual({ steps: 1, tone: "warn" });
    expect(orderStep(orders[5], NOW)).toEqual({ steps: 4, tone: "good" });
    expect(orderStep(orders[7], NOW)).toEqual({ steps: 4, tone: "bad" });
    expect(orderLabel(orders[3], NOW)).toBe("Pre-order");
    expect(orderLabel(orders[4], NOW)).toBe("Ordered");
    expect(isPreorder({ preorder: true, status: "Ordered", release: "2026-10-19" }, NOW)).toBe(true); // release day itself
    expect(nextStatus(orders[1])).toBe("Out for delivery");
    expect(nextStatus(orders[5])).toBeNull();
  });
});
