// Reselling HQ core: the weekly check maths and tracker reading. No screen code here,
// so the same file runs in the browser (as window.RHQ) and in the tests (require).
(function (root) {
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const gbp = n => (n < 0 ? "-£" : "£") + Math.abs(n || 0).toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
const DAY = 86400000;

/* ---------- tax year ---------- */
function taxYear(d = new Date()) {
  const y = d.getFullYear(), start = new Date(y, 3, 6);
  const s = d >= start ? start : new Date(y - 1, 3, 6);
  const e = new Date(s.getFullYear() + 1, 3, 5, 23, 59, 59);
  return {start:s, end:e, label: s.getFullYear() + "/" + String(s.getFullYear() + 1).slice(2)};
}

function looseJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cands = [text, fence && fence[1]];
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) cands.push(text.slice(a, b + 1));
  for (const c of cands) { if (!c) continue; try { return JSON.parse(c); } catch {} }
  throw {code: "invalid_json", text};
}

/* ---------- parsing ---------- */
function parseDate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v).trim())) { const n = Number(v); return new Date(Date.UTC(1899, 11, 30) + n * DAY); }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]); }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s); return isNaN(d) ? null : d;
}
const num = v => { if (v == null) return 0; const n = parseFloat(String(v).replace(/[£,\s]/g, "")); return isNaN(n) ? 0 : n; };

function splitLine(line, delim) {
  if (delim === "|") return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim());
  if (delim === "\t") return line.split("\t").map(c => c.trim());
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { out.push(cur.trim()); cur = ""; } else cur += c; }
  out.push(cur.trim()); return out;
}
// Find a table in text whose header contains `must`, return array of objects keyed by lowercased header.
function tableFrom(text, must) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].toLowerCase().includes(must)) continue;
    const delim = lines[i].includes("\t") ? "\t" : lines[i].includes("|") ? "|" : ",";
    const head = splitLine(lines[i], delim).map(h => h.toLowerCase().replace(/\(.*?\)/g, "").trim());
    if (head.length < 4) continue;
    const rows = [];
    for (let j = i + 1; j < lines.length; j++) {
      const L = lines[j]; if (!L.trim()) { if (rows.length) break; else continue; }
      if (/^\s*\|?\s*:?-{3,}/.test(L)) continue;
      const cells = splitLine(L, delim);
      if (cells.length < 3) break;
      const o = {}; head.forEach((h, k) => o[h] = cells[k] ?? ""); rows.push(o);
    }
    return rows;
  }
  return null;
}
const pick = (o, ...keys) => { for (const k of keys) for (const h in o) if (h.startsWith(k)) return o[h]; return ""; };
function normInventory(rows) {
  return rows.map(r => ({
    id: pick(r,"item id"), name: pick(r,"item name","item","name"), category: pick(r,"category"), size: pick(r,"size"),
    cost: num(pick(r,"cost")), status: String(pick(r,"status")).trim(), listed: parseDate(pick(r,"date listed")),
    bought: parseDate(pick(r,"date bought")), platform: pick(r,"platform"), sold: parseDate(pick(r,"date sold")),
    sale: pick(r,"sale price") === "" ? null : num(pick(r,"sale price")), fees: num(pick(r,"platform fees","fees")), post: num(pick(r,"postage"))
  })).filter(r => r.name && !/^example/i.test(r.name) && !/^ex-/i.test(r.id));
}
function normExpenses(rows) {
  return (rows || []).map(r => ({date: parseDate(pick(r,"date")), desc: pick(r,"description"), cat: pick(r,"category"), amount: num(pick(r,"amount"))}))
    .filter(r => r.amount && !/^example/i.test(r.desc));
}

