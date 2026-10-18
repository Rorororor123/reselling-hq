(() => {
const {esc, gbp, taxYear, looseJson, num, tableFrom, normInventory, normExpenses, crunch} = RHQ; // from js/core.js
const $ = s => document.querySelector(s);

/* ---------- settings ---------- */
const DEFAULTS = {inv:"", exp:"", stale:30, stalePk:90, offer:85, min:5, post:2, budget:200, source:"retail drops, charity shops, car boots, online deals"};
let S = {...DEFAULTS};
try { S = {...DEFAULTS, ...JSON.parse(localStorage.getItem("rhq-settings") || "{}")}; } catch {}
const map = {inv:"sInv",exp:"sExp",stale:"sStale",stalePk:"sStalePk",offer:"sOffer",min:"sMin",post:"sPost",budget:"sBudget",source:"sSource"};
for (const [k,id] of Object.entries(map)) $("#"+id).value = S[k];
try { $("#sPw").value = localStorage.getItem("rhq-pw") || ""; } catch {}
$("#setForm").addEventListener("submit", e => {
  e.preventDefault();
  for (const [k,id] of Object.entries(map)) { const v = $("#"+id).value; S[k] = typeof DEFAULTS[k] === "number" ? Number(v) || DEFAULTS[k] : v.trim() || DEFAULTS[k]; }
  for (const k of ["inv","exp"]) S[k] = $("#"+map[k]).value.trim();
  try { localStorage.setItem("rhq-settings", JSON.stringify(S)); } catch {}
  const pw = $("#sPw").value; if (pw) { try { localStorage.setItem("rhq-pw", pw); } catch {} rememberSetup("c-drive"); }
  if (S.inv) rememberSetup("c-sheet");
  $("#setMsg").textContent = "Saved.";
  setTimeout(() => $("#setMsg").textContent = "", 2000);
});

/* ---------- tabs ---------- */
function go(tab) {
  document.querySelectorAll("nav.menu button").forEach(x => x.dataset.tab === tab ? x.setAttribute("aria-current", "page") : x.removeAttribute("aria-current"));
  document.querySelectorAll("section.tab").forEach(s => s.hidden = s.id !== tab);
  if (tab === "hist") loadHistory();
  window.scrollTo({top: 0});
}
document.querySelectorAll("nav.menu button").forEach(b => b.addEventListener("click", () => go(b.dataset.tab)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => go(b.dataset.go)));

/* ---------- tax year ---------- */
const TY = taxYear();
$("#taxyr").textContent = "UK tax year " + TY.label;

/* ---------- capabilities ---------- */
/* Standalone: Claude runs through this site's /api/claude, history lives in this browser. */
function getPw() { try { return localStorage.getItem("rhq-pw") || ""; } catch { return ""; } }
async function api(path, body, signal) {
  let r;
  try { r = await fetch(path, {method: body ? "POST" : "GET", headers: {"content-type": "application/json", "x-app-password": getPw()}, body: body ? JSON.stringify(body) : undefined, signal}); }
  catch (e) { throw {code: e && e.name === "AbortError" ? "cancelled" : "offline"}; }
  let j = {}; try { j = await r.json(); } catch {}
  if (!r.ok) throw {code: (j.error && j.error.code) || "upstream_error", message: j.error && j.error.message};
  return j;
}
async function toJpeg(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.85);
  return {type: "image/jpeg", data: url.split(",")[1]};
}
const sample = async (prompt, o = {}) => {
  const images = o.images ? await Promise.all([...o.images].slice(0, 6).map(toJpeg)) : [];
  const j = await api("/api/claude", {prompt, images, tier: o.modelTier === "quick" ? "quick" : "default", webSearch: !!o.webSearch, maxTokens: o.maxTokens}, o.signal);
  if (o.onText) o.onText({text: j.text, delta: j.text});
  return {text: j.text, truncated: !!j.truncated};
};
sample.json = async (p, o) => looseJson((await sample(p, o)).text);
sample.limits = async () => ({images: {maxCount: 6}});
const mcp = null, uid = "me";
const db = {collection: path => {
  const key = "rhq-" + path;
  const all = () => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } };
  const q = {n: 50, orderBy() { return q; }, limit(n) { q.n = n; return q; },
    async get() { return {docs: Object.values(all()).sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, q.n).map(d => ({data: () => d}))}; },
    doc: id => ({async set(obj) { const a = all(); a[id] = obj; const ks = Object.keys(a).sort().reverse(); ks.slice(52).forEach(k => delete a[k]); localStorage.setItem(key, JSON.stringify(a)); }})};
  return q;
}};
const capsReady = Promise.resolve();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

