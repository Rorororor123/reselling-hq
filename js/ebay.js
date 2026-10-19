// Reselling HQ: the eBay card in Settings (connect, sync now, disconnect) and checking the eBay sales
// the sync wasn't sure about. The server side is api/ebay.js; the matching rules are in js/core.js.
(() => {
const R = RHQ, {esc, gbp} = R;
const $ = s => document.querySelector(s);
const account = window.RHQAccount, app = window.RHQApp, tr = window.RHQTracker, T = tr.data;
const {toast, niceDate, plural} = tr;
const money = v => v == null || v === "" ? null : R.num(v);
let status = null, syncing = false;

async function call(action, method = "GET") {
  let r, j = {};
  try {
    r = await fetch("/api/ebay?action=" + action, {method, headers: {authorization: "Bearer " + await account.token()}});
    j = await r.json().catch(() => ({}));
  } catch { throw {code: "offline", message: "Couldn't reach Reselling HQ. Check your connection."}; }
  if (!r.ok) throw {code: (j.error && j.error.code) || "failed", message: (j.error && j.error.message) || "", status: r.status};
  return j;
}

/* ---------- the Settings card ---------- */
function ago(t) {
  const m = Math.round((Date.now() - Date.parse(t)) / 60000);
  if (!(m >= 0)) return "";
  if (m < 1) return "just now";
  if (m < 60) return plural(m, "minute") + " ago";
  if (m < 1440) return plural(Math.round(m / 60), "hour") + " ago";
  return "on " + niceDate(String(t).slice(0, 10));
}
function summary(l) {
  if (!l || !l.at) return "";
  if (!l.ok) return "Didn't finish: " + (l.message || "something went wrong") + ".";
  const parts = [l.added && plural(l.added, "new sale"), l.matched && `${l.matched} matched to your stock`, l.linked && `${l.linked} already in your sales`,
    l.updated && plural(l.updated, "sale") + " updated", l.undone && `${l.undone} cancelled and undone`].filter(Boolean);
  return parts.length ? parts.join(", ") + "." : "No new eBay sales.";
}
function render() {
  const out = $("#ebayOut"), tag = $("#ebayTag"), s = status;
  tag.innerHTML = s && s.connected && !s.needsReconnect ? tr.pill("Connected") : "";
  if (!s) { out.innerHTML = '<p class="sub" style="margin:0">Checking your eBay connection…</p>'; return; }
  if (s.error) { out.innerHTML = `<p class="sub" style="margin:0">Couldn't check your eBay connection just now. <button class="linkbtn" type="button" data-ebay="status">Try again</button></p>`; return; }
  const sandbox = s.env === "sandbox" ? ' <span class="sub">(eBay sandbox: test accounts only)</span>' : "";
  const note = '<p class="sub" style="margin:10px 0 0">You sign in on eBay\'s own website: Reselling HQ never sees your eBay password. It brings in the item, price, fees, postage and dates of each sale, and stores no buyer names or addresses.</p>';
  if (!s.configured) { out.innerHTML = '<p style="margin:0">eBay isn\'t set up on this website yet: the EBAY_ settings are missing in Vercel. The README has the steps.</p>'; return; }
  if (s.tablesMissing) { out.innerHTML = '<div class="banner err"><span><b>One more setup step:</b> run <b>supabase/migrations/003_ebay.sql</b> in the Supabase SQL Editor, then reload.</span></div>'; return; }
  if (!s.connected) {
    out.innerHTML = `<p style="margin:0 0 12px">Bring in your eBay sales automatically, with fees and postage, matched to your stock.${sandbox}</p>
      <div class="btnrow"><button class="btn primary" type="button" data-ebay="connect"><svg class="i"><use href="#i-tag"/></svg>Connect eBay</button></div>${note}`;
    return;
  }
  const l = s.lastSync || {};
  const fees = l.ok && l.finances && l.finances !== "ok"
    ? `<p class="sub" style="margin:8px 0 0">Fees come from eBay's order totals for now (eBay's Finances API answered: ${esc(l.finances)}). Postage you type yourself stays.</p>` : "";
  out.innerHTML = (s.needsReconnect ? `<div class="banner err" style="margin-bottom:12px"><span><b>eBay has signed Reselling HQ out.</b> Connect again to keep your sales coming in. Nothing has been lost.</span></div>` : "")
    + `<p style="margin:0">Connected as <b>${esc(s.username || "your eBay account")}</b>${sandbox}</p>
    <p class="sub" style="margin:4px 0 0" data-ebay-last>${s.lastSyncAt ? `Last synced ${esc(ago(s.lastSyncAt))}. ${esc(summary(l))}` : "Not synced yet."} New sales come in once a day, and when you open the app.</p>${fees}
    <div class="btnrow" style="margin-top:12px">${s.needsReconnect ? '<button class="btn primary" type="button" data-ebay="connect">Connect again</button>'
      : `<button class="btn primary" type="button" data-ebay="sync"${syncing ? " disabled" : ""}>${syncing ? "Syncing…" : "Sync now"}</button>`}
      <button class="btn" type="button" data-ebay="disconnect">Disconnect</button></div>`;
}
async function refresh() {
  try { status = await call("status"); } catch { status = {error: true}; }
  render();
  return status;
}
async function sync(quiet) {
  if (syncing) return;
  syncing = true; render();
  try {
    const r = await call("sync", "POST");
    await tr.reload();
    const n = r.added + r.matched + r.linked + r.updated + r.undone;
    if (!quiet || n) toast("eBay: " + summary({...r, at: 1}) + (r.review ? ` ${plural(r.review, "sale")} to check on the dashboard.` : ""));
  } catch (e) {
    if (!quiet) toast(e.code === "busy" ? "A sync is already running. Try again in a minute." : e.message ? "eBay sync didn't finish: " + e.message : "eBay sync didn't finish. Try again in a moment.");
  } finally {
    syncing = false;
    await refresh();
  }
}
$("#ebayOut").addEventListener("click", async e => {
  const b = e.target.closest("[data-ebay]"); if (!b) return;
  const what = b.dataset.ebay;
  if (what === "status") return refresh();
  if (what === "sync") return sync(false);
  if (what === "connect") {
    b.disabled = true;
    try { location.href = (await call("connect", "POST")).url; }
    catch (err) { b.disabled = false; toast(err.message || "Couldn't start connecting to eBay. Try again in a moment."); }
    return;
  }
  if (what === "disconnect") {
    if (!confirm("Disconnect eBay?\n\nReselling HQ forgets your eBay sign-in and eBay's order numbers. Your sales stay in your tracker.\n\nTo remove access on eBay's side too: eBay, Account settings, Third-party app permissions.")) return;
    b.disabled = true;
    try { await call("disconnect", "POST"); toast("eBay disconnected. Your sales are still here."); }
    catch { toast("Couldn't disconnect just now. Try again in a moment."); }
    await refresh();
  }
});

// Coming back from eBay's sign-in, and the automatic sync when the app opens.
const REASONS = {expired: "That eBay sign-in took too long or was already used. Try Connect eBay again.", not_set_up: "eBay isn't set up on this website yet.",
  tables_missing: "Run supabase/migrations/003_ebay.sql in Supabase first, then connect again.", connect_failed: "eBay didn't finish connecting. Try Connect eBay again.",
  scope: "eBay hasn't switched on the fees permission for this app yet. Add EBAY_FINANCES = off in Vercel, redeploy, and connect again."};
tr.ready.then(async () => {
  const q = new URLSearchParams(location.search), back = q.get("ebay");
  if (back) {
    history.replaceState(null, "", location.pathname + location.hash);
    app.go("set");
    if (back === "declined") toast("Nothing was connected: you didn't agree on eBay's page.");
    if (back === "error") toast(REASONS[q.get("reason")] || REASONS.connect_failed);
  }
  const s = await refresh();
  if (!s.connected || s.needsReconnect || s.syncing) return;
  if (back === "connected") { toast("eBay connected. Bringing in your sales since 6 April…"); return sync(false); }
  if (!s.lastSyncAt || Date.now() - Date.parse(s.lastSyncAt) > 12 * 3600000) sync(true);
});

/* ---------- checking an eBay sale ---------- */
const sheet = $("#reviewSheet"), body = $("#reviewBody");
const SALE = ["platform", "sold", "sale_price", "fees", "postage", "posted", "source", "source_ref", "source_title"];
const KEEP = ["status", ...SALE, "prev_status", "needs_review", "cost"];
const unsale = st => ({status: st, platform: "", sold: null, sale_price: null, fees: 0, postage: 0, posted: false, source: "", source_ref: null, source_title: null, prev_status: null, needs_review: null});
let cur = null;

async function patch(i, p) {
  const {data, error} = await account.from("items").update(p).eq("id", i.id).select().single();
  if (error) throw error;
  Object.assign(i, data);
}
// Moves an eBay sale from the row it's on to another stock item (or a new item). The database
// won't hold the same eBay sale twice, so it comes off the first row before going on the second.
async function moveSale(s, target) {
  const before = Object.fromEntries([...KEEP, "name"].map(k => [k, s[k]])), sale = Object.fromEntries(SALE.map(k => [k, s[k]])), added = !s.prev_status;
  await patch(s, added ? {source_ref: null} : unsale(s.prev_status));
  try {
    if (target.id) await patch(target, {...sale, status: "Sold", prev_status: target.status, needs_review: null});
    else {
      const {data, error} = await account.from("items").insert({name: (before.source_title || before.name || "eBay sale").slice(0, 300), cost: target.cost, ...sale, status: "Sold", prev_status: null, needs_review: null}).select().single();
      if (error) throw error;
      T.items.push(data);
    }
  } catch (e) {
    await patch(s, before).catch(() => {});
    throw e;
  }
  if (added) {
    const {error} = await account.from("items").delete().eq("id", s.id);
    if (!error) T.items = T.items.filter(x => x !== s);
  }
}

function saleLine(s) {
  return [s.sold ? "Sold " + niceDate(s.sold) : "", money(s.sale_price) != null ? gbp(money(s.sale_price)) : "", money(s.fees) ? "fees " + gbp(money(s.fees)) : "", money(s.postage) ? "postage " + gbp(money(s.postage)) : ""].filter(Boolean).join(" · ");
}
function picker(s) {
  const held = T.items.filter(i => i.status !== "Sold" && i.id !== s.id).sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
  const opt = i => `<option value="${esc(i.id)}">${esc(i.name)}${i.size ? " · " + esc(i.size) : ""}${money(i.cost) != null ? " · " + gbp(money(i.cost)) : ""}</option>`;
  const group = (label, st) => { const g = held.filter(i => i.status === st); return g.length ? `<optgroup label="${label}">${g.map(opt).join("")}</optgroup>` : ""; };
  return `<div class="sheetgrid" data-pick${s.needs_review === "match" ? " hidden" : ""}>
    <label class="full">Which item was it?<select name="item_id">${held.length ? '<option value="">Choose an item…</option>' : ""}${group("Listed", "Listed")}${group("In stock", "In stock")}<option value="new">Not in my stock: keep it as its own item</option></select></label>
    <label data-cost hidden>What you paid (£)<input type="number" name="cost" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 40"></label></div>`;
}
function openReview(s) {
  document.querySelectorAll("dialog[open]").forEach(d => d.close());
  cur = s;
  const title = s.source_title && s.source_title !== s.name ? `<span class="sub" style="display:block">On eBay: ${esc(s.source_title)}</span>` : "";
  const what = `<div class="banner"><div style="display:grid;gap:2px"><b>${esc(s.name)}${s.size ? ` <span class="sub">${esc(s.size)}</span>` : ""}</b>${title}<span class="sub">${esc(saleLine(s))}</span></div></div>`;
  const msg = '<p class="formmsg" role="alert"></p>';
  const edit = '<button class="linkbtn" type="button" data-rv="edit" style="margin-left:auto">Edit the sale instead</button>';
  $("#reviewTitle").textContent = s.needs_review === "cancelled" ? "Cancelled eBay order" : "Check eBay sale";
  if (s.needs_review === "cancelled") {
    body.innerHTML = what + `<p style="margin:0">eBay says this order was cancelled or fully refunded. If the item came back to you, undo the sale and it goes back into your stock.</p>${msg}
      <div class="btnrow"><button class="btn primary" type="button" data-rv="undo">Undo the sale</button><button class="btn" type="button" data-rv="ok">Keep the sale</button>${edit}</div>`;
  } else if (s.needs_review === "match") {
    const cost = money(s.cost);
    body.innerHTML = what + `<p style="margin:0" data-ask>The sync matched this eBay sale to <b>${esc(s.name)}</b> in your stock by its name${cost != null ? ` (cost ${gbp(cost)})` : ""}. Is that the right item?</p>
      <div class="btnrow" data-ask><button class="btn primary" type="button" data-rv="ok">Yes, that's right</button><button class="btn" type="button" data-rv="other">No, it was something else</button></div>
      ${picker(s)}${msg}<div class="btnrow" data-save hidden><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-close>Cancel</button>${edit}</div>`;
  } else {
    body.innerHTML = what + `<p style="margin:0">This eBay sale didn't match anything in your stock. Pick the item it was, so its cost counts, or keep it as its own item.</p>
      ${picker(s)}${msg}<div class="btnrow"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" data-close>Cancel</button>${edit}</div>`;
  }
  sheet.showModal();
}
const fail = () => { body.querySelector(".formmsg").textContent = "Couldn't save just now. Check your connection and try again."; };
const done = text => { sheet.close(); tr.renderAll(); toast(text); };
body.addEventListener("change", e => {
  if (e.target.name === "item_id") body.querySelector("[data-cost]").hidden = e.target.value !== "new";
});
body.addEventListener("click", async e => {
  const b = e.target.closest("[data-rv]"); if (!b || !cur) return;
  const s = cur, what = b.dataset.rv;
  if (what === "edit") { sheet.close(); if (tr.openItem) tr.openItem(s); return; }
  if (what === "other") { body.querySelectorAll("[data-ask]").forEach(x => x.hidden = true); body.querySelector("[data-pick]").hidden = false; body.querySelector("[data-save]").hidden = false; return; }
  b.disabled = true;
  try {
    if (what === "ok") { await patch(s, {needs_review: null}); return done("Thanks, that sale's checked."); }
    if (what === "undo") { await patch(s, unsale(s.prev_status && s.prev_status !== "Sold" ? s.prev_status : "In stock")); return done(`${s.name} is back in your stock.`); }
  } catch { b.disabled = false; fail(); }
});
$("#reviewForm").addEventListener("submit", async e => {
  e.preventDefault();
  const s = cur; if (!s) return;
  const sel = body.querySelector('[name="item_id"]'), msg = body.querySelector(".formmsg"), btn = body.querySelector('[type="submit"]');
  const id = sel.value, costIn = body.querySelector('[name="cost"]').value, cost = costIn === "" ? null : Math.round(Number(costIn) * 100) / 100;
  if (!id) { msg.textContent = "Choose which item it was."; return sel.focus(); }
  if (cost != null && !(cost >= 0 && cost < 1e8)) { msg.textContent = "The cost should be an amount in pounds, like 40."; return; }
  btn.disabled = true; msg.textContent = "";
  try {
    if (id === "new") {
      // Didn't match anything: it stays as its own item. A wrong name match moves to a new item.
      if (!s.prev_status) await patch(s, {cost, needs_review: null});
      else await moveSale(s, {cost});
      return done(cost == null ? "Saved. Add the cost when you know it." : "Saved.");
    }
    const target = T.items.find(i => i.id === id);
    if (!target) { btn.disabled = false; msg.textContent = "Choose which item it was."; return; }
    await moveSale(s, target);
    done(`Sale moved to ${target.name}.`);
  } catch { btn.disabled = false; fail(); }
});

tr.openReview = openReview;
})();
