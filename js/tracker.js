// Reselling HQ tracker: the Dashboard and Orders screens, and the order form.
// Your orders, stock and expenses live in your account (tables from supabase/migrations/002_tracker.sql);
// the sums come from js/core.js so they can be tested on their own.
(() => {
const R = RHQ, {esc, gbp} = R;
const $ = s => document.querySelector(s);
const account = window.RHQAccount, app = window.RHQApp;
const T = {orders: [], items: [], expenses: [], loaded: false, error: null};

const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const whole = n => (n < 0 ? "-£" : "£") + Math.round(Math.abs(n || 0)).toLocaleString("en-GB");
function niceDate(v, now = new Date()) {
  const d = v instanceof Date ? v : R.parseDate(v); if (!d) return "";
  return d.toLocaleDateString("en-GB", d.getFullYear() === now.getFullYear() ? {day: "numeric", month: "short"} : {day: "numeric", month: "short", year: "numeric"});
}
const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
const PILL = {"Ordered": "s-ordered", "Shipped": "s-shipped", "Out for delivery": "s-ofd", "Delivered": "s-done", "Cancelled": "s-cancel", "Pre-order": "s-pre", "Sold": "s-sold"};
const pill = status => `<span class="pill ${PILL[status] || "s-ordered"}">${esc(status)}</span>`;
function toast(text) {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); el.className = "toast"; document.body.append(el); }
  el.textContent = text; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3500);
}

/* ---------- loading your data ---------- */
async function load() {
  try {
    const res = await Promise.all(["orders", "items", "expenses"].map(t => account.from(t).select("*")));
    const bad = res.find(r => r.error);
    if (bad) throw bad.error;
    [T.orders, T.items, T.expenses] = res.map(r => r.data || []);
    T.loaded = true; T.error = null;
  } catch (e) {
    const m = String((e && (e.code + " " + e.message)) || "");
    T.error = /PGRST205|42P01|does not exist|could not find the table/i.test(m) ? "missing" : "failed";
  }
  renderAll();
}
function problem() {
  if (T.error === "missing") return `<div class="banner err"><svg class="i"><use href="#i-info"/></svg><div><b>One more setup step: the tracker isn't in your database yet.</b>
    <ol><li>Open supabase.com, sign in and open your Reselling HQ project.</li><li>Click <b>SQL Editor</b> (left side), then <b>New query</b>.</li>
    <li>Paste everything from the file <b>supabase/migrations/002_tracker.sql</b> on GitHub and click <b>Run</b>.</li><li>Come back here and reload the page.</li></ol></div></div>`;
  return `<div class="banner err"><svg class="i"><use href="#i-info"/></svg><div><b>Couldn't load your orders and stock just now.</b> Check your connection, then <button class="linkbtn" type="button" data-reload>try again</button>.</div></div>`;
}
document.addEventListener("click", e => { if (e.target.closest("[data-reload]")) load(); });
function renderAll() {
  renderDash(); renderOrders();
  const c = R.orderCounts(T.orders).onTheWay;
  document.querySelectorAll("[data-orders-badge]").forEach(b => { b.textContent = c; b.hidden = !c; });
}

/* ---------- dashboard ---------- */
const BOXES = [
  ["profit", "Profit (week, month and tax year)"], ["pending", "Orders on the way"], ["stock", "Stock"], ["preorders", "Pre-orders"],
  ["chart", "Revenue and profit chart"], ["goal", "Monthly goal"], ["best", "Best seller this month"],
  ["actions", "Needs action"], ["activity", "Recent activity"], ["expenses", "Expenses"],
  ["platform", "Profit by platform"], ["category", "Profit by category"],
];
const prefs = () => { const S = app.settings(); return {hide: new Set(S.dashHide || []), period: R.PERIODS[S.chartPeriod] ? S.chartPeriod : "30d", show: ["both", "revenue", "profit"].includes(S.chartShow) ? S.chartShow : "both", bestBy: ["units", "profit", "revenue"].includes(S.bestBy) ? S.bestBy : "units"}; };
const savePref = patch => app.save(patch).catch(() => toast("Couldn't save that choice just now. It'll reset when you reload."));
const seg = (name, opts, val, strong) => `<div class="seg${strong ? " strong" : ""}" role="group" aria-label="${esc(name)}">${opts.map(([v, t]) => `<button type="button" data-pref="${esc(name)}" data-val="${v}" aria-pressed="${v === val}">${t}</button>`).join("")}</div>`;