/* ---------- numbers ---------- */
// settings: {stale, stalePk} day limits. now: today's date (tests pass a fixed one).
function crunch(inv, exp, settings, now = new Date()) {
  const TY = taxYear(now), inTY = d => d && d >= TY.start && d <= TY.end;
  const sold = inv.filter(r => r.sale != null && (r.sold || /sold/i.test(r.status)));
  sold.forEach(r => r.profit = r.sale - r.cost - r.fees - r.post);
  const unsold = inv.filter(r => !/sold/i.test(r.status) && r.sale == null);
  const stale = unsold.filter(r => /listed/i.test(r.status) && r.listed).map(r => {
    const days = Math.floor((now - r.listed) / DAY);
    const limit = /pok/i.test(r.category) ? settings.stalePk : settings.stale;
    return {...r, days, limit};
  }).filter(r => r.days > r.limit).sort((a, b) => b.days - a.days);
  const tySold = sold.filter(r => inTY(r.sold)), tyExp = exp.filter(r => inTY(r.date));
  const sum = (a, f) => a.reduce((t, r) => t + (f(r) || 0), 0);
  const group = (key, vals) => vals.map(v => {
    const s = sold.filter(r => String(r[key]).toLowerCase().startsWith(v.toLowerCase().slice(0, 4)));
    return {name: v, sales: sum(s, r => r.sale), profit: sum(s, r => r.profit), count: s.length,
      margin: sum(s, r => r.cost) ? sum(s, r => r.profit) / sum(s, r => r.cost) : 0};
  });
  const last7 = sold.filter(r => r.sold && now - r.sold <= 7 * DAY);
  const issues = [];
  inv.forEach(r => {
    if (!r.cost) issues.push(r.name + ": no cost entered");
    if (r.sale != null && !r.sold) issues.push(r.name + ": sale price but no date sold");
    if (r.sale != null && !r.fees && !/stockx/i.test(r.platform) ) {}
    if (r.sale != null && r.profit < 0) issues.push(r.name + ": sold at a loss (" + gbp(r.profit) + ")");
    if (/listed/i.test(r.status) && !r.listed) issues.push(r.name + ": listed but no date listed");
  });
  return {
    when: now.toISOString(), taxYear: TY.label,
    counts: {items: inv.length, sold: sold.length, inStock: unsold.length, stale: stale.length},
    stockValue: sum(unsold, r => r.cost),
    week: {sales: sum(last7, r => r.sale), profit: sum(last7, r => r.profit), count: last7.length},
    ty: {sales: sum(tySold, r => r.sale), cogs: sum(tySold, r => r.cost), fees: sum(tySold, r => r.fees), post: sum(tySold, r => r.post),
         expenses: sum(tyExp, r => r.amount), count: tySold.length},
    byCat: group("category", ["Pokémon", "Shoes", "Clothing"]),
    byPlat: group("platform", ["eBay", "Vinted", "StockX"]),
    stale: stale.slice(0, 25).map(r => ({name: r.name, category: r.category, size: r.size, cost: r.cost, days: r.days, limit: r.limit})),
    issues: issues.slice(0, 20)
  };
}


/* ---------- built-in tracker ---------- */
// Rows come from the database: money as numbers (or null), dates as "YYYY-MM-DD" text.
const ORDER_STATUSES = ["Ordered", "Shipped", "Out for delivery", "Delivered", "Cancelled"];
const ON_THE_WAY = ["Ordered", "Shipped", "Out for delivery"];
const day0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysBetween = (a, b) => Math.round((day0(b) - day0(a)) / DAY);
const money = v => v == null || v === "" ? null : num(v);
const isSold = i => i.status === "Sold";
const saleProfit = i => (money(i.sale_price) || 0) - (money(i.cost) || 0) - (money(i.fees) || 0) - (money(i.postage) || 0);
const weekStart = now => { const d = day0(now); return addDays(d, -((d.getDay() + 6) % 7)); }; // Monday
const monthStart = now => new Date(now.getFullYear(), now.getMonth(), 1);
const nameKey = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const label = (s, other = "Other") => { const t = String(s || "").trim(); return t || other; };
const shortDate = d => d.toLocaleDateString("en-GB", {day: "numeric", month: "short"});

