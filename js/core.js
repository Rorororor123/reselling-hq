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

const RHQ = {esc, gbp, DAY, taxYear, looseJson, parseDate, num, splitLine, tableFrom, pick, normInventory, normExpenses, crunch};
if (typeof module === "object" && module.exports) module.exports = RHQ; else root.RHQ = RHQ;
})(typeof self !== "undefined" ? self : this);