function renderDash() {
  const out = $("#dashOut"); if (!out) return;
  const now = new Date(), hr = now.getHours();
  const head = d => `<div class="dashhead">
    <div><span class="eyebrow">${esc(now.toLocaleDateString("en-GB", {weekday: "long", day: "numeric", month: "long"}))}</span>
      <h2>${hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening"}</h2>
      <p>${d ? esc(d) : ""}</p></div>
    <div class="btnrow"><button class="btn" type="button" id="dashCustomise">Customise</button><button class="btn primary add" type="button" data-add="order"><svg class="i"><use href="#i-plus"/></svg>Add order</button></div></div>`;
  if (!T.loaded) { out.innerHTML = head("") + (T.error ? problem() : '<p class="empty">Loading your dashboard…</p>'); return; }
  const S = app.settings(), p = prefs(), d = R.dashboard(T, S, now);
  const on = k => !p.hide.has(k);
  const nothing = !T.orders.length && !T.items.length && !T.expenses.length;
  const lede = nothing ? "Welcome. Add your first order to get started: it moves into stock with one tap once it's delivered." : d.summary || "Nothing urgent today.";

  const tiles = [];
  if (on("profit")) {
    const m = d.profit.month, diff = m.profit - m.lastMonthSameDay;
    const vs = m.lastMonthSameDay || m.profit ? `<span class="${diff >= 0 ? "pos" : "neg"}" style="font-weight:600">${diff >= 0 ? "+" : "-"}${gbp(Math.abs(diff))}</span> vs this time last month · ` : "";
    tiles.push(`<div class="tile hero-tile" data-box="profit"><span class="k">Profit this month</span>
      <span class="v ${m.profit < 0 ? "neg" : "pos"}">${gbp(m.profit)}</span>
      <span class="s">${vs}${gbp(m.revenue)} sales</span>
      <div class="trio"><div><span>This week</span><span class="mono">${gbp(d.profit.week.profit)}</span></div>
        <div><span>Month after expenses</span><span class="mono ${m.afterExpenses < 0 ? "neg" : ""}">${gbp(m.afterExpenses)}</span></div>
        <div><span>Tax year ${esc(d.taxYear)}</span><span class="mono">${gbp(d.profit.taxYear.profit)}</span></div></div></div>`);
  }
  if (on("pending")) tiles.push(`<div class="tile" data-box="pending"><span class="k">On the way</span><span class="v">${d.pending.count}<small> order${d.pending.count === 1 ? "" : "s"}</small></span>
    <span class="s">${d.pending.count ? `${gbp(d.pending.committed)} committed · oldest ${plural(d.pending.oldestDays, "day")}` : "Nothing on the way"}</span></div>`);
  if (on("stock")) tiles.push(`<div class="tile" data-box="stock"><span class="k">Stock</span><span class="v">${d.stock.count}<small> item${d.stock.count === 1 ? "" : "s"}</small></span>
    <span class="s">${whole(d.stock.cost)} cost · est. ${whole(d.stock.value)} value</span></div>`);
  if (on("preorders")) tiles.push(`<div class="tile" data-box="preorders"><span class="k">Pre-orders</span><span class="v">${d.preorders.count}<small> locked in</small></span>
    <span class="s">${d.preorders.count ? `${gbp(d.preorders.paid)} paid${d.preorders.nextRelease ? " · next release " + niceDate(d.preorders.nextRelease, now) : ""}` : "None waiting for release"}</span></div>`);

  const side = [];
  if (on("goal")) {
    const g = d.goal, C = 2 * Math.PI * 44, pct = Math.round(g.pct * 100);
    side.push(`<section class="card goalbox" data-box="goal">
      <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label="${g.target ? pct + "% of monthly profit goal" : "No monthly goal set"}">
        <circle cx="52" cy="52" r="44" fill="none" stroke="var(--step-off)" stroke-width="10"/>
        ${g.target && g.pct > 0 ? `<circle cx="52" cy="52" r="44" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(Math.min(g.pct, 1) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 52 52)"/>` : ""}
        <text x="52" y="58" text-anchor="middle" fill="var(--ink)" font-family="IBM Plex Mono, monospace" font-size="20">${g.target ? pct + "%" : "–"}</text></svg>
      <div class="info"><span class="k">Monthly goal</span>
        ${g.target ? `<span class="mono" style="font-size:20px">${whole(g.profit)} <small class="sub">of ${whole(g.target)}</small></span>
          <span class="sub">${g.toGo > 0 ? `${whole(g.toGo)} to go · ${plural(g.daysLeft, "day")} left` : "Goal reached this month. Nice work."}</span>`
          : '<span class="sub">Set a profit goal for the month and watch the ring fill up.</span>'}
        <button class="linkbtn" type="button" id="editGoal" style="justify-self:start">${g.target ? "Edit goal" : "Set a goal"}</button></div></section>`);
  }
  if (on("best")) {
    const b = d.best[p.bestBy];
    side.push(`<section class="card boxlist" data-box="best"><div class="cardhead" style="margin:0"><span class="k" style="color:var(--warn)">Best seller this month</span>${seg("bestBy", [["units", "Units"], ["profit", "Profit"], ["revenue", "Revenue"]], p.bestBy)}</div>
      ${b ? `<div class="best"><div class="ico"><svg class="i" style="width:28px;height:28px"><use href="#i-trophy"/></svg></div><div style="display:grid;gap:3px;min-width:0">
        <b style="overflow-wrap:anywhere">${esc(b.name)}</b><span class="sub">${b.units} sold · ${p.bestBy === "revenue" ? gbp(b.revenue) + " taken" : gbp(b.avgProfit) + " avg profit"}${b.platform ? " · " + esc(b.platform) : ""}</span></div></div>`
        : '<p class="empty">No sales this month yet.</p>'}</section>`);
  }
  const chart = on("chart") ? `<section class="card chartcard wide" data-box="chart">
    <div class="cardhead"><div><h3>Revenue and profit</h3><span class="sub">${esc(R.PERIODS[p.period])} · running total</span></div>
      <div class="btnrow">${seg("chartShow", [["both", "Both"], ["revenue", "Revenue"], ["profit", "Profit"]], p.show)}${seg("chartPeriod", [["7d", "7D"], ["30d", "30D"], ["90d", "90D"], ["month", "Month"], ["all", "All"]], p.period, true)}</div></div>
    <div class="chartwrap"></div></section>` : "";

  const third = [];
  if (on("actions")) {
    const list = d.actions.slice(0, 6), more = d.actions.length - list.length;
    third.push(`<section class="card" data-box="actions"><div class="cardhead"><h3>Needs action</h3>${d.actions.length ? `<span class="count bad">${d.actions.length}</span>` : ""}</div>
      ${list.length ? `<div class="rowlist">${list.map((a, i) => {
        const tag = a.kind === "order" || a.kind === "stock" ? "button" : "div";
        return `<${tag} class="rowitem wrap"${tag === "button" ? ` type="button" data-action="${i}"` : ""}><span class="dot ${a.level}"></span><span class="grow"><span class="t">${esc(a.title)}</span><span class="m">${esc(a.detail)}</span></span></${tag}>`;
      }).join("")}${more > 0 ? `<p class="sub" style="margin:4px 0 0">and ${more} more</p>` : ""}</div>` : '<p class="empty">Nothing needs doing right now.</p>'}</section>`);
  }
  if (on("activity")) third.push(`<section class="card" data-box="activity"><div class="cardhead"><h3>Recent activity</h3><button class="linkbtn" type="button" data-tab="orders">All orders</button></div>
    ${d.activity.length ? `<div class="rowlist">${d.activity.map(a => `<div class="rowitem"><span class="grow"><span class="t">${esc(a.title)}</span><span class="m">${esc(a.meta)}</span></span>${pill(a.status)}</div>`).join("")}</div>` : '<p class="empty">Your orders and sales will show here.</p>'}</section>`);
  if (on("expenses")) {
    const x = d.expenses, cats = x.byCategory.slice(0, 3), top = cats.length ? cats[0].amount : 0;
    third.push(`<section class="card boxlist" data-box="expenses"><div class="cardhead" style="margin:0"><h3>Expenses</h3><span class="sub">${esc(d.monthName)}</span></div>
      <div class="minis"><div><span class="k">This month</span><span class="mono">${gbp(x.month)}</span><span class="sub">${gbp(x.oneOff)} one-off</span></div>
        <div><span class="k">Recurring</span><span class="mono">${gbp(x.recurringPerMonth)}<small>/mo</small></span><span class="sub">${plural(x.recurringCount, "subscription")}</span></div>
        <div><span class="k">Tax-deductible</span><span class="mono">${gbp(x.deductible)}</span></div>
        <div><span class="k">Biggest cost</span><span class="mono">${gbp(x.biggest ? x.biggest.amount : 0)}</span>${x.biggest ? `<span class="sub" style="overflow-wrap:anywhere">${esc(x.biggest.name)}</span>` : ""}</div></div>
      ${cats.length ? `<div class="catbars">${cats.map(c => `<div class="row"><span>${esc(c.name)}</span><span class="mono">${gbp(c.amount)}</span></div><div class="track"><div class="fill" style="width:${top ? Math.max(2, c.amount / top * 100) : 0}%"></div></div>`).join("")}</div>` : '<p class="empty">No expenses this month.</p>'}</section>`);
  }
  const bars = (key, title, list, green) => {
    const max = Math.max(0, ...list.map(r => r.profit));
    return `<section class="card boxlist" data-box="${key}"><div class="cardhead" style="margin:0"><h3>${title}</h3><span class="sub">Tax year ${esc(d.taxYear)}</span></div>
      ${list.length ? `<div class="bars">${list.slice(0, 6).map(r => `<div class="bar"><span title="${esc(r.name)}">${esc(r.name)}</span><div class="track"><div class="fill${green ? " g" : ""}" style="width:${max > 0 ? Math.max(0, r.profit / max * 100) : 0}%"></div></div><span class="mono ${r.profit < 0 ? "neg" : ""}">${gbp(r.profit)}</span></div>`).join("")}</div>` : '<p class="empty">No sales this tax year yet.</p>'}</section>`;
  };
  const fourth = [];
  if (on("platform")) fourth.push(bars("platform", "Profit by platform", d.byPlatform));
  if (on("category")) fourth.push(bars("category", "Profit by category", d.byCategory, true));

  // On a phone the small boxes sit two to a row; an odd one out takes the full width.
  const small = tiles.length - (on("profit") ? 1 : 0);
  if (small % 2) tiles[tiles.length - 1] = tiles[tiles.length - 1].replace('class="tile"', 'class="tile odd"');
  out.innerHTML = head(lede)
    + (tiles.length ? `<div class="tiles">${tiles.join("")}</div>` : "")
    + (chart || side.length ? `<div class="row2">${chart}${side.length ? `<div class="side">${side.join("")}</div>` : ""}</div>` : "")
    + (third.length ? `<div class="grid3">${third.join("")}</div>` : "")
    + (fourth.length ? `<div class="grid3">${fourth.join("")}</div>` : "")
    + (BOXES.every(([k]) => !on(k)) ? '<p class="empty">Every box is switched off. Tap Customise to choose what shows.</p>' : "");
  out._actions = d.actions;
  const wrap = out.querySelector(".chartwrap");
  if (wrap) drawChart(wrap, R.chartSeries(T.items, p.period, now), p.show);
}

$("#dashOut").addEventListener("click", e => {
  const pr = e.target.closest("[data-pref]");
  if (pr) { const v = pr.dataset.val; app.settings()[pr.dataset.pref] = v; renderDash(); savePref({[pr.dataset.pref]: v}); return; }
  if (e.target.closest("#dashCustomise")) return openCustomise();
  if (e.target.closest("#editGoal")) { const f = $("#goalForm"); f.goal.value = app.settings().goal || ""; $("#goalSheet").showModal(); return; }
  const a = e.target.closest("[data-action]");
  if (a) {
    const act = $("#dashOut")._actions[+a.dataset.action];
    if (act.kind === "order") { const o = T.orders.find(x => x.id === act.id); if (o) openOrder(o); }
    if (act.kind === "stock") app.go("orders", {filter: "delivered"});
  }
});

function openCustomise() {
  const hide = prefs().hide;
  $("#custList").innerHTML = BOXES.map(([k, t]) => `<label class="checkrow"><input type="checkbox" name="${k}"${hide.has(k) ? "" : " checked"}>${esc(t)}</label>`).join("");
  $("#custSheet").showModal();
}
$("#custForm").addEventListener("submit", e => {
  const dashHide = BOXES.map(([k]) => k).filter(k => !e.target.elements[k].checked);
  app.settings().dashHide = dashHide; renderDash(); savePref({dashHide});
});
$("#goalForm").addEventListener("submit", e => {
  const goal = Math.max(0, Math.round(R.num(e.target.goal.value) * 100) / 100);
  app.settings().goal = goal; renderDash(); savePref({goal});
});

/* ---------- the chart ---------- */
// Drawn at the box's real width so the text stays sharp; redrawn when the box changes size.
const chartObserver = typeof ResizeObserver === "function" ? new ResizeObserver(es => es.forEach(en => en.target._redraw && en.target._redraw())) : null;
function niceStep(range) { const raw = range / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag; }
function drawChart(wrap, c, show) {
  const rev = show !== "profit", pro = show !== "revenue";
  const legend = [rev ? `<span><span class="sw" style="background:var(--chart-rev)"></span>Revenue ${gbp(c.revenue)}</span>` : "", pro ? `<span><span class="sw" style="background:var(--chart-profit)"></span>Profit ${gbp(c.profit)}</span>` : ""].join("");
  const any = c.buckets.some(b => b.revenue || b.profit);
  wrap.innerHTML = `<div class="legend">${legend}</div><div class="chart" role="img" aria-label="${esc(c.title)}: revenue ${esc(gbp(c.revenue))}, profit ${esc(gbp(c.profit))}"></div>${any ? "" : '<p class="empty">No sales in this period yet. Sales you record show up here.</p>'}`;
  const el = wrap.querySelector(".chart");
  el._redraw = () => paint(el, c, rev, pro);
  paint(el, c, rev, pro);
  if (chartObserver) chartObserver.observe(el);
}
// Lines show the running total across the period, which reads better than spiky single days.
function paint(el, c, rev, pro) {
  const W = Math.max(200, el.clientWidth || 600), H = el.clientHeight || 230, L = 52, Rm = 10, Tm = 10, B = 24;
  let cr = 0, cp = 0;
  const pts = c.buckets.map(b => ({label: b.label, day: b, revenue: cr += b.revenue, profit: cp += b.profit}));
  const n = pts.length, vals = pts.flatMap(b => [rev ? b.revenue : 0, pro ? b.profit : 0]);
  let lo = Math.min(0, ...vals), hi = Math.max(10, ...vals);
  const step = niceStep(hi - lo); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = i => n === 1 ? L + (W - L - Rm) / 2 : L + i * (W - L - Rm) / (n - 1);
  const y = v => Tm + (hi - v) / (hi - lo) * (H - Tm - B);
  const line = f => pts.map((b, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(f(b)).toFixed(1)).join(" ");
  let grid = "", labels = "";
  for (let v = lo; v <= hi + 1e-9; v += step) { grid += `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`; labels += `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${whole(v)}</text>`; }
  const ticks = n === 1 ? [0] : [...new Set([0, Math.round((n - 1) / 3), Math.round(2 * (n - 1) / 3), n - 1])];
  ticks.forEach(i => { const a = n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle"; labels += `<text x="${x(i)}" y="${H - 6}" text-anchor="${a}">${esc(pts[i].label)}</text>`; });
  const r = rev ? `<path d="${line(b => b.revenue)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z" fill="var(--chart-rev)" fill-opacity=".14"/><path d="${line(b => b.revenue)}" fill="none" stroke="var(--chart-rev)" stroke-width="2" stroke-linejoin="round"/>` : "";
  const p = pro ? `<path d="${line(b => b.profit)}" fill="none" stroke="var(--chart-profit)" stroke-width="2" stroke-linejoin="round"/>` : "";
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${grid}${labels}${r}${p}
    <g class="hover" visibility="hidden"><line y1="${Tm}" y2="${H - B}" stroke="var(--line2)" stroke-width="1"/>${rev ? '<circle r="4.5" fill="var(--chart-rev)" stroke="var(--panel)" stroke-width="2" data-s="r"/>' : ""}${pro ? '<circle r="4.5" fill="var(--chart-profit)" stroke="var(--panel)" stroke-width="2" data-s="p"/>' : ""}</g>
    <rect x="${L}" y="0" width="${W - L - Rm}" height="${H}" fill="transparent"/></svg><div class="tip" hidden></div>`;
  const svg = el.querySelector("svg"), hov = svg.querySelector(".hover"), tip = el.querySelector(".tip");
  const show = ev => {
    const bx = svg.getBoundingClientRect(), px = (ev.clientX - bx.left) * W / bx.width;
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((px - L) / ((W - L - Rm) / (n - 1))))), b = pts[i];
    hov.setAttribute("visibility", "visible");
    hov.querySelector("line").setAttribute("x1", x(i)); hov.querySelector("line").setAttribute("x2", x(i));
    hov.querySelectorAll("circle").forEach(cc => { cc.setAttribute("cx", x(i)); cc.setAttribute("cy", y(cc.dataset.s === "r" ? b.revenue : b.profit)); });
    const that = c.monthly ? "that month" : "that day";
    tip.innerHTML = `<b>Up to ${esc(b.label)}</b>${rev ? `<span>Revenue ${gbp(b.revenue)}</span>` : ""}${pro ? `<span>Profit ${gbp(b.profit)}</span>` : ""}`
      + (b.day.revenue ? `<small class="sub">${gbp(b.day.revenue)} sales ${that}</small>` : "");
    tip.hidden = false; tip.style.left = Math.max(60, Math.min(bx.width - 60, x(i) * bx.width / W)) + "px";
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", () => { hov.setAttribute("visibility", "hidden"); tip.hidden = true; });
}

/* ---------- orders screen ---------- */
let ordFilter = "all", ordQuery = "";
const FILTERS = [["all", "All"], ["onTheWay", "On the way"], ["delivered", "Delivered"], ["preorders", "Pre-orders"], ["cancelled", "Cancelled"]];
const RANK = {"Out for delivery": 0, "Shipped": 1, "Ordered": 2, "Delivered": 3, "Cancelled": 4};
function trackLine(o, now) {
  if (o.status === "Cancelled") return "Cancelled" + (o.courier ? " · " + o.courier : "");
  if (R.isPreorder(o, now)) return o.release ? "Releases " + niceDate(o.release, now) : "Pre-order · release date not set";
  const parts = [o.courier, o.tracking].filter(Boolean);
  if (o.status === "Delivered") return [...parts, o.stocked_at ? "added to stock" : "not in stock yet"].join(" · ");
  return parts.length ? parts.join(" · ") : "Tracking number not added yet";
}
function renderOrders() {
  const list = $("#ordList"); if (!list) return;
  const now = new Date();
  if (!T.loaded) { $("#ordStats").innerHTML = ""; $("#ordFilters").innerHTML = ""; list.innerHTML = T.error ? problem() : '<p class="empty">Loading your orders…</p>'; return; }
  const c = R.orderCounts(T.orders, now);
  $("#ordStats").innerHTML = [["ordered", "Ordered", c.Ordered], ["shipped", "Shipped", c.Shipped], ["ofd", "Out for delivery", c["Out for delivery"]], ["done", "Delivered (7 days)", c.Delivered], ["cancel", "Cancelled", c.Cancelled]]
    .map(([cls, t, n]) => `<div class="stat ${cls}"><span class="k">${t}</span><span class="mono">${n}</span></div>`).join("");
  const n = {all: c.all, onTheWay: c.onTheWay, delivered: c.delivered, preorders: c.preorders, cancelled: c.cancelled};
  $("#ordFilters").innerHTML = FILTERS.map(([k, t]) => `<button type="button" class="chip" data-filter-chip="${k}" aria-pressed="${k === ordFilter}">${t}<span class="n">${n[k]}</span></button>`).join("");
  const shown = T.orders.filter(R.orderFilter(ordFilter, now)).filter(o => R.orderMatches(o, ordQuery))
    .sort((a, b) => (R.isPreorder(a, now) ? 2.5 : RANK[a.status]) - (R.isPreorder(b, now) ? 2.5 : RANK[b.status]) || String(b.ordered).localeCompare(String(a.ordered)) || String(b.created_at).localeCompare(String(a.created_at)));
  if (!T.orders.length) { list.innerHTML = '<div class="card"><p class="empty">No orders yet. Tap <b>Add order</b> for each thing you buy, then move it along as it ships.</p></div>'; return; }
  if (!shown.length) { list.innerHTML = '<div class="card"><p class="empty">No orders match.</p></div>'; return; }
  list.innerHTML = shown.map(o => {
    const st = R.orderStep(o, now), next = R.nextStatus(o), label = R.orderLabel(o, now);
    const meta = [o.shop, o.order_ref ? "Order " + o.order_ref : "", niceDate(o.ordered, now)].filter(Boolean).join(" · ");
    const acts = [next ? `<button class="btn small" type="button" data-advance="${esc(o.id)}">Mark ${next === "Out for delivery" ? "out for delivery" : next.toLowerCase()}</button>` : "",
      o.status === "Delivered" && !o.stocked_at ? `<button class="btn small primary" type="button" data-stock="${esc(o.id)}"><svg class="i"><use href="#i-box"/></svg>Move into stock</button>` : ""].join("");
    return `<article class="ocard" tabindex="0" data-order="${esc(o.id)}" aria-label="${esc(o.item)}, ${esc(label)}. Open to edit">
      <div class="ico"><svg class="i"><use href="#i-box"/></svg></div>
      <div class="who"><b>${esc(o.item)}${o.qty > 1 ? ` <span class="sub">× ${o.qty}</span>` : ""}</b><span>${esc(meta)}</span></div>
      <div class="prog"><div class="steps4 ${st.tone}">${[1, 2, 3, 4].map(i => `<span${i <= st.steps ? ' class="lit"' : ""}></span>`).join("")}</div><small>${esc(trackLine(o, now))}</small></div>
      <div class="end">${pill(label)}<span class="mono">${gbp(R.num(o.cost))}</span>${acts ? `<div class="acts">${acts}</div>` : ""}</div></article>`;
  }).join("");
}
$("#ordFilters").addEventListener("click", e => { const b = e.target.closest("[data-filter-chip]"); if (b) { ordFilter = b.dataset.filterChip; renderOrders(); } });
$("#ordSearch").addEventListener("input", e => { ordQuery = e.target.value; renderOrders(); });
$("#ordList").addEventListener("click", async e => {
  const adv = e.target.closest("[data-advance]"), stk = e.target.closest("[data-stock]");
  if (adv) return advance(adv);
  if (stk) return moveToStock(stk);
  const card = e.target.closest("[data-order]");
  if (card && !e.target.closest("button,a")) { const o = T.orders.find(x => x.id === card.dataset.order); if (o) openOrder(o); }
});
$("#ordList").addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest("[data-order]");
  if (card && e.target === card) { e.preventDefault(); const o = T.orders.find(x => x.id === card.dataset.order); if (o) openOrder(o); }
});
app.onShow("orders", opts => { ordFilter = opts.filter || "all"; renderOrders(); });
app.onShow("dash", () => renderDash());