/* ---------- reading the tracker ---------- */
let csvTexts = null;
$("#csvIn").addEventListener("change", async e => {
  const files = [...e.target.files]; if (!files.length) return;
  csvTexts = await Promise.all(files.map(f => f.text()));
  $("#srcLabel").textContent = "Reading from: " + files.map(f => f.name).join(", ");
  setStatus(files.length + " CSV file" + (files.length > 1 ? "s" : "") + " ready. Click Run my weekly check.");
});

async function readFromDrive() {
  if (!S.inv) throw {friendly: "Add your Inventory tab's CSV link in Settings first, or use CSV files instead."};
  if (!getPw()) throw {friendly: "Enter your app password in Settings first."};
  const get = async u => { try { return (await api("/api/sheet?url=" + encodeURIComponent(u))).text; } catch (e) { throw {friendly: sheetErr(e)}; } };
  const inv = await get(S.inv);
  const exp = S.exp ? await get(S.exp) : "";
  return {text: inv + "\n\n" + exp, fileName: "your Google Sheet"};
}
function sheetErr(e) {
  switch (e && e.code) {
    case "bad_password": return "Wrong app password. Open Settings and enter it again.";
    case "bad_url": return "That sheet link doesn't look right. It should start with https://docs.google.com/spreadsheets/ and end in output=csv.";
    case "not_published": return "Google wouldn't share the sheet. Check the tab is published to the web as CSV.";
    case "offline": return "You seem to be offline. Check your connection and try again.";
    default: return "Couldn't read your sheet (" + ((e && e.code) || "error") + "). Try again, or use CSV files instead.";
  }
}

async function extractWithClaude(text) {
  const prompt = "Below is the text of a reselling tracker spreadsheet. Extract the Inventory rows and Expenses rows exactly as written.\n" +
    "Reply with only JSON: {\"inventory\":[{\"item id\":\"\",\"item name\":\"\",\"category\":\"\",\"size/details\":\"\",\"cost\":\"\",\"status\":\"\",\"date bought\":\"\",\"date listed\":\"\",\"platform sold on\":\"\",\"date sold\":\"\",\"sale price\":\"\",\"platform fees\":\"\",\"postage\":\"\"}],\"expenses\":[{\"date\":\"\",\"description\":\"\",\"category\":\"\",\"amount\":\"\"}]}\n" +
    "Copy values as text, dates as DD/MM/YYYY, leave unknowns as empty strings, skip blank rows. Do not calculate anything.\n\n" + text.slice(0, 180000);
  const lower = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  const j = await sample.json(prompt, {modelTier: "quick"});
  return {inv: (j.inventory || []).map(lower), exp: (j.expenses || []).map(lower)};
}

