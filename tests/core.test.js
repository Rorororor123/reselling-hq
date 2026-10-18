// Tests for the weekly check maths and tracker reading in js/core.js.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import RHQ from "../js/core.js";

const { taxYear, parseDate, num, splitLine, tableFrom, normInventory, normExpenses, crunch, looseJson, gbp, esc } = RHQ;
const fixture = name => fs.readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const ymd = d => d && [d.getFullYear(), d.getMonth() + 1, d.getDate()];

describe("taxYear", () => {
  it("5 April belongs to the tax year before", () => {
    expect(taxYear(new Date(2026, 3, 5, 12)).label).toBe("2025/26");
  });
  it("6 April starts the new tax year", () => {
    const ty = taxYear(new Date(2026, 3, 6));
    expect(ty.label).toBe("2026/27");
    expect(ymd(ty.start)).toEqual([2026, 4, 6]);
    expect(ymd(ty.end)).toEqual([2027, 4, 5]);
  });
  it("January is still in the tax year that started the April before", () => {
    expect(taxYear(new Date(2027, 0, 15)).label).toBe("2026/27");
  });
  it("the last minute of 5 April is inside the year", () => {
    const ty = taxYear(new Date(2026, 9, 18));
    expect(new Date(2027, 3, 5, 23, 59) <= ty.end).toBe(true);
    expect(new Date(2027, 3, 6) > ty.end).toBe(true);
  });
});

describe("parseDate", () => {
  it("reads UK dates", () => {
    expect(ymd(parseDate("15/10/2026"))).toEqual([2026, 10, 15]);
    expect(ymd(parseDate("1/5/26"))).toEqual([2026, 5, 1]);
    expect(ymd(parseDate("01.05.2026"))).toEqual([2026, 5, 1]);
    expect(ymd(parseDate("01-05-2026"))).toEqual([2026, 5, 1]);
  });
  it("reads ISO dates", () => {
    expect(ymd(parseDate("2026-10-15"))).toEqual([2026, 10, 15]);
  });
  it("reads Excel and Google Sheets date numbers", () => {
    expect(parseDate(46310).toISOString().slice(0, 10)).toBe("2026-10-15");
    expect(parseDate("46310").toISOString().slice(0, 10)).toBe("2026-10-15");
  });
  it("returns null for blanks and nonsense", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate(null)).toBeNull();
    expect(parseDate("not a date")).toBeNull();
  });
});

describe("num", () => {
  it("reads pounds with symbols and commas", () => {
    expect(num("£1,234.50")).toBe(1234.5);
    expect(num(" 12 ")).toBe(12);
    expect(num("-£3.20")).toBe(-3.2);
    expect(num("-3.20")).toBe(-3.2);
  });
  it("treats blanks and text as 0", () => {
    expect(num("")).toBe(0);
    expect(num(null)).toBe(0);
    expect(num("n/a")).toBe(0);
  });
});

describe("splitLine", () => {
  it("keeps commas inside quotes", () => {
    expect(splitLine('A1,"Jacket, brown",£10', ",")).toEqual(["A1", "Jacket, brown", "£10"]);
  });
  it("handles doubled quotes inside quotes", () => {
    expect(splitLine('"The ""OG"" box",2', ",")).toEqual(['The "OG" box', "2"]);
  });
  it("splits tabs and pipe tables", () => {
    expect(splitLine("a\tb\tc", "\t")).toEqual(["a", "b", "c"]);
    expect(splitLine("| a | b | c |", "|")).toEqual(["a", "b", "c"]);
  });
});

describe("tableFrom", () => {
  it("finds the inventory header even when it isn't the first line", () => {
    const rows = tableFrom(fixture("tracker.csv"), "item name");
    expect(rows).toHaveLength(8);
    expect(rows[0]["item name"]).toBe("Example: Nike Dunk Low");
    expect(Object.keys(rows[0])).toContain("cost");      // "(£)" removed from headers
    expect(Object.keys(rows[0])).toContain("sale price");
    expect(rows[2]["item name"]).toBe("Carhartt Detroit jacket, brown");
  });
  it("reads tab-separated text (pasted from a spreadsheet)", () => {
    const text = "Item ID\tItem Name\tCategory\tCost\nA1\tDunk\tShoes\t20\n";
    expect(tableFrom(text, "item name")).toEqual([{ "item id": "A1", "item name": "Dunk", category: "Shoes", cost: "20" }]);
  });
  it("reads markdown tables and skips the --- line", () => {
    const text = "| Date | Description | Category | Amount |\n|---|---|---|---|\n| 10/04/2026 | Bags | Packaging | £5 |\n";
    expect(tableFrom(text, "amount")).toEqual([{ date: "10/04/2026", description: "Bags", category: "Packaging", amount: "£5" }]);
  });
  it("returns null when there's no matching table", () => {
    expect(tableFrom("hello\nworld", "item name")).toBeNull();
  });
});

