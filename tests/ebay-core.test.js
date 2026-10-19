// eBay sync rules (js/core.js): turning eBay orders into sales, and matching them to your stock with no duplicates.
import { describe, it, expect } from "vitest";
const R = require("../js/core.js");

// A made-up eBay order in the shape the Fulfillment API sends (buyer details left out on purpose).
const order = (id, lines, extra = {}) => ({
  orderId: id, creationDate: "2026-10-10T21:30:00.000Z", orderFulfillmentStatus: "NOT_STARTED", orderPaymentStatus: "PAID",
  cancelStatus: { cancelState: "NONE_REQUESTED" }, totalMarketplaceFee: { value: "9.90", currency: "GBP" },
  lineItems: lines.map((l, k) => ({ lineItemId: id + "-L" + (k + 1), title: "Item", quantity: 1, lineItemCost: { value: "50.00", currency: "GBP" },
    deliveryCost: { shippingCost: { value: "0.00", currency: "GBP" } }, lineItemFulfillmentStatus: "NOT_STARTED", ...l })),
  ...extra,
});
const tx = (type, orderId, fields) => ({ transactionType: type, orderId, bookingEntry: "DEBIT", ...fields });

describe("ebaySales: eBay orders into one sale per unit", () => {
  it("adds the buyer's postage to the price and takes eBay's fee total from the order", () => {
    const [u] = R.ebaySales([order("O1", [{ title: "Jordan 4 Military Black UK 9", sku: "INV-7", lineItemCost: { value: "180.00" }, deliveryCost: { shippingCost: { value: "4.99" } } }])]);
    expect(u).toEqual({ ref: "ebay:O1:O1-L1:1", title: "Jordan 4 Military Black UK 9", sku: "INV-7", sold: "2026-10-10", sale_price: 184.99, item_price: 180,
      fees: 9.9, postage: null, posted: false, cancelled: false });
  });
  it("uses the UK date (a sale at 23:30 UK time is that day, not the next)", () => {
    const [u] = R.ebaySales([order("O1", [{}], { creationDate: "2026-07-01T22:30:00.000Z" })]); // 23:30 BST on 1 July
    expect(u.sold).toBe("2026-07-01");
  });
  it("splits 2 of the same item into 2 sales, pennies kept", () => {
    const us = R.ebaySales([order("O2", [{ quantity: 2, lineItemCost: { value: "100.01" } }], { totalMarketplaceFee: { value: "13.01" } })]);
    expect(us.map(u => u.ref)).toEqual(["ebay:O2:O2-L1:1", "ebay:O2:O2-L1:2"]);
    expect(us.map(u => u.sale_price)).toEqual([50.01, 50]);
    expect(us.map(u => u.fees)).toEqual([6.51, 6.5]);
  });
  it("shares an order's fees across its lines by price", () => {
    const us = R.ebaySales([order("O3", [{ lineItemCost: { value: "30.00" } }, { lineItemCost: { value: "10.00" } }], { totalMarketplaceFee: { value: "4.00" } })]);
    expect(us.map(u => u.fees)).toEqual([3, 1]);
  });
  it("prefers the Finances API: sale fees, promoted listing fees and postage labels", () => {
    const t = [
      tx("SALE", "O1", { bookingEntry: "CREDIT", amount: { value: "170.10" }, totalFeeAmount: { value: "12.40" } }),
      tx("NON_SALE_CHARGE", "O1", { amount: { value: "3.60" }, feeType: "AD_FEE" }),
      tx("SHIPPING_LABEL", null, { amount: { value: "3.85" }, references: [{ referenceId: "O1", referenceType: "ORDER_ID" }] }),
      tx("SALE", "OTHER", { totalFeeAmount: { value: "99" } }),
    ];
    const [u] = R.ebaySales([order("O1", [{}])], t);
    expect(u).toMatchObject({ fees: 16, postage: 3.85 });
  });
  it("falls back to the order's fee total when the Finances API has nothing for that order yet", () => {
    const [u] = R.ebaySales([order("O1", [{}])], [tx("SALE", "OTHER", { totalFeeAmount: { value: "1" } })]);
    expect(u).toMatchObject({ fees: 9.9, postage: null });
  });
  it("takes off eBay discounts and partial refunds; a full refund or cancel counts as cancelled", () => {
    const [a] = R.ebaySales([order("O1", [{ appliedPromotions: [{ discountAmount: { value: "5.00" } }], refunds: [{ amount: { value: "10.00" } }] }])]);
    expect(a).toMatchObject({ sale_price: 35, item_price: 45, cancelled: false });
    expect(R.ebaySales([order("O2", [{}], { cancelStatus: { cancelState: "CANCELED" } })])[0].cancelled).toBe(true);
    expect(R.ebaySales([order("O3", [{}], { orderPaymentStatus: "FULLY_REFUNDED" })])[0].cancelled).toBe(true);
  });
  it("posted once eBay says it's dispatched", () => {
    expect(R.ebaySales([order("O1", [{ lineItemFulfillmentStatus: "FULFILLED" }])])[0].posted).toBe(true);
  });
  it("never keeps anything about the buyer", () => {
    const o = order("O1", [{}], { buyer: { username: "buyer123", buyerRegistrationAddress: { fullName: "A Person" } }, fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "A Person" } } }] });
    expect(JSON.stringify(R.ebaySales([o]))).not.toMatch(/buyer123|A Person/);
  });
});