/* ---------- AI ---------- */
async function analyse(nums) {
  const prompt = `You are the weekly analyst for a small UK reselling business: sealed Pokémon TCG, shoes and clothing, sold on eBay, Vinted and StockX.
Today is ${new Date().toDateString()}. Current UK tax year: ${TY.label}.
Owner's sourcing: ${S.source}. Niche test budget: £${S.budget}.

Here are this week's numbers (already calculated, do not recalculate):
${JSON.stringify(nums)}

Reply with ONLY this JSON:
{
 "summary": "2 sentences on how the business is doing, using the numbers",
 "actions": ["top 3 actions for this week, each one short sentence"],
 "stale": [{"name": "exact item name from the stale list", "call": "DROP PRICE" | "MOVE PLATFORM" | "HOLD", "advice": "one short line, e.g. try 10% lower on Vinted"}],
 "drops": [{"name": "upcoming Pokémon TCG set or shoe release", "when": "approximate date or month", "rating": "HIGH" | "MEDIUM" | "LOW", "why": "one line"}],
 "niches": [{"name": "niche", "buy": "typical buy price £", "sell": "typical sell price £", "rating": "HIGH" | "MEDIUM" | "LOW", "why": "one line on demand, competition and risk", "test": "what to buy to test it within budget"}],
 "records": ["2-4 short bookkeeping reminders based on the numbers and issues, e.g. missing data, HMRC trading allowance (£1,000) or platform reporting (30 sales or about £1,700 a year)"]
}
Give up to 4 drops and exactly 4 niches. Only list stale items that appear in the data. Use web search to check upcoming Pokémon TCG and shoe release dates and recent UK sold prices (eBay sold listings, StockX, Cardmarket) for the drops and niches. Keep searches to the essentials. Give price ranges, never invent figures you could not find. Your final message must be only the JSON.`;
  return sample.json(prompt, {modelTier: "default", webSearch: true, maxTokens: 6000});
}

/* ---------- run ---------- */
function step(k, s) { const li = document.querySelector(`#steps li[data-k="${k}"]`); if (li) li.dataset.s = s; }
function setStatus(t, err) { const el = $("#status"); el.textContent = t; el.classList.toggle("err", !!err); }
function sampleErr(e) {
  switch (e && e.code) {
    case "bad_password": return "Wrong app password. Open Settings and enter it again.";
    case "no_key": return "The app has no Claude API key yet. Add ANTHROPIC_API_KEY in Vercel, then redeploy.";
    case "search_tool_rejected": return "The Claude API rejected the web search tool (version web_search_20260209), so Claude's advice couldn't run. Your numbers are below. Please send this message to Claude Code so it can be fixed." + (e.message ? " Claude said: " + String(e.message).slice(0, 200) : "");
    case "offline": return "You seem to be offline. Check your connection and try again.";
    case "not_granted": return "Claude analysis needs your permission. Run again and choose Allow.";
    case "rate_limited": return "You've hit a usage limit. Your numbers are below; try the Claude analysis again later.";
    case "sampling_disabled": return "Claude isn't available for this account, so only the numbers are shown.";
    case "invalid_json": return "Claude's answer came back in the wrong format. Click Run to try again.";
    default: return "Claude analysis didn't finish (" + ((e && e.code) || "error") + "). Your numbers are below; click Run to try again.";
  }
}