describe("normInventory and normExpenses", () => {
  const inv = normInventory(tableFrom(fixture("tracker.csv"), "item name"));
  const exp = normExpenses(tableFrom(fixture("expenses.csv"), "amount"));
  it("drops Example rows", () => {
    expect(inv).toHaveLength(7);
    expect(inv.some(r => /example/i.test(r.name))).toBe(false);
    expect(exp).toHaveLength(2);
  });
  it("reads money, dates, platform and blank sale prices", () => {
    const s1 = inv.find(r => r.id === "S1");
    expect(s1).toMatchObject({ name: "Jordan 4 Military Black", cost: 60, sale: 100, fees: 13, post: 4, platform: "eBay", status: "Sold" });
    expect(ymd(s1.sold)).toEqual([2026, 10, 15]);
    expect(inv.find(r => r.id === "P1").sale).toBeNull();
    expect(exp[0]).toMatchObject({ desc: "Postage bags", amount: 12.5 });
  });
});

describe("crunch (the weekly numbers)", () => {
  const now = new Date(2026, 9, 18, 9); // Sunday 18 October 2026, 9am
  const inv = normInventory(tableFrom(fixture("tracker.csv"), "item name"));
  const exp = normExpenses(tableFrom(fixture("expenses.csv"), "amount"));
  const n = crunch(inv, exp, { stale: 30, stalePk: 90 }, now);

  it("labels the tax year", () => expect(n.taxYear).toBe("2026/27"));
  it("counts items", () => {
    expect(n.counts).toEqual({ items: 7, sold: 3, inStock: 4, stale: 2 });
    expect(n.stockValue).toBe(130);
  });
  it("works out profit per sale as sale - cost - fees - postage", () => {
    expect(inv.find(r => r.id === "S1").profit).toBe(23);
    expect(inv.find(r => r.id === "C1").profit).toBe(15);
    expect(inv.find(r => r.id === "S2").profit).toBe(-19);
  });
  it("only counts the last 7 days for the week", () => {
    expect(n.week).toEqual({ sales: 100, profit: 23, count: 1 });
  });
  it("only counts this tax year's sales and expenses", () => {
    expect(n.ty).toEqual({ sales: 125, cogs: 70, fees: 13, post: 4, expenses: 12.5, count: 2 });
  });
  it("uses 30 days for stale stock but 90 days for Pokémon, oldest first", () => {
    expect(n.stale.map(s => [s.name, s.days, s.limit])).toEqual([
      ["Paldean Fates booster bundle", 139, 90],
      ["New Balance 550", 47, 30],
    ]);
    // Prismatic ETB has been listed 78 days: under the Pokémon limit, so not stale.
    expect(n.stale.some(s => /Prismatic/.test(s.name))).toBe(false);
  });
  it("follows the stale-day settings", () => {
    const strict = crunch(normInventory(tableFrom(fixture("tracker.csv"), "item name")), exp, { stale: 30, stalePk: 60 }, now);
    expect(strict.stale.map(s => s.name)).toContain("Prismatic Evolutions ETB");
  });
  it("splits sales by category and platform", () => {
    const shoes = n.byCat.find(c => c.name === "Shoes");
    expect(shoes).toMatchObject({ sales: 190, profit: 4, count: 2 });
    expect(shoes.margin).toBeCloseTo(0.025);
    expect(n.byCat.find(c => c.name === "Pokémon").count).toBe(0);
    expect(n.byPlat.map(p => [p.name, p.count, p.profit])).toEqual([["eBay", 1, 23], ["Vinted", 1, 15], ["StockX", 1, -19]]);
  });
  it("flags tracker problems", () => {
    expect(n.issues).toEqual(["Yeezy 350 Zebra: sold at a loss (-£19.00)", "Stone Island overshirt: no cost entered"]);
  });
});

describe("helpers", () => {
  it("formats pounds the UK way", () => {
    expect(gbp(1234.5)).toBe("£1,234.50");
    expect(gbp(-19)).toBe("-£19.00");
    expect(gbp(undefined)).toBe("£0.00");
  });
  it("escapes HTML", () => expect(esc('<b>"x"&</b>')).toBe("&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;"));
  it("pulls JSON out of Claude's answer", () => {
    expect(looseJson('{"a":1}')).toEqual({ a: 1 });
    expect(looseJson('Here you go:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(looseJson('Sure! {"a":3} Hope that helps')).toEqual({ a: 3 });
    expect(() => looseJson("no json here")).toThrow();
  });
});