// A pre-order is paid for but not released yet; once the release date passes it counts as a normal order.
function isPreorder(o, now = new Date()) {
  if (!o.preorder || o.status !== "Ordered") return false;
  const r = parseDate(o.release);
  return !r || r >= day0(now);
}
function orderLabel(o, now = new Date()) { return isPreorder(o, now) ? "Pre-order" : o.status; }
// Progress bar: how many of the 4 steps are lit, and in which colour.
function orderStep(o, now = new Date()) {
  if (o.status === "Cancelled") return {steps: 4, tone: "bad"};
  if (isPreorder(o, now)) return {steps: 1, tone: "warn"};
  const n = {"Ordered": 1, "Shipped": 2, "Out for delivery": 3, "Delivered": 4}[o.status] || 1;
  return {steps: n, tone: n === 4 ? "good" : "on"};
}
const nextStatus = o => ({"Ordered": "Shipped", "Shipped": "Out for delivery", "Out for delivery": "Delivered"}[o.status] || null);

// Counts for the Orders screen and its filter chips.
function orderCounts(orders, now = new Date()) {
  const week = addDays(day0(now), -7);
  const c = {Ordered: 0, Shipped: 0, "Out for delivery": 0, Delivered: 0, Cancelled: 0, all: orders.length, onTheWay: 0, delivered: 0, preorders: 0, cancelled: 0};
  for (const o of orders) {
    const pre = isPreorder(o, now);
    if (pre) c.preorders++;
    if (ON_THE_WAY.includes(o.status)) { if (!pre) { c[o.status]++; c.onTheWay++; } }
    else if (o.status === "Delivered") { c.delivered++; if (new Date(o.status_at || o.ordered) >= week) c.Delivered++; }
    else if (o.status === "Cancelled") { c.Cancelled++; c.cancelled++; }
  }
  return c;
}
function orderFilter(filter, now = new Date()) {
  return {
    all: () => true,
    onTheWay: o => ON_THE_WAY.includes(o.status) && !isPreorder(o, now),
    delivered: o => o.status === "Delivered",
    preorders: o => isPreorder(o, now),
    cancelled: o => o.status === "Cancelled",
  }[filter] || (() => true);
}
function orderMatches(o, q) {
  q = nameKey(q); if (!q) return true;
  return [o.item, o.shop, o.order_ref, o.tracking, o.courier, o.size].some(v => nameKey(v).includes(q));
}

// Every date an expense falls on between from and to (inclusive). Monthly and yearly ones repeat
// on the same day (the last day of shorter months) until their end date.
function expenseDates(e, from, to) {
  const start = parseDate(e.date); if (!start) return [];
  const end = parseDate(e.end_date), out = [];
  const stop = end && end < to ? end : to;
  if (e.repeat !== "monthly" && e.repeat !== "yearly") return start >= from && start <= stop ? [start] : [];
  const step = e.repeat === "monthly" ? 1 : 12;
  for (let k = 0; k < 2400; k += step) {
    const y = start.getFullYear(), m = start.getMonth() + k;
    const last = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(start.getDate(), last));
    if (d > stop) break;
    if (d >= from) out.push(d);
  }
  return out;
}
const expenseTotal = (exps, from, to, f = () => true) => exps.filter(f).reduce((t, e) => t + expenseDates(e, from, to).length * num(e.amount), 0);