$("#runBtn").addEventListener("click", async () => {
  const btn = $("#runBtn"); btn.disabled = true; btn.querySelector("span").textContent = "Running…";
  document.querySelectorAll("#steps li").forEach(li => delete li.dataset.s);
  await capsReady;
  let nums = null, ai = null, source = "";
  try {
    step("read", "run"); setStatus("Reading your tracker…");
    let inv, exp;
    if (csvTexts) {
      inv = []; exp = [];
      for (const t of csvTexts) {
        const i = tableFrom(t, "item name"); if (i) inv.push(...normInventory(i));
        const x = tableFrom(t, "amount"); if (x && !i) exp.push(...normExpenses(x));
      }
      source = "CSV files";
    } else {
      const {text, fileName} = await readFromDrive();
      source = "Google Sheet"; rememberSetup("c-drive"); rememberSetup("c-sheet");
      const i = tableFrom(text, "item name"), x = tableFrom(text, "amount");
      if (i && i.length) { inv = normInventory(i); exp = normExpenses(x); }
      else {
        if (!sample) throw {friendly: "Couldn't read the sheet's layout. Try the CSV option instead."};
        setStatus("Reading your sheet with Claude…");
        const r = await extractWithClaude(text); inv = normInventory(r.inv); exp = normExpenses(r.exp);
      }
    }
    if (!inv.length) throw {friendly: "No items found in your tracker yet. Add your stock to the Inventory tab, then run again."};
    step("read", "done");

    step("crunch", "run"); nums = crunch(inv, exp, S); nums.source = source; step("crunch", "done");
    renderReport({nums, ai: null, pending: true});

    step("ai", "run");
    if (!sample) { step("ai", "err"); setStatus("Claude analysis isn't available here, so only the numbers are shown."); }
    else {
      setStatus("Claude is analysing your week and researching drops. This can take 1 to 2 minutes…");
      try { ai = await analyse(nums); step("ai", "done"); rememberSetup("c-claude"); }
      catch (e) { step("ai", "err"); setStatus(sampleErr(e), true); }
    }
    renderReport({nums, ai});

    step("save", "run");
    if (db && uid) {
      try { await db.collection("data/users/" + uid).doc("r" + Date.now()).set({kind: "report", ts: Date.now(), nums, ai}); step("save", "done"); }
      catch { step("save", "err"); }
    } else step("save", "err");
    if (ai) { rememberSetup("c-run"); showLastRun(Date.now()); }
    if (ai) setStatus("Done. Report saved " + new Date().toLocaleString("en-GB", {weekday: "long", hour: "2-digit", minute: "2-digit"}) + ".");
  } catch (e) {
    document.querySelectorAll('#steps li[data-s="run"]').forEach(li => li.dataset.s = "err");
    setStatus(e && e.friendly ? e.friendly : "Something went wrong reading your tracker. Try again or use CSV files.", true);
  } finally { btn.disabled = false; btn.querySelector("span").textContent = "Run my weekly check"; }
});