async function advance(btn) {
  const o = T.orders.find(x => x.id === btn.dataset.advance), next = o && R.nextStatus(o);
  if (!next) return;
  btn.disabled = true;
  const {data, error} = await account.from("orders").update({status: next}).eq("id", o.id).select().single();
  if (error) { btn.disabled = false; return toast("Couldn't update that order just now. Try again in a moment."); }
  Object.assign(o, data);
  renderAll();
  toast(next === "Delivered" ? `${o.item} delivered. Tap Move into stock when you've checked it.` : `${o.item}: ${next.toLowerCase()}.`);
}
async function moveToStock(btn) {
  const o = T.orders.find(x => x.id === btn.dataset.stock); if (!o) return;
  btn.disabled = true;
  const {data, error} = await account.rpc("move_order_to_stock", {p_order: o.id});
  if (error) {
    btn.disabled = false;
    if (/already_stocked/.test(error.message || "")) { o.stocked_at = new Date().toISOString(); renderAll(); return toast("That order is already in your stock."); }
    return toast("Couldn't move it into stock just now. Nothing was changed; try again in a moment.");
  }
  T.items.push(...(data || []));
  o.stocked_at = new Date().toISOString();
  renderAll();
  toast(`Added ${plural((data || []).length, "item")} to your stock.`);
}