// The chart: revenue and profit per day (or per month for long spans).
const PERIODS = {"7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", month: "This month", all: "All time"};
function chartSeries(items, period, now = new Date()) {
  const sold = items.filter(isSold).map(i => ({d: parseDate(i.sold), rev: money(i.sale_price) || 0, profit: saleProfit(i)})).filter(s => s.d);
  const today = day0(now);
  let from = {"7d": addDays(today, -6), "30d": addDays(today, -29), "90d": addDays(today, -89), month: monthStart(now)}[period];
  if (!from) from = sold.length ? day0(new Date(Math.min(...sold.map(s => s.d)))) : addDays(today, -29);
  const monthly = daysBetween(from, today) > 120;
  const buckets = [];
  if (monthly) for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= today; d = new Date(d.getFullYear(), d.getMonth() + 1, 1))
    buckets.push({start: d, end: new Date(d.getFullYear(), d.getMonth() + 1, 1), label: d.toLocaleDateString("en-GB", {month: "short", year: "2-digit"}), revenue: 0, profit: 0});
  else for (let d = from; d <= today; d = addDays(d, 1))
    buckets.push({start: d, end: addDays(d, 1), label: shortDate(d), revenue: 0, profit: 0});
  for (const s of sold) {
    const b = buckets.find(b => s.d >= b.start && s.d < b.end);
    if (b) { b.revenue += s.rev; b.profit += s.profit; }
  }
  return {period, title: PERIODS[period] || PERIODS["30d"], monthly, buckets,
    revenue: buckets.reduce((t, b) => t + b.revenue, 0), profit: buckets.reduce((t, b) => t + b.profit, 0)};
}