/* ---------- render ---------- */
const pillCls = c => ({"DROP PRICE":"drop","MOVE PLATFORM":"move","HOLD":"hold","HIGH":"high","MEDIUM":"med","LOW":"low"}[String(c).toUpperCase()] || "");
function renderReport({nums: n, ai, pending, example}) {
  const tyProfit = n.ty.sales - n.ty.cogs - n.ty.fees - n.ty.post - n.ty.expenses;
  const aiStale = new Map(((ai && ai.stale) || []).map(s => [String(s.name).toLowerCase(), s]));
  const wait = pending ? '<p class="empty">Claude is working on this…</p>' : '<p class="empty">Claude\'s advice wasn\'t available for this run.</p>';
  const when = new Date(n.when).toLocaleString("en-GB", {day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"});
  $("#report").innerHTML = `
  ${example ? '<div class="banner"><svg class="i"><use href="#i-info"/></svg><span><b>This is an example report</b> with made-up figures, so you can see what you\'ll get. Press Run my weekly check to see your own.</span></div>' : ""}
  <div class="tiles">
    <div class="tile"><div class="k">Profit this tax year</div><div class="v ${tyProfit < 0 ? "neg" : "pos"}">${gbp(tyProfit)}</div><div class="s">${n.ty.count} sales after all costs</div></div>
    <div class="tile"><div class="k">Last 7 days</div><div class="v">${gbp(n.week.profit)}</div><div class="s">${n.week.count} sale${n.week.count === 1 ? "" : "s"}, ${gbp(n.week.sales)} taken</div></div>
    <div class="tile"><div class="k">Stock at cost</div><div class="v">${gbp(n.stockValue)}</div><div class="s">${n.counts.inStock} items unsold</div></div>
    <div class="tile"><div class="k">Stale items</div><div class="v ${n.counts.stale ? "neg" : "pos"}">${n.counts.stale}</div><div class="s">listed past your limit</div></div>
  </div>

  <div class="card plan">
    <div class="cardhead"><h3>This week's plan</h3><span class="sub">${esc(n.source || "")} · ${when}</span></div>
    ${ai ? `<p>${esc(ai.summary)}</p><ol class="actions">${(ai.actions || []).map(a => `<li>${esc(a)}</li>`).join("")}</ol>` : wait}
  </div>

  <div class="card">
    <div class="cardhead"><h3>Stale stock <span class="count">${n.stale.length}</span></h3></div>
    ${n.stale.length ? `<div class="tablewrap"><table><thead><tr><th>Item</th><th class="num">Cost</th><th class="num">Days</th><th>What to do</th></tr></thead><tbody>
      ${n.stale.map(s => { const a = aiStale.get(String(s.name).toLowerCase()); return `<tr><td><b>${esc(s.name)}</b>${s.size ? `<div class="sub">${esc(s.size)}</div>` : ""}</td><td class="num">${gbp(s.cost)}</td><td class="num">${s.days}</td><td>${a ? `<span class="pill ${pillCls(a.call)}">${esc(a.call)}</span><div class="sub" style="margin-top:4px">${esc(a.advice)}</div>` : (pending ? '<span class="sub">…</span>' : '<span class="sub">–</span>')}</td></tr>`; }).join("")}
    </tbody></table></div>` : '<p class="empty">Nothing stale. Everything listed is within your limit.</p>'}
  </div>

  <div class="grid2">
    <div class="card"><div class="cardhead"><h3>By category</h3></div><div class="tablewrap"><table><thead><tr><th></th><th class="num">Sold</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>
      ${n.byCat.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${c.count}</td><td class="num">${gbp(c.profit)}</td><td class="num">${Math.round(c.margin * 100)}%</td></tr>`).join("")}</tbody></table></div></div>
    <div class="card"><div class="cardhead"><h3>By platform</h3></div><div class="tablewrap"><table><thead><tr><th></th><th class="num">Sold</th><th class="num">Sales</th><th class="num">Profit</th></tr></thead><tbody>
      ${n.byPlat.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${c.count}</td><td class="num">${gbp(c.sales)}</td><td class="num">${gbp(c.profit)}</td></tr>`).join("")}</tbody></table></div></div>
  </div>

  <div class="grid2">
    <div class="card"><div class="cardhead"><h3>Drops to watch</h3></div>
      ${ai ? (ai.drops || []).map(d => `<div class="item"><div class="t">${esc(d.name)} <span class="pill ${pillCls(d.rating)}">${esc(d.rating)}</span></div><div class="m">${esc(d.when)} · ${esc(d.why)}</div></div>`).join("") + '<p class="note">Researched with live web search during this run. Double-check before you buy.</p>' : wait}
    </div>
    <div class="card"><div class="cardhead"><h3>Niche ideas</h3></div>
      ${ai ? (ai.niches || []).map(d => `<div class="item"><div class="t">${esc(d.name)} <span class="pill ${pillCls(d.rating)}">${esc(d.rating)}</span></div><div class="m">Buy ${esc(d.buy)} · Sell ${esc(d.sell)}</div><div class="m">${esc(d.why)}</div><div class="m"><b>Test:</b> ${esc(d.test)}</div></div>`).join("") + '<p class="note">Estimates only. Check recent sold listings before you test a niche.</p>' : wait}
    </div>
  </div>

  <div class="card">
    <div class="cardhead"><h3>Records and tax check</h3><span class="sub">Tax year ${esc(n.taxYear)}</span></div>
    <div class="tiles" style="margin-bottom:14px">
      <div class="tile" style="box-shadow:none;background:var(--panel2)"><div class="k">Turnover</div><div class="v">${gbp(n.ty.sales)}</div></div>
      <div class="tile" style="box-shadow:none;background:var(--panel2)"><div class="k">Stock sold (cost)</div><div class="v">${gbp(n.ty.cogs)}</div></div>
      <div class="tile" style="box-shadow:none;background:var(--panel2)"><div class="k">Fees + postage</div><div class="v">${gbp(n.ty.fees + n.ty.post)}</div></div>
      <div class="tile" style="box-shadow:none;background:var(--panel2)"><div class="k">Other expenses</div><div class="v">${gbp(n.ty.expenses)}</div></div>
    </div>
    ${n.issues.length ? `<details><summary>${n.issues.length} row${n.issues.length > 1 ? "s" : ""} to fix in your tracker</summary><ul class="plain" style="margin-top:8px">${n.issues.map(i => `<li>${esc(i)}</li>`).join("")}</ul></details>` : '<p class="empty">No missing data found.</p>'}
    ${ai && ai.records ? `<ul class="plain" style="margin-top:12px">${ai.records.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    <p class="note">A guide for your records, not tax advice. Check current rules on gov.uk.</p>
  </div>`;
}

/* ---------- setup checklist & last run ---------- */
function mark(id, state) { const li = $("#" + id); li.classList.toggle("ok", state === true); li.classList.toggle("bad", state === false); updateSetupCount(); }
function updateSetupCount() {
  const ok = document.querySelectorAll("#setupCard .check li.ok").length;
  $("#setupCount").textContent = ok + " of 4";
  $("#setupCard").hidden = ok === 4;
}
function showLastRun(ts) { if (ts) $("#lastRun").innerHTML = "Last run <b>" + esc(new Date(ts).toLocaleDateString("en-GB", {weekday: "long", day: "numeric", month: "short"})) + "</b>"; }
const hr = new Date().getHours();
$("#greet").textContent = (hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening") + ". Ready for your weekly check?";
(async () => {
  try { const done = JSON.parse(localStorage.getItem("rhq-setup") || "{}"); for (const k in done) if (done[k]) mark(k, true); } catch {}
  await capsReady;
  if (mcp) {
    try { const r = await mcp.listTools("Google Drive"); const s = r.servers && r.servers[0]; if (s && s.authStatus === "connected") mark("c-drive", true); else if (!s) mark("c-drive", false); } catch {}
  }
  if (db && uid) {
    try {
      const snap = await db.collection("data/users/" + uid).orderBy("ts", "desc").limit(1).get();
      const last = snap.docs.map(d => d.data()).find(d => d && d.kind === "report");
      if (last) { showLastRun(last.ts); renderReport({nums: last.nums, ai: last.ai}); ["c-drive","c-sheet","c-claude","c-run"].forEach(k => mark(k, true)); }
    } catch {}
  }
})();
function rememberSetup(k) { mark(k, true); try { const d = JSON.parse(localStorage.getItem("rhq-setup") || "{}"); d[k] = true; localStorage.setItem("rhq-setup", JSON.stringify(d)); } catch {} }

/* example state on first load */
renderReport({example: true, nums: {
  when: new Date().toISOString(), taxYear: TY.label, source: "Example data",
  counts: {items: 42, sold: 27, inStock: 15, stale: 3}, stockValue: 1186.5,
  week: {sales: 412, profit: 118.4, count: 5},
  ty: {sales: 3240, cogs: 2105, fees: 286.2, post: 121.8, expenses: 180, count: 27},
  byCat: [{name:"Pokémon",sales:1460,profit:402,count:11,margin:.38},{name:"Shoes",sales:1390,profit:221,count:9,margin:.19},{name:"Clothing",sales:390,profit:123,count:7,margin:.46}],
  byPlat: [{name:"eBay",sales:1620,profit:398,count:13},{name:"Vinted",sales:520,profit:156,count:9},{name:"StockX",sales:1100,profit:192,count:5}],
  stale: [{name:"Example: Jordan 4 Military Black", size:"UK 8", cost:165, days:48},{name:"Example: Carhartt Detroit jacket", size:"M", cost:40, days:37},{name:"Example: Paldean Fates ETB", size:"Sealed", cost:45, days:96}],
  issues: ["Example: Nike Tech Fleece: sale price but no date sold"]
}, ai: {
  summary: "Example: profit is steady and Pokémon is earning the best margin. Shoes tie up the most cash for the lowest return.",
  actions: ["Example: drop the Jordan 4s by 8% and cross-list them on eBay.", "Example: reinvest in sealed Pokémon, your best margin.", "Example: fill in the missing sale date before month end."],
  stale: [{name:"Example: Jordan 4 Military Black", call:"DROP PRICE", advice:"Try 8% lower and cross-list on eBay."},{name:"Example: Carhartt Detroit jacket", call:"MOVE PLATFORM", advice:"Vinted suits workwear better; relist there."},{name:"Example: Paldean Fates ETB", call:"HOLD", advice:"Sealed set out of print; holding is reasonable."}],
  drops: [{name:"Example: next main Pokémon TCG set", when:"Next month", rating:"MEDIUM", why:"Usually heavily printed; only chase the chase-card products."}],
  niches: [{name:"Example: graded Pokémon singles", buy:"£20–£60", sell:"£40–£120", rating:"HIGH", why:"Strong demand, but grading takes weeks.", test:"Buy 3 near-mint raw cards and compare graded sold prices."}],
  records: ["Example: you're past the £1,000 trading allowance, so plan for a Self Assessment return."]
}});

/* ---------- history ---------- */
let histCache = [];
async function loadHistory() {
  await capsReady;
  const box = $("#histList");
  if (!db || !uid) { box.innerHTML = '<div class="banner">History is not available in this browser.</div>'; return; }
  try {
    const snap = await db.collection("data/users/" + uid).orderBy("ts", "desc").limit(20).get();
    histCache = snap.docs.map(d => d.data()).filter(d => d && d.kind === "report");
    if (!histCache.length) { box.innerHTML = '<div class="banner">No saved reports yet. Run your first weekly check to start your history.</div>'; return; }
    box.innerHTML = histCache.map((r, i) => {
      const t = r.nums.ty, p = t.sales - t.cogs - t.fees - t.post - t.expenses;
      return `<button data-i="${i}"><span>${new Date(r.ts).toLocaleDateString("en-GB", {weekday: "short", day: "numeric", month: "short", year: "numeric"})}</span><span class="num">7-day profit ${gbp(r.nums.week.profit)} · tax year ${gbp(p)} · ${r.nums.counts.stale} stale</span></button>`;
    }).join("");
    box.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      const r = histCache[+b.dataset.i]; renderReport({nums: r.nums, ai: r.ai});
      go("home");
      setStatus("Showing the report from " + new Date(r.ts).toLocaleDateString("en-GB") + ".");
    }));
  } catch { box.innerHTML = '<div class="banner">Couldn\'t load your history just now. Try again in a moment.</div>'; }
}

/* ---------- listing writer ---------- */
let listCtl = null;
$("#listPhotos").addEventListener("change", e => {
  $("#thumbs").innerHTML = "";
  [...e.target.files].slice(0, 6).forEach(f => { const img = new Image(); img.alt = f.name; img.src = URL.createObjectURL(f); $("#thumbs").append(img); });
});
const dz = $("#dropZone");
["dragenter","dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
["dragleave","drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
dz.addEventListener("drop", e => { const dt = new DataTransfer(); [...e.dataTransfer.files].filter(f => f.type.startsWith("image/")).slice(0, 6).forEach(f => dt.items.add(f)); $("#listPhotos").files = dt.files; $("#listPhotos").dispatchEvent(new Event("change")); });
$("#listStop").addEventListener("click", () => listCtl && listCtl.abort());
$("#listForm").addEventListener("submit", async e => {
  e.preventDefault(); await capsReady;
  const out = $("#listOut"), notes = $("#listNotes").value.trim(), photos = [...$("#listPhotos").files];
  if (!sample) { out.textContent = "The listing writer isn't available right now."; return; }
  if (!notes && !photos.length) { out.textContent = "Add a photo or a line of notes first."; return; }
  const prompt = `Write resale listings for a UK seller. Category: ${$("#listCat").value}. Platforms: ${$("#listPlat").value}.
Seller's notes: ${notes || "(none, use the photos)"}
${photos.length ? photos.length + " photo(s) of the item are attached." : ""}
Use only facts from the notes and what is clearly visible in the photos. Never invent size, condition, authenticity or flaws; if something important is missing, list it under "CHECK BEFORE POSTING".
Sections (plain text, no markdown symbols):
EBAY: Title (max 80 characters, most-searched words first), Item specifics (one per line), Description (3-5 short lines).
VINTED: Title, Description (2-4 friendly lines plus 3-5 search words), Category and size field.
STOCKX (only for shoes or sealed products, and only if StockX is a chosen platform): exact product name and style code to search, size.
PRICE CHECK: exact eBay sold-listing search terms to confirm price.
CHECK BEFORE POSTING: anything missing.
Use UK spelling and £.`;
  listCtl = new AbortController();
  $("#listBtn").disabled = true; $("#listStop").hidden = false; $("#listCopy").hidden = true;
  out.textContent = "Thinking…";
  try {
    let imgs;
    if (photos.length) { const lim = await sample.limits().catch(() => null); if (lim && lim.images) imgs = photos.slice(0, lim.images.maxCount); }
    await sample(prompt, {signal: listCtl.signal, images: imgs, cache: false, onText: ({text}) => out.textContent = text});
    $("#listCopy").hidden = false;
  } catch (er) {
    out.textContent = er.text || "";
    if (er.code === "images_unavailable" || er.code === "image_rejected") out.textContent += "\n\nThe photos couldn't be used. Try JPEG or PNG files, or describe the item in the notes.";
    else if (er.code !== "cancelled") out.textContent += "\n\n" + sampleErr(er).replace(/Your numbers are below; /, "");
  } finally { $("#listBtn").disabled = false; $("#listStop").hidden = true; }
});

/* ---------- buyer replies ---------- */
$("#replyForm").addEventListener("submit", async e => {
  e.preventDefault(); await capsReady;
  const out = $("#rOut"), msg = $("#rMsg").value.trim();
  if (!sample) { out.textContent = "Buyer replies aren't available right now."; return; }
  if (!msg) { out.textContent = "Paste the buyer's message first."; return; }
  const price = num($("#rPrice").value), cost = num($("#rCost").value);
  const floor = Math.max(price * S.offer / 100, cost ? cost + S.min : 0);
  const prompt = `Draft a reply to a buyer for a UK reseller on ${$("#rPlat").value}.
Item: ${$("#rItem").value || "(not given)"}. Listed at £${price || "?"}. ${cost ? "Seller's cost £" + cost + "." : ""}
Lowest acceptable price: £${floor ? floor.toFixed(2) : "unknown"} (accept offers at or above it; below it, counter politely between their offer and the listed price; counter low-balls once, never rudely).
Seller posts within ${S.post} working days.
Buyer's message: """${msg}"""
Rules: friendly, 1-4 sentences, UK spelling, no emojis unless the buyer used them. Only state facts given here. Never agree to pay or deal outside the platform or share contact details.
Format: the reply text, then a blank line, then "Note:" with one line explaining any counter, or flagging a possible scam, return or dispute.`;
  $("#rBtn").disabled = true; $("#rCopy").hidden = true; out.textContent = "Thinking…";
  try { await sample(prompt, {modelTier: "quick", cache: false, onText: ({text}) => out.textContent = text}); $("#rCopy").hidden = false; }
  catch (er) { out.textContent = (er.text || "") + (er.code !== "cancelled" ? "\n\n" + sampleErr(er).replace(/Your numbers are below; /, "") : ""); }
  finally { $("#rBtn").disabled = false; }
});

/* ---------- copy ---------- */
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); btn.lastChild.textContent = "Copied"; }
  catch { const r = document.createRange(); r.selectNodeContents(btn.id === "rCopy" ? $("#rOut") : $("#listOut")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); btn.lastChild.textContent = "Selected, press Ctrl+C"; }
  setTimeout(() => btn.lastChild.textContent = "Copy", 2000);
}
$("#listCopy").addEventListener("click", e => copy($("#listOut").textContent, e.currentTarget));
$("#rCopy").addEventListener("click", e => copy($("#rOut").textContent.split(/\n\s*Note:/)[0].trim(), e.currentTarget));
})();