/* ---------- the order form ---------- */
const form = $("#orderForm"), sheet = $("#orderSheet");
let editing = null;
// Fields by name. (field.item is a built-in function, so it can't be used for the "item" box.)
const field = new Proxy({}, {get: (_, k) => form.querySelector(`[name="${k}"]`)});
function openOrder(o) {
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  editing = o || null;
  form.reset();
  $("#orderTitle").textContent = o ? "Edit order" : "Add order";
  form.querySelector("[data-delete]").hidden = !o;
  form.querySelector(".formmsg").textContent = "";
  const v = o || {ordered: iso(new Date()), qty: 1, status: "Ordered"};
  for (const k of ["item", "shop", "order_ref", "ordered", "qty", "courier", "tracking", "status", "release", "category", "size", "notes"]) field[k].value = v[k] ?? "";
  field.cost.value = o && o.cost != null ? R.num(o.cost) : "";
  field.preorder.checked = !!v.preorder;
  form.querySelector("[data-pre]").hidden = !v.preorder;
  sheet.showModal();
  if (!o) field.item.focus();
}
document.addEventListener("click", e => { if (e.target.closest("[data-add='order']")) openOrder(null); });
field.preorder.addEventListener("change", () => { form.querySelector("[data-pre]").hidden = !field.preorder.checked; });
form.addEventListener("submit", async e => {
  e.preventDefault();
  const f = field, msg = form.querySelector(".formmsg"), btn = form.querySelector('[type="submit"]');
  const qty = Math.round(Number(f.qty.value || 1)), cost = f.cost.value === "" ? 0 : Number(f.cost.value);
  if (!f.item.value.trim()) { msg.textContent = "Say what you ordered."; return f.item.focus(); }
  if (!f.ordered.value) { msg.textContent = "Add the order date."; return f.ordered.focus(); }
  if (!(cost >= 0) || cost > 99999999) { msg.textContent = "The cost should be a number in pounds, like 59.99."; return f.cost.focus(); }
  if (!(qty >= 1 && qty <= 500)) { msg.textContent = "Quantity should be between 1 and 500."; return f.qty.focus(); }
  const row = {item: f.item.value.trim(), shop: f.shop.value.trim(), order_ref: f.order_ref.value.trim(), ordered: f.ordered.value, qty,
    cost: Math.round(cost * 100) / 100, status: f.status.value, courier: f.courier.value.trim(), tracking: f.tracking.value.trim(),
    preorder: f.preorder.checked, release: f.preorder.checked && f.release.value ? f.release.value : null,
    category: f.category.value.trim(), size: f.size.value.trim(), notes: f.notes.value.trim()};
  btn.disabled = true; msg.textContent = "";
  const q = editing ? account.from("orders").update(row).eq("id", editing.id) : account.from("orders").insert(row);
  const {data, error} = await q.select().single();
  btn.disabled = false;
  if (error) { msg.textContent = "Couldn't save just now. Check your connection and try again."; return; }
  if (editing) Object.assign(editing, data); else T.orders.push(data);
  sheet.close(); renderAll();
  toast(editing ? "Order saved." : "Order added.");
});
form.querySelector("[data-delete]").addEventListener("click", async () => {
  if (!editing || !confirm(`Delete the order for "${editing.item}"? This can't be undone.` + (editing.stocked_at ? " Stock already made from it stays in your stock." : ""))) return;
  const {error} = await account.from("orders").delete().eq("id", editing.id);
  if (error) { form.querySelector(".formmsg").textContent = "Couldn't delete it just now. Try again in a moment."; return; }
  T.orders = T.orders.filter(o => o !== editing);
  sheet.close(); renderAll(); toast("Order deleted.");
});

app.ready.then(load);
window.RHQTracker = {data: T, reload: load};
})();
