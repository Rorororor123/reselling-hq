// Reselling HQ: the Inventory, Sales and Expenses screens and their forms, plus Download backup
// and bringing in an old tracker (Settings). Data loading and shared bits live in js/tracker.js.
(() => {
const R = RHQ, {esc, gbp} = R, X = window.RHQXlsx;
const $ = s => document.querySelector(s);
const account = window.RHQAccount, app = window.RHQApp, tr = window.RHQTracker, T = tr.data;
const {toast, niceDate, pill, plural, iso, whole} = tr;
// Fields by name (form.elements.item and friends are built-in functions, so look them up directly).
const fieldsOf = form => new Proxy({}, {get: (_, k) => form.querySelector(`[name="${k}"]`)});
const moneyIn = el => el.value === "" ? null : Math.round(Number(el.value) * 100) / 100;
const moneyOk = v => v == null || (v >= 0 && v < 1e8);
const shown = v => v == null || v === "" ? "" : R.num(v);
const stat = (k, v, cls = "") => `<div class="stat ${cls}"><span class="k">${k}</span><span class="mono">${v}</span></div>`;
const chips = (list, cur, counts = {}) => list.map(([k, t]) => `<button type="button" class="chip" data-chip="${k}" aria-pressed="${k === cur}">${t}${counts[k] != null ? `<span class="n">${counts[k]}</span>` : ""}</button>`).join("");
const loading = (list, what) => { list.innerHTML = T.error ? tr.problem() : `<p class="empty">Loading your ${what}…</p>`; };
const sum = (a, f) => a.reduce((t, r) => t + (f(r) || 0), 0);
const money = v => v == null || v === "" ? null : R.num(v);
async function save(table, editing, row) {
  const q = editing ? account.from(table).update(row).eq("id", editing.id) : account.from(table).insert(row);
  const {data, error} = await q.select().single();
  if (error) throw error;
  if (editing) Object.assign(editing, data); else T[table].push(data);
  return data;
}
async function remove(table, row) {
  const {error} = await account.from(table).delete().eq("id", row.id);
  if (error) throw error;
  T[table] = T[table].filter(r => r !== row);
}
function cardKeys(list, attr, find, open) {
  list.addEventListener("keydown", e => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const c = e.target.closest(`[${attr}]`);
    if (c && e.target === c) { e.preventDefault(); const r = find(c.getAttribute(attr)); if (r) open(r); }
  });
}

/* ---------- inventory ---------- */
let invFilter = "unsold", invQuery = "";
const INV_FILTERS = [["unsold", "All unsold"], ["inStock", "In stock"], ["listed", "Listed"], ["stale", "Stale"]];
function renderInv() {
  const list = $("#invList"), now = new Date(), S = app.settings();
  if (!T.loaded) { $("#invStats").innerHTML = $("#invFilters").innerHTML = ""; return loading(list, "stock"); }
  const held = T.items.filter(R.itemFilter("unsold", S, now));
  const n = Object.fromEntries(INV_FILTERS.map(([k]) => [k, T.items.filter(R.itemFilter(k, S, now)).length]));
  $("#invStats").innerHTML = stat("Items held", held.length) + stat("Cost", whole(sum(held, i => money(i.cost)))) + stat("Est. value", whole(sum(held, i => money(i.ask_price) ?? money(i.cost))))
    + stat("Listed", n.listed, "shipped") + stat("Stale", n.stale, "cancel");
  $("#invFilters").innerHTML = chips(INV_FILTERS, invFilter, n);
  const rows = T.items.filter(R.itemFilter(invFilter, S, now)).filter(i => R.itemMatches(i, invQuery)).map(i => ({i, age: R.itemAge(i, S, now)}))
    .sort((a, b) => (b.age.days ?? -1) - (a.age.days ?? -1) || String(b.i.created_at).localeCompare(String(a.i.created_at)));
  if (!held.length && invFilter !== "stale") { list.innerHTML = '<div class="card"><p class="empty">No stock yet. Tap <b>Add stock</b>, move a delivered order into stock, or bring in your old tracker from Settings.</p></div>'; return; }
  if (!rows.length) { list.innerHTML = `<div class="card"><p class="empty">${invFilter === "stale" && !invQuery ? "Nothing stale. Everything listed is within your limits." : "Nothing matches."}</p></div>`; return; }
  list.innerHTML = rows.map(({i, age}) => {
    const meta = [i.category, i.bought ? "Bought " + niceDate(i.bought, now) : "", i.order_id ? "from an order" : ""].filter(Boolean).join(" · ");
    const line = i.status === "Listed" ? (age.days != null ? `Listed ${plural(age.days, "day")} · your limit is ${age.limit}` : "Listed · add the date listed") : "Not listed yet";
    const cost = money(i.cost), ask = money(i.ask_price);
    return `<article class="ocard" tabindex="0" data-item="${esc(i.id)}" aria-label="${esc(i.name)}, ${esc(i.status)}. Open to edit">
      <div class="ico"><svg class="i"><use href="#i-box"/></svg></div>
      <div class="who"><b>${esc(i.name)}${i.size ? ` <span class="sub">${esc(i.size)}</span>` : ""}</b><span>${esc(meta || "Tap to add details")}</span></div>
      <div class="prog"><small${age.stale ? ' class="neg"' : ""}>${esc(line)}</small>${ask != null ? `<small>Asking ${gbp(ask)}</small>` : ""}</div>
      <div class="end">${pill(age.stale ? "Stale" : i.status)}<span class="mono${cost == null ? " neg" : ""}">${cost == null ? "No cost" : gbp(cost)}</span>
        <div class="acts">${i.status === "In stock" ? `<button class="btn small" type="button" data-listed="${esc(i.id)}">Mark listed</button>` : ""}<button class="btn small primary" type="button" data-sell="${esc(i.id)}">Mark as sold</button></div></div></article>`;
  }).join("");
}
$("#invFilters").addEventListener("click", e => { const b = e.target.closest("[data-chip]"); if (b) { invFilter = b.dataset.chip; renderInv(); } });
$("#invSearch").addEventListener("input", e => { invQuery = e.target.value; renderInv(); });
const findItem = id => T.items.find(x => x.id === id);
$("#invList").addEventListener("click", async e => {
  const sell = e.target.closest("[data-sell]"), lst = e.target.closest("[data-listed]");
  if (sell) return openSale(findItem(sell.dataset.sell));
  if (lst) {
    const i = findItem(lst.dataset.listed); lst.disabled = true;
    try { await save("items", i, {status: "Listed", listed: i.listed || iso(new Date())}); tr.renderAll(); toast(`${i.name} marked as listed.`); }
    catch { lst.disabled = false; toast("Couldn't update it just now. Try again in a moment."); }
    return;
  }
  const c = e.target.closest("[data-item]");
  if (c && !e.target.closest("button,a")) { const i = findItem(c.dataset.item); if (i) openItem(i); }
});
cardKeys($("#invList"), "data-item", findItem, i => openItem(i));

/* ---------- the stock item form (also edits a sale) ---------- */
const itemForm = $("#itemForm"), itemSheet = $("#itemSheet"), fi = fieldsOf(itemForm);
let editingItem = null;
function showItemParts() {
  const st = fi.status.value;
  itemForm.querySelector("[data-listed]").hidden = st === "In stock";
  itemForm.querySelector("[data-sold]").hidden = st !== "Sold";
  if (st === "Listed" && !fi.listed.value) fi.listed.value = iso(new Date());
  if (st === "Sold" && !fi.sold.value) fi.sold.value = iso(new Date());
}
function openItem(i) {
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  editingItem = i || null;
  itemForm.reset();
  $("#itemTitle").textContent = !i ? "Add stock" : i.status === "Sold" ? "Edit sale" : "Edit stock";
  itemForm.querySelector("[data-delete]").hidden = !i;
  itemForm.querySelector(".formmsg").textContent = "";
  const v = i || {status: "In stock", bought: iso(new Date())};
  for (const k of ["name", "category", "size", "status", "bought", "listed", "platform", "sold", "notes"]) fi[k].value = v[k] ?? "";
  for (const k of ["cost", "ask_price", "sale_price", "fees", "postage"]) fi[k].value = shown(v[k]);
  if (i && !money(i.fees)) fi.fees.value = "";
  if (i && !money(i.postage)) fi.postage.value = "";
  fi.posted.checked = !!v.posted;
  showItemParts();
  itemSheet.showModal();
  if (!i) fi.name.focus();
}
fi.status.addEventListener("change", showItemParts);
itemForm.addEventListener("submit", async e => {
  e.preventDefault();
  const msg = itemForm.querySelector(".formmsg"), btn = itemForm.querySelector('[type="submit"]');
  const st = fi.status.value, sold = st === "Sold";
  const m = Object.fromEntries(["cost", "ask_price", "sale_price", "fees", "postage"].map(k => [k, moneyIn(fi[k])]));
  if (!fi.name.value.trim()) { msg.textContent = "Say what the item is."; return fi.name.focus(); }
  const bad = Object.keys(m).find(k => !moneyOk(m[k]));
  if (bad) { msg.textContent = "Money boxes should be amounts in pounds, like 59.99."; return fi[bad].focus(); }
  if (sold && m.sale_price == null) { msg.textContent = "Add what it sold for."; return fi.sale_price.focus(); }
  if (sold && !fi.sold.value) { msg.textContent = "Add the date it sold."; return fi.sold.focus(); }
  const row = {name: fi.name.value.trim(), category: fi.category.value.trim(), size: fi.size.value.trim(), cost: m.cost, ask_price: m.ask_price, status: st,
    bought: fi.bought.value || null, listed: st === "In stock" ? null : fi.listed.value || null, notes: fi.notes.value.trim(),
    // A sale's details only count while it's marked as sold.
    platform: sold ? fi.platform.value.trim() : "", sold: sold ? fi.sold.value : null, sale_price: sold ? m.sale_price : null,
    fees: sold ? m.fees || 0 : 0, postage: sold ? m.postage || 0 : 0, posted: sold && fi.posted.checked};
  btn.disabled = true; msg.textContent = "";
  try { await save("items", editingItem, row); }
  catch { msg.textContent = "Couldn't save just now. Check your connection and try again."; return; }
  finally { btn.disabled = false; }
  itemSheet.close(); tr.renderAll(); app.setupDone("c-stock");
  toast(editingItem ? "Saved." : "Added to your stock.");
});
itemForm.querySelector("[data-delete]").addEventListener("click", async () => {
  if (!editingItem || !confirm(`Delete "${editingItem.name}"? This can't be undone.`)) return;
  try { await remove("items", editingItem); } catch { itemForm.querySelector(".formmsg").textContent = "Couldn't delete it just now. Try again in a moment."; return; }
  itemSheet.close(); tr.renderAll(); toast("Deleted.");
});

/* ---------- record a sale ---------- */
const saleForm = $("#saleForm"), saleSheet = $("#saleSheet"), fs = fieldsOf(saleForm);
let lastPlatform = "";
function saleParts() {
  const isNew = fs.item_id.value === "new";
  saleForm.querySelector("[data-new]").hidden = !isNew;
  const i = !isNew && findItem(fs.item_id.value), cost = isNew ? moneyIn(fs.cost) : i ? money(i.cost) : null, price = moneyIn(fs.sale_price);
  const p = saleForm.querySelector("[data-profit]");
  p.innerHTML = price == null ? "" : `Profit on this sale: <b class="mono ${price - (cost || 0) - (moneyIn(fs.fees) || 0) - (moneyIn(fs.postage) || 0) < 0 ? "neg" : "pos"}">${gbp(price - (cost || 0) - (moneyIn(fs.fees) || 0) - (moneyIn(fs.postage) || 0))}</b>${cost == null ? " (no cost entered for this item)" : ""}`;
}
function openSale(item) {
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  saleForm.reset();
  saleForm.querySelector(".formmsg").textContent = "";
  const held = T.items.filter(i => i.status !== "Sold").sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const opt = i => `<option value="${esc(i.id)}">${esc(i.name)}${i.size ? " · " + esc(i.size) : ""}${money(i.cost) != null ? " · " + gbp(money(i.cost)) : ""}</option>`;
  const group = (label, st) => { const g = held.filter(i => i.status === st); return g.length ? `<optgroup label="${label}">${g.map(opt).join("")}</optgroup>` : ""; };
  fs.item_id.innerHTML = (held.length ? '<option value="">Choose an item…</option>' : "") + group("Listed", "Listed") + group("In stock", "In stock") + '<option value="new">Something not in my stock</option>';
  fs.item_id.value = item ? item.id : held.length ? "" : "new";
  fs.sold.value = iso(new Date());
  fs.platform.value = lastPlatform;
  saleParts();
  saleSheet.showModal();
}
saleForm.addEventListener("input", saleParts);
saleForm.addEventListener("submit", async e => {
  e.preventDefault();
  const msg = saleForm.querySelector(".formmsg"), btn = saleForm.querySelector('[type="submit"]');
  const id = fs.item_id.value, isNew = id === "new", item = !isNew && findItem(id);
  const m = Object.fromEntries(["cost", "sale_price", "fees", "postage"].map(k => [k, moneyIn(fs[k])]));
  if (!isNew && !item) { msg.textContent = "Choose which item you sold."; return fs.item_id.focus(); }
  if (isNew && !fs.name.value.trim()) { msg.textContent = "Say what you sold."; return fs.name.focus(); }
  const bad = Object.keys(m).find(k => !moneyOk(m[k]));
  if (bad) { msg.textContent = "Money boxes should be amounts in pounds, like 59.99."; return fs[bad].focus(); }
  if (m.sale_price == null) { msg.textContent = "Add what it sold for."; return fs.sale_price.focus(); }
  if (!fs.sold.value) { msg.textContent = "Add the date it sold."; return fs.sold.focus(); }
  const sale = {status: "Sold", platform: fs.platform.value.trim(), sold: fs.sold.value, sale_price: m.sale_price, fees: m.fees || 0, postage: m.postage || 0, posted: fs.posted.checked};
  btn.disabled = true; msg.textContent = "";
  try { await save("items", item || null, isNew ? {name: fs.name.value.trim(), cost: m.cost, category: fs.category.value.trim(), ...sale} : sale); }
  catch { msg.textContent = "Couldn't save just now. Check your connection and try again."; return; }
  finally { btn.disabled = false; }
  lastPlatform = sale.platform;
  saleSheet.close(); tr.renderAll(); app.setupDone("c-stock");
  toast(sale.posted ? "Sale recorded." : "Sale recorded. It's on your list to post.");
});

/* ---------- sales screen ---------- */
let saleFilter = "month", salePlat = "";
const SALE_FILTERS = [["month", "This month"], ["30d", "30 days"], ["ty", "Tax year"], ["all", "All time"], ["toPost", "To post"]];
function renderSales() {
  const list = $("#saleList"), now = new Date();
  if (!T.loaded) { $("#saleStats").innerHTML = $("#saleFilters").innerHTML = ""; return loading(list, "sales"); }
  const checkN = T.items.filter(i => i.status === "Sold" && i.needs_review).length;
  if (saleFilter === "check" && !checkN) saleFilter = "month";
  const v = R.salesView(T.items, saleFilter === "toPost" ? {toPost: true} : {period: saleFilter === "check" ? "all" : saleFilter, platform: salePlat}, now);
  if (saleFilter === "check") v.rows = v.rows.filter(r => r.needs_review);
  const t = v.totals;
  $("#saleStats").innerHTML = stat("Sales", t.count) + stat("Revenue", whole(t.revenue)) + stat("Profit", `<span class="${t.profit < 0 ? "neg" : "pos"}">${whole(t.profit)}</span>`)
    + stat("Fees + postage", whole(t.fees + t.postage)) + stat("To post", v.toPost, v.toPost ? "warn" : "");
  $("#saleFilters").innerHTML = chips(checkN ? [...SALE_FILTERS, ["check", "To check"]] : SALE_FILTERS, saleFilter, {toPost: v.toPost, check: checkN});
  const sel = $("#salePlatform");
  if (salePlat && !v.platforms.includes(salePlat)) salePlat = "";
  sel.innerHTML = '<option value="">All platforms</option>' + v.platforms.map(p => `<option${p === salePlat ? " selected" : ""}>${esc(p)}</option>`).join("");
  sel.disabled = saleFilter === "toPost";
  if (!T.items.some(i => i.status === "Sold")) { list.innerHTML = '<div class="card"><p class="empty">No sales yet. Tap <b>Record a sale</b> when something sells, or <b>Mark as sold</b> on the Inventory screen.</p></div>'; return; }
  if (!v.rows.length) { list.innerHTML = `<div class="card"><p class="empty">${saleFilter === "toPost" ? "Everything's posted." : "No sales in this period."}</p></div>`; return; }
  list.innerHTML = v.rows.map(r => {
    const meta = [r.source === "ebay" ? r.platform + " (synced)" : r.platform, r.sold ? niceDate(r.sold, now) : "no sale date", r.category].filter(Boolean).join(" · ");
    const parts = [`Sold for ${gbp(money(r.sale_price))}`, money(r.cost) != null ? `cost ${gbp(money(r.cost))}` : "no cost entered", money(r.fees) ? `fees ${gbp(money(r.fees))}` : "", money(r.postage) ? `postage ${gbp(money(r.postage))}` : ""].filter(Boolean).join(" · ");
    return `<article class="ocard" tabindex="0" data-sale="${esc(r.id)}" aria-label="${esc(r.name)}, sold. Open to edit">
      <div class="ico"><svg class="i"><use href="#i-tag"/></svg></div>
      <div class="who"><b>${esc(r.name)}${r.size ? ` <span class="sub">${esc(r.size)}</span>` : ""}</b><span>${esc(meta)}</span></div>
      <div class="prog"><small>${esc(parts)}</small></div>
      <div class="end">${pill(r.needs_review ? "Check" : r.posted ? "Sold" : "To post")}<span class="mono ${r.profit < 0 ? "neg" : "pos"}">${gbp(r.profit)}</span>
        ${r.posted ? "" : `<div class="acts"><button class="btn small primary" type="button" data-posted="${esc(r.id)}">Mark posted</button></div>`}</div></article>`;
  }).join("");
}
$("#saleFilters").addEventListener("click", e => { const b = e.target.closest("[data-chip]"); if (b) { saleFilter = b.dataset.chip; renderSales(); } });
$("#salePlatform").addEventListener("change", e => { salePlat = e.target.value; renderSales(); });
$("#saleList").addEventListener("click", async e => {
  const p = e.target.closest("[data-posted]");
  if (p) {
    const i = findItem(p.dataset.posted); p.disabled = true;
    try { await save("items", i, {posted: true}); tr.renderAll(); toast(`${i.name} marked as posted.`); }
    catch { p.disabled = false; toast("Couldn't update it just now. Try again in a moment."); }
    return;
  }
  const c = e.target.closest("[data-sale]");
  if (c && !e.target.closest("button,a")) { const i = findItem(c.dataset.sale); if (i) openSaleCard(i); }
});
// An eBay sale the sync wasn't sure about opens the check first (js/ebay.js).
const openSaleCard = i => i.needs_review && tr.openReview ? tr.openReview(i) : openItem(i);
cardKeys($("#saleList"), "data-sale", findItem, openSaleCard);

/* ---------- expenses ---------- */
const REPEAT = {once: "One-off", monthly: "Monthly", yearly: "Yearly"};
function renderExp() {
  const list = $("#expList"), now = new Date();
  if (!T.loaded) { $("#expStats").innerHTML = ""; return loading(list, "expenses"); }
  const d = R.dashboard(T, app.settings(), now), x = d.expenses;
  $("#expStats").innerHTML = stat("This month", gbp(x.month)) + stat("Recurring", gbp(x.recurringPerMonth) + '<small class="sub">/mo</small>')
    + stat("Tax-deductible", gbp(x.deductible)) + stat("Tax year " + esc(d.taxYear), gbp(d.profit.taxYear.expenses));
  if (!T.expenses.length) { list.innerHTML = '<div class="card"><p class="empty">No expenses yet. Add your subscriptions (bots, proxies, software) once as monthly or yearly, and one-off costs like packaging as they happen.</p></div>'; return; }
  list.innerHTML = R.expenseRows(T.expenses, now).map(e => {
    const when = e.repeat === "once" ? niceDate(e.date, now) : (e.ended ? "Ended " + niceDate(e.end_date, now) : "Since " + niceDate(e.date, now) + (e.end_date ? " until " + niceDate(e.end_date, now) : ""));
    const meta = [e.category, when].filter(Boolean).join(" · ");
    return `<article class="ocard" tabindex="0" data-exp="${esc(e.id)}" aria-label="${esc(e.description)}. Open to edit">
      <div class="ico"><svg class="i"><use href="#i-card"/></svg></div>
      <div class="who"><b>${esc(e.description)}</b><span>${esc(meta)}</span></div>
      <div class="prog">${e.deductible === false ? "<small>Not tax-deductible</small>" : ""}</div>
      <div class="end">${pill(e.ended ? "Ended" : REPEAT[e.repeat] || "One-off")}<span class="mono">${gbp(R.num(e.amount))}${e.repeat === "monthly" ? '<small class="sub">/mo</small>' : e.repeat === "yearly" ? '<small class="sub">/yr</small>' : ""}</span></div></article>`;
  }).join("");
}
const findExp = id => T.expenses.find(x => x.id === id);
$("#expList").addEventListener("click", e => { const c = e.target.closest("[data-exp]"); if (c) { const x = findExp(c.dataset.exp); if (x) openExp(x); } });
cardKeys($("#expList"), "data-exp", findExp, x => openExp(x));

const expForm = $("#expForm"), expSheet = $("#expSheet"), fe = fieldsOf(expForm);
let editingExp = null;
const expParts = () => { expForm.querySelector("[data-end]").hidden = fe.repeat.value === "once"; };
function openExp(x) {
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  editingExp = x || null;
  expForm.reset();
  $("#expTitle").textContent = x ? "Edit expense" : "Add expense";
  expForm.querySelector("[data-delete]").hidden = !x;
  expForm.querySelector(".formmsg").textContent = "";
  const v = x || {date: iso(new Date()), repeat: "once", deductible: true};
  for (const k of ["description", "date", "category", "repeat", "end_date", "notes"]) fe[k].value = v[k] ?? "";
  fe.amount.value = shown(v.amount);
  fe.deductible.checked = v.deductible !== false;
  expParts();
  expSheet.showModal();
  if (!x) fe.description.focus();
}
fe.repeat.addEventListener("change", expParts);
expForm.addEventListener("submit", async e => {
  e.preventDefault();
  const msg = expForm.querySelector(".formmsg"), btn = expForm.querySelector('[type="submit"]'), amount = moneyIn(fe.amount);
  if (!fe.description.value.trim()) { msg.textContent = "Say what the expense was."; return fe.description.focus(); }
  if (amount == null || !moneyOk(amount)) { msg.textContent = "Add the amount in pounds, like 60 or 4.99."; return fe.amount.focus(); }
  if (!fe.date.value) { msg.textContent = "Add the date (for a subscription, the date of the first payment)."; return fe.date.focus(); }
  if (fe.repeat.value !== "once" && fe.end_date.value && fe.end_date.value < fe.date.value) { msg.textContent = "The stop date is before the start date."; return fe.end_date.focus(); }
  const row = {description: fe.description.value.trim(), amount, date: fe.date.value, category: fe.category.value.trim() || "Other", repeat: fe.repeat.value,
    end_date: fe.repeat.value !== "once" && fe.end_date.value ? fe.end_date.value : null, deductible: fe.deductible.checked, notes: fe.notes.value.trim()};
  btn.disabled = true; msg.textContent = "";
  try { await save("expenses", editingExp, row); }
  catch { msg.textContent = "Couldn't save just now. Check your connection and try again."; return; }
  finally { btn.disabled = false; }
  expSheet.close(); tr.renderAll(); toast(editingExp ? "Expense saved." : "Expense added.");
});
expForm.querySelector("[data-delete]").addEventListener("click", async () => {
  if (!editingExp || !confirm(`Delete "${editingExp.description}"? This can't be undone.` + (editingExp.repeat !== "once" ? " To keep past payments in your totals, set a stop date instead." : ""))) return;
  try { await remove("expenses", editingExp); } catch { expForm.querySelector(".formmsg").textContent = "Couldn't delete it just now. Try again in a moment."; return; }
  expSheet.close(); tr.renderAll(); toast("Expense deleted.");
});

/* ---------- quick add, screens ---------- */
document.addEventListener("click", e => {
  const a = e.target.closest("[data-add]"); if (!a) return;
  if (a.dataset.add === "item") openItem(null);
  if (a.dataset.add === "sale") openSale(null);
  if (a.dataset.add === "expense") openExp(null);
});
app.onShow("inv", () => renderInv());
app.onShow("sales", opts => { if (opts.filter) saleFilter = opts.filter; renderSales(); });
app.onShow("exp", () => renderExp());
tr.onRender(() => { renderInv(); renderSales(); renderExp(); });
tr.openItem = openItem;

/* ---------- Download backup ---------- */
$("#backupBtn").addEventListener("click", async () => {
  const msg = $("#backupMsg");
  await tr.ready;
  if (!T.loaded) { msg.textContent = "Your data hasn't loaded, so there's nothing to back up yet. Reload and try again."; return; }
  const bytes = X.writeXlsx(R.backupSheets(T, app.settings()));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  a.download = "reselling-hq-backup-" + iso(new Date()) + ".xlsx";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  msg.textContent = `Downloaded: ${plural(T.items.length, "item")}, ${plural(T.orders.length, "order")}, ${plural(T.expenses.length, "expense")}.`;
  app.save({lastBackup: new Date().toISOString()}).then(() => tr.renderAll()).catch(() => {});
});

/* ---------- bringing in an old tracker ---------- */
let pending = null;
$("#importIn").addEventListener("change", async e => {
  const files = [...e.target.files], out = $("#importOut");
  e.target.value = "";
  if (!files.length) return;
  await tr.ready;
  if (!T.loaded) { out.innerHTML = tr.problem(); return; }
  out.innerHTML = '<p class="sub">Reading…</p>';
  const texts = [];
  try {
    for (const f of files) {
      // Excel files are zips (they start "PK"), whatever the file is called.
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) for (const sh of await X.readXlsx(bytes)) texts.push(X.rowsToTsv(sh.rows));
      else texts.push(new TextDecoder().decode(bytes));
    }
  } catch {
    out.innerHTML = '<div class="banner err"><span>Couldn\'t open that file. Pick an Excel (.xlsx) file or CSV files. An older .xls file needs saving as .xlsx first.</span></div>';
    return;
  }
  const found = R.parseImport(texts), plan = R.planImport(T, found);
  const add = plan.items.add.length + plan.orders.add.length + plan.expenses.add.length, skipped = plan.items.skipped + plan.orders.skipped + plan.expenses.skipped;
  if (!found.tables) {
    out.innerHTML = '<div class="banner err"><span>Couldn\'t find a tracker table in that file. It needs a header row with an <b>Item Name</b> column (stock and sales) or an <b>Amount</b> column (expenses).</span></div>';
    return;
  }
  const soldN = plan.items.add.filter(i => i.status === "Sold").length;
  const lines = [plan.items.add.length ? `${plural(plan.items.add.length - soldN, "stock item")} and ${plural(soldN, "sale")}` : "", plan.orders.add.length ? plural(plan.orders.add.length, "order") : "", plan.expenses.add.length ? plural(plan.expenses.add.length, "expense") : ""].filter(Boolean);
  const names = [...plan.items.add, ...plan.orders.add.map(o => ({name: o.item})), ...plan.expenses.add.map(x => ({name: x.description}))].slice(0, 6).map(r => `<li>${esc(r.name)}</li>`).join("");
  pending = add ? plan : null;
  out.innerHTML = `<div class="banner"><div style="display:grid;gap:8px">
    ${add ? `<span><b>Ready to add:</b> ${esc(lines.join(", "))}.${skipped ? ` ${plural(skipped, "row")} already in the app will be skipped.` : ""}</span><ul class="plain">${names}${add > 6 ? `<li>and ${add - 6} more</li>` : ""}</ul>
      <div class="btnrow"><button class="btn primary small" type="button" id="importGo">Add them</button><button class="btn small" type="button" id="importNo">Cancel</button></div>`
      : `<span>Everything in that file is already in the app (${plural(skipped, "row")}), so there's nothing to add.</span>`}</div></div>`;
});
$("#importOut").addEventListener("click", async e => {
  const out = $("#importOut");
  if (e.target.closest("#importNo")) { pending = null; out.innerHTML = ""; return; }
  if (!e.target.closest("#importGo") || !pending) return;
  const plan = pending; pending = null;
  e.target.closest("#importGo").disabled = true;
  const done = {items: 0, orders: 0, expenses: 0};
  try {
    for (const t of ["orders", "items", "expenses"])
      for (let k = 0; k < plan[t].add.length; k += 200) {
        const chunk = plan[t].add.slice(k, k + 200), {error} = await account.from(t).insert(chunk);
        if (error) throw error;
        done[t] += chunk.length;
      }
    out.innerHTML = `<div class="banner"><span><b>Done.</b> Added ${plural(done.items, "item")}, ${plural(done.orders, "order")} and ${plural(done.expenses, "expense")}.</span></div>`;
  } catch {
    out.innerHTML = `<div class="banner err"><span>Stopped part way: added ${plural(done.items, "item")}, ${plural(done.orders, "order")} and ${plural(done.expenses, "expense")} before something went wrong. Choose the file again to add the rest: anything already added is skipped.</span></div>`;
  }
  await tr.reload();
});
})();