// Everything the dashboard shows, worked out from your own rows.
// settings: {stale, stalePk, goal}. now: today's date (tests pass a fixed one).
function dashboard({items = [], orders = [], expenses = []}, settings = {}, now = new Date()) {
  const today = day0(now), TY = taxYear(now), ms = monthStart(now), ws = weekStart(now);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1), monthEnd = addDays(nextMonth, -1);
  const sold = items.filter(isSold).map(i => ({...i, d: parseDate(i.sold), profit: saleProfit(i), rev: money(i.sale_price) || 0}));
  const inRange = (from, to) => sold.filter(s => s.d && s.d >= from && s.d <= to);
  const sumBy = (a, f) => a.reduce((t, r) => t + (f(r) || 0), 0);
  const period = (from, to) => { const s = inRange(from, to); return {revenue: sumBy(s, r => r.rev), profit: sumBy(s, r => r.profit), count: s.length}; };

  const profit = {week: period(ws, now), month: period(ms, now), taxYear: period(TY.start, TY.end)};
  profit.month.expenses = expenseTotal(expenses, ms, monthEnd);
  profit.taxYear.expenses = expenseTotal(expenses, TY.start, today);
  profit.month.afterExpenses = profit.month.profit - profit.month.expenses;
  profit.taxYear.afterExpenses = profit.taxYear.profit - profit.taxYear.expenses;
  // The same days of last month, for "vs last month".
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1), lmDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  profit.month.lastMonthSameDay = period(lm, new Date(lm.getFullYear(), lm.getMonth(), Math.min(now.getDate(), lmDays))).profit;

  const live = orders.filter(o => ON_THE_WAY.includes(o.status));
  const pre = live.filter(o => isPreorder(o, now)), way = live.filter(o => !isPreorder(o, now));
  const pending = {count: way.length, committed: sumBy(way, o => num(o.cost)),
    oldestDays: way.length ? Math.max(...way.map(o => daysBetween(parseDate(o.ordered) || today, today))) : 0,
    outForDelivery: way.filter(o => o.status === "Out for delivery").length};
  const releases = pre.map(o => parseDate(o.release)).filter(Boolean).sort((a, b) => a - b);
  const preorders = {count: pre.length, paid: sumBy(pre, o => num(o.cost)), nextRelease: releases[0] || null};

  const held = items.filter(i => !isSold(i));
  const stock = {count: held.length, cost: sumBy(held, i => money(i.cost)), value: sumBy(held, i => money(i.ask_price) ?? money(i.cost)),
    listed: held.filter(i => i.status === "Listed").length};

  const target = num(settings.goal);
  const goal = {target, profit: profit.month.profit, pct: target > 0 ? Math.max(0, profit.month.profit / target) : 0,
    toGo: Math.max(0, target - profit.month.profit), daysLeft: daysBetween(today, monthEnd)};

  const groups = new Map();
  for (const s of inRange(ms, now)) {
    const k = nameKey(s.name);
    const g = groups.get(k) || {name: s.name, units: 0, profit: 0, revenue: 0, platforms: {}};
    g.units++; g.profit += s.profit; g.revenue += s.rev; g.platforms[label(s.platform, "")] = (g.platforms[label(s.platform, "")] || 0) + 1;
    groups.set(k, g);
  }
  const best = {};
  for (const by of ["units", "profit", "revenue"]) {
    const g = [...groups.values()].sort((a, b) => b[by] - a[by] || b.profit - a.profit)[0];
    best[by] = g ? {name: g.name, units: g.units, profit: g.profit, revenue: g.revenue, avgProfit: g.profit / g.units,
      platform: Object.entries(g.platforms).sort((a, b) => b[1] - a[1])[0][0]} : null;
  }

  const monthOcc = expenses.flatMap(e => expenseDates(e, ms, monthEnd).map(d => ({e, d, amount: num(e.amount)})));
  const activeRecurring = expenses.filter(e => (e.repeat === "monthly" || e.repeat === "yearly") && parseDate(e.date) <= today && (!parseDate(e.end_date) || parseDate(e.end_date) >= today));
  const byCat = new Map();
  for (const o of monthOcc) byCat.set(label(o.e.category), (byCat.get(label(o.e.category)) || 0) + o.amount);
  const biggest = monthOcc.sort((a, b) => b.amount - a.amount)[0];
  const exp = {
    month: sumBy(monthOcc, o => o.amount),
    oneOff: sumBy(monthOcc.filter(o => o.e.repeat !== "monthly" && o.e.repeat !== "yearly"), o => o.amount),
    recurring: sumBy(monthOcc.filter(o => o.e.repeat === "monthly" || o.e.repeat === "yearly"), o => o.amount),
    recurringPerMonth: sumBy(activeRecurring, e => e.repeat === "monthly" ? num(e.amount) : num(e.amount) / 12),
    recurringCount: activeRecurring.length,
    deductible: sumBy(monthOcc.filter(o => o.e.deductible !== false), o => o.amount),
    biggest: biggest ? {name: biggest.e.description, amount: biggest.amount} : null,
    byCategory: [...byCat].map(([name, amount]) => ({name, amount})).sort((a, b) => b.amount - a.amount),
  };

  const activity = [
    ...orders.map(o => ({kind: isPreorder(o, now) ? "preorder" : "order", id: o.id, title: o.item, when: o.status_at || o.created_at ? new Date(o.status_at || o.created_at) : parseDate(o.ordered) || today,
      meta: (isPreorder(o, now) ? "Pre-order" : "Order") + (o.shop ? " · " + o.shop : "") + (isPreorder(o, now) && parseDate(o.release) ? " · releases " + shortDate(parseDate(o.release)) : (parseDate(o.ordered) ? " · " + shortDate(parseDate(o.ordered)) : "")),
      status: orderLabel(o, now)})),
    ...sold.filter(s => s.d).map(s => ({kind: "sale", id: s.id, title: s.name, when: s.d, meta: "Sale" + (s.platform ? " · " + s.platform : "") + " · " + gbp(s.rev), status: "Sold"})),
  ].sort((a, b) => b.when - a.when).slice(0, 8);

  const actions = [];
  for (const i of held) {
    const listed = parseDate(i.listed);
    if (i.status === "Listed" && listed) {
      const days = daysBetween(listed, today), limit = /pok/i.test(i.category) ? num(settings.stalePk) || 90 : num(settings.stale) || 30;
      if (days > limit) actions.push({level: "bad", kind: "stale", id: i.id, days, title: `${i.name}, ${days} days listed`, detail: `Over your ${limit}-day limit: drop the price or try another platform`});
    }
  }
  actions.sort((a, b) => b.days - a.days);
  const toPost = sold.filter(s => !s.posted);
  if (toPost.length) actions.push({level: "warn", kind: "post", title: `${toPost.length} sale${toPost.length > 1 ? "s" : ""} to post`, detail: toPost.slice(0, 3).map(s => s.name).join(", ") + (toPost.length > 3 ? "…" : "")});
  const toStock = orders.filter(o => o.status === "Delivered" && !o.stocked_at);
  if (toStock.length) actions.push({level: "warn", kind: "stock", title: `${toStock.length} delivered order${toStock.length > 1 ? "s" : ""} to move into stock`, detail: toStock.slice(0, 3).map(o => o.item).join(", ") + (toStock.length > 3 ? "…" : "")});
  for (const o of way) if (o.status === "Ordered" && daysBetween(parseDate(o.ordered) || today, today) > 7)
    actions.push({level: "warn", kind: "order", id: o.id, title: `${o.item} hasn't shipped`, detail: `Ordered ${daysBetween(parseDate(o.ordered), today)} days ago${o.shop ? " from " + o.shop : ""}: check with the shop`});
  for (const o of pre) { const r = parseDate(o.release); if (r && daysBetween(today, r) <= 7)
    actions.push({level: "info", kind: "order", id: o.id, title: `${o.item} releases ${daysBetween(today, r) === 0 ? "today" : shortDate(r)}`, detail: "Pre-order" + (o.shop ? " from " + o.shop : "") + ": keep an eye out for the shipping email"}); }
  for (const i of items) {
    if (money(i.cost) == null) actions.push({level: "info", kind: "item", id: i.id, title: `${i.name} has no cost`, detail: "Add a cost so your profit is right"});
    if (i.status === "Listed" && !i.listed) actions.push({level: "info", kind: "item", id: i.id, title: `${i.name} has no listed date`, detail: "Add it so stale stock can be spotted"});
    if (isSold(i) && (!i.sold || money(i.sale_price) == null)) actions.push({level: "info", kind: "item", id: i.id, title: `${i.name} is sold but missing ${!i.sold ? "the sale date" : "the sale price"}`, detail: "Add it so it counts in your profit"});
  }

  const breakdown = key => {
    const m = new Map();
    for (const s of inRange(TY.start, TY.end)) { const k = label(s[key]); const g = m.get(k.toLowerCase()) || {name: k, profit: 0, revenue: 0, count: 0}; g.profit += s.profit; g.revenue += s.rev; g.count++; m.set(k.toLowerCase(), g); }
    return [...m.values()].sort((a, b) => b.profit - a.profit);
  };

  const summary = [];
  if (pending.outForDelivery) summary.push(`${pending.outForDelivery} order${pending.outForDelivery > 1 ? "s" : ""} out for delivery`);
  const stale = actions.filter(a => a.kind === "stale").length;
  if (stale) summary.push(`${stale} listing${stale > 1 ? "s" : ""} past your stale limit`);
  if (toPost.length) summary.push(`${toPost.length} sale${toPost.length > 1 ? "s" : ""} to post`);

  return {when: now.toISOString(), taxYear: TY.label, monthName: now.toLocaleDateString("en-GB", {month: "long"}),
    profit, pending, preorders, stock, goal, best, expenses: exp, activity, actions,
    byPlatform: breakdown("platform"), byCategory: breakdown("category"),
    summary: summary.length ? summary.join(" and ").replace(/ and (?=.* and )/g, ", ") + "." : ""};
}

const RHQ = {esc, gbp, DAY, taxYear, looseJson, parseDate, num, splitLine, tableFrom, pick, normInventory, normExpenses, crunch,
  ORDER_STATUSES, ON_THE_WAY, PERIODS, isPreorder, orderLabel, orderStep, nextStatus, orderCounts, orderFilter, orderMatches, saleProfit, expenseDates, chartSeries, dashboard};
if (typeof module === "object" && module.exports) module.exports = RHQ; else root.RHQ = RHQ;
})(typeof self !== "undefined" ? self : this);