describe("nameScore", () => {
  it("scores how much of the stock name is in the eBay title, ignoring filler and accents", () => {
    expect(R.nameScore("BNIB Pokémon Prismatic Evolutions Elite Trainer Box ETB Sealed", { name: "Pokemon Prismatic Evolutions ETB" })).toBe(1);
    expect(R.nameScore("Jordan 4 Military Black UK 9", { name: "Jordan 4 Military Black", size: "UK 10" })).toBe(0.5);
    expect(R.nameScore("Jordan 4 Military Black UK 9", { name: "Nike Tech Fleece" })).toBe(0);
  });
});

// Your tracker rows, as the database gives them.
let n = 0;
const item = f => ({ id: "i" + ++n, name: "Thing", size: "", status: "In stock", platform: "", sold: null, sale_price: null, fees: 0, postage: 0, posted: false,
  cost: 10, bought: "2026-09-01", created_at: "2026-09-01T10:00:00Z", import_id: null, source: "", source_ref: null, source_title: null, prev_status: null, needs_review: null, ...f });
const unit = f => ({ ref: "ebay:O1:L1:1", title: "Thing", sku: "", sold: "2026-10-10", sale_price: 50, item_price: 50, fees: 6, postage: null, posted: false, cancelled: false, ...f });

describe("planEbaySync: matching with no duplicates", () => {
  it("a matching SKU (custom label) is a sure match: stock becomes the sale, nothing to check", () => {
    const stock = item({ name: "Air Max 1", import_id: "INV-7", status: "Listed" });
    const p = R.planEbaySync([item({ name: "Air Max 1 Patta" }), stock], [unit({ title: "Nike Air Max 1 Patta Waves", sku: "inv-7" })]);
    expect(p.inserts).toEqual([]);
    expect(p.updates).toEqual([{ id: stock.id, patch: { status: "Sold", platform: "eBay", sold: "2026-10-10", sale_price: 50, fees: 6, postage: 0, posted: false,
      source: "ebay", source_ref: "ebay:O1:L1:1", source_title: "Nike Air Max 1 Patta Waves", prev_status: "Listed", needs_review: null } }]);
    expect(p.counts).toMatchObject({ matched: 1, review: 0 });
  });
  it("a clear name match is matched but marked to check; the listed one of two identical items goes first", () => {
    const a = item({ name: "Pokemon 151 ETB", status: "In stock", bought: "2026-08-01" }), b = item({ name: "Pokemon 151 ETB", status: "Listed", bought: "2026-09-01" });
    const p = R.planEbaySync([a, b, item({ name: "Jordan 1 Chicago" })], [unit({ title: "Pokémon TCG Scarlet & Violet 151 Elite Trainer Box ETB" })]);
    expect(p.updates[0]).toMatchObject({ id: b.id, patch: { status: "Sold", prev_status: "Listed", needs_review: "match" } });
    expect(p.counts).toMatchObject({ matched: 1, review: 1, added: 0 });
  });
  it("two different items about as good a match: no guess, a new sale to check instead", () => {
    const p = R.planEbaySync([item({ name: "Jordan 4 Black Cat" }), item({ name: "Jordan 4 Military Black" })], [unit({ title: "Jordan 4 Black UK 9" })]);
    expect(p.updates).toEqual([]);
    expect(p.inserts).toEqual([{ name: "Jordan 4 Black UK 9", category: "", size: "", cost: null, status: "Sold", platform: "eBay", sold: "2026-10-10", sale_price: 50, fees: 6, postage: 0,
      posted: false, source: "ebay", source_ref: "ebay:O1:L1:1", source_title: "Jordan 4 Black UK 9", prev_status: null, needs_review: "new" }]);
  });
  it("the wrong size isn't matched", () => {
    const p = R.planEbaySync([item({ name: "Jordan 4 Military Black", size: "UK 10" })], [unit({ title: "Jordan 4 Military Black UK 9" })]);
    expect(p.inserts).toHaveLength(1);
  });
  it("2 sold in one order use 2 stock items", () => {
    const a = item({ name: "Surging Sparks Booster Bundle" }), b = item({ name: "Surging Sparks Booster Bundle" });
    const p = R.planEbaySync([a, b], [unit({ ref: "ebay:O1:L1:1", title: "Surging Sparks Booster Bundle" }), unit({ ref: "ebay:O1:L1:2", title: "Surging Sparks Booster Bundle" })]);
    expect(p.updates.map(u => u.id).sort()).toEqual([a.id, b.id].sort());
    expect(p.inserts).toEqual([]);
  });
  it("links a sale already in your tracker (old spreadsheet) instead of adding it, keeping your own figures", () => {
    const old = item({ name: "Jordan 4 Military Black", status: "Sold", platform: "eBay", sold: "2026-10-11", sale_price: 180, fees: 0, posted: true });
    const p = R.planEbaySync([old], [unit({ title: "Jordan 4 Military Black UK 9", sale_price: 184.99, item_price: 180, fees: 12.5 })]);
    expect(p.inserts).toEqual([]);
    expect(p.updates).toEqual([{ id: old.id, patch: { source: "ebay", source_ref: "ebay:O1:L1:1", source_title: "Jordan 4 Military Black UK 9", prev_status: "Sold", fees: 12.5 } }]);
    expect(p.counts.linked).toBe(1);
  });
  it("doesn't link a different sale (wrong platform, a week apart, or a different price)", () => {
    const u = unit({ title: "Jordan 4 Military Black" });
    for (const f of [{ platform: "Vinted" }, { sold: "2026-10-17" }, { sale_price: 70 }]) {
      const p = R.planEbaySync([item({ name: "Jordan 4 Military Black", status: "Sold", platform: "eBay", sold: "2026-10-10", sale_price: 50, ...f })], [u]);
      expect(p.counts.linked).toBe(0);
    }
  });
  it("syncing the same sales again adds nothing and changes nothing", () => {
    const units = [unit({ title: "Nike Tech Fleece Grey M", sale_price: 60 })];
    const first = R.planEbaySync([], units);
    const stored = first.inserts.map(r => item(r));
    const again = R.planEbaySync(stored, units);
    expect(again).toEqual({ inserts: [], updates: [], deletes: [], counts: { added: 0, matched: 0, linked: 0, updated: 0, undone: 0, review: 0 } });
  });
  it("updates fees, postage and posted when eBay has news, but keeps postage you typed when eBay has none", () => {
    const had = item({ status: "Sold", source: "ebay", source_ref: "ebay:O1:L1:1", sale_price: 50, fees: 0, postage: 3.2, prev_status: "In stock" });
    expect(R.planEbaySync([had], [unit({ fees: 6.4, posted: true })]).updates).toEqual([{ id: had.id, patch: { fees: 6.4, posted: true } }]);
    expect(R.planEbaySync([had], [unit({ fees: 0, postage: 3.85 })]).updates).toEqual([{ id: had.id, patch: { postage: 3.85 } }]);
  });
  it("a cancelled sale is undone: matched stock goes back, an added sale is removed, a sale you recorded yourself is flagged", () => {
    const matched = item({ status: "Sold", source_ref: "ebay:A:1:1", prev_status: "Listed", needs_review: "match" });
    const added = item({ status: "Sold", source_ref: "ebay:B:1:1", cost: null, needs_review: "new" });
    const returned = item({ status: "Sold", source_ref: "ebay:C:1:1", cost: 30 });
    const mine = item({ status: "Sold", source_ref: "ebay:D:1:1", prev_status: "Sold" });
    const p = R.planEbaySync([matched, added, returned, mine], ["A", "B", "C", "D"].map(o => unit({ ref: `ebay:${o}:1:1`, cancelled: true })));
    expect(p.deletes).toEqual([added.id]);
    expect(p.updates).toEqual([
      { id: matched.id, patch: expect.objectContaining({ status: "Listed", sold: null, sale_price: null, source_ref: null, prev_status: null, needs_review: null }) },
      { id: returned.id, patch: expect.objectContaining({ status: "In stock", source_ref: null }) },
      { id: mine.id, patch: { needs_review: "cancelled" } },
    ]);
    expect(p.counts).toMatchObject({ undone: 3, review: 1 });
  });
  it("a sale cancelled before it ever came in is ignored", () => {
    expect(R.planEbaySync([item({ name: "Thing" })], [unit({ cancelled: true })]).updates).toEqual([]);
  });
});

describe("dashboard: eBay sales to check", () => {
  it("come first in Needs action, without a separate 'no cost' nag", () => {
    const items = [item({ name: "Jordan 4 Black UK 9", status: "Sold", sold: "2026-10-10", sale_price: 50, cost: null, needs_review: "new" }),
      item({ name: "151 ETB", status: "Sold", sold: "2026-10-10", sale_price: 50, needs_review: "match", posted: true })];
    const d = R.dashboard({ items }, {}, new Date(2026, 9, 18, 9));
    expect(d.actions.slice(0, 2).map(a => [a.kind, a.title])).toEqual([["review", "Check eBay sale: Jordan 4 Black UK 9"], ["review", "Check eBay sale: 151 ETB"]]);
    expect(d.actions.some(a => /has no cost/.test(a.title))).toBe(false);
    expect(d.summary).toBe("2 eBay sales to check and 1 sale to post.");
  });
});
