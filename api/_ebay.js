// Reselling HQ: eBay helpers for the server (sign-in, tokens, fetching sales, the sync itself).
// Files starting with _ aren't web addresses. Keys only ever come from Vercel's environment variables.
// The matching and money rules live in js/core.js (ebaySales, planEbaySync) so they can be tested on their own.
const crypto = require("crypto");
const RHQ = require("../js/core.js");
const { config } = require("./_supabase");

// The permissions we ask for: read your orders, your fees (Finances) and your eBay user name. Nothing that can change your eBay.
// EBAY_FINANCES=off leaves out the fees permission, if eBay hasn't switched it on for your keyset.
const FINANCES = "https://api.ebay.com/oauth/api_scope/sell.finances";
const SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  FINANCES,
  "https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
];
const APP_SCOPE = "https://api.ebay.com/oauth/api_scope";
const HOSTS = {
  production: { auth: "https://auth.ebay.com", api: "https://api.ebay.com", apiz: "https://apiz.ebay.com" },
  sandbox: { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com", apiz: "https://apiz.sandbox.ebay.com" },
};
const DAY = 86400000;

class EbayError extends Error {
  constructor(code, message, status) { super(message || code); this.code = code; this.status = status || 0; }
}

/* ---------- settings ---------- */
const clean = v => String(v || "").trim().replace(/^["']|["']$/g, "");
function keyBytes(v) {
  const b = Buffer.from(clean(v), "base64");
  return b.length === 32 ? b : null;
}
function settings(env = process.env) {
  const name = clean(env.EBAY_ENV).toLowerCase() === "production" ? "production" : "sandbox";
  const s = {
    env: name, ...HOSTS[name],
    clientId: clean(env.EBAY_CLIENT_ID), clientSecret: clean(env.EBAY_CLIENT_SECRET), ruName: clean(env.EBAY_RUNAME),
    key: keyBytes(env.EBAY_TOKEN_KEY), verificationToken: clean(env.EBAY_VERIFICATION_TOKEN), cronSecret: clean(env.CRON_SECRET),
    finances: clean(env.EBAY_FINANCES).toLowerCase() !== "off",
  };
  s.scopes = s.finances ? SCOPES : SCOPES.filter(x => x !== FINANCES);
  s.ready = !!(s.clientId && s.clientSecret && s.ruName && s.key);
  return s;
}
// Separate keys for separate jobs, all made from EBAY_TOKEN_KEY.
const subKey = (key, label) => crypto.createHmac("sha256", key).update(label).digest();

/* ---------- encryption (AES-256-GCM) ---------- */
// "context" ties a token to its owner, so a token copied onto someone else's row won't open.
function seal(text, key, context) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", subKey(key, "tokens"), iv);
  c.setAAD(Buffer.from(context));
  const body = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return "v1." + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
function unseal(sealed, key, context) {
  const raw = Buffer.from(String(sealed || "").replace(/^v1\./, ""), "base64");
  if (!/^v1\./.test(sealed || "") || raw.length < 29) throw new EbayError("bad_token");
  const d = crypto.createDecipheriv("aes-256-gcm", subKey(key, "tokens"), raw.subarray(0, 12));
  d.setAAD(Buffer.from(context));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

/* ---------- the sign-in "state" ---------- */
// Signed, and only good for 10 minutes: proves the eBay sign-in was started by this person from this app.
const b64u = b => Buffer.from(b).toString("base64url");
function makeState(userId, key, now = Date.now()) {
  const body = b64u(JSON.stringify({ u: userId, n: crypto.randomBytes(9).toString("base64url"), x: now + 10 * 60000 }));
  return body + "." + b64u(crypto.createHmac("sha256", subKey(key, "state")).update(body).digest());
}
function readState(state, key, now = Date.now()) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", subKey(key, "state")).update(body).digest(), got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return p.x > now && typeof p.u === "string" ? p.u : null;
  } catch { return null; }
}

/* ---------- talking to eBay ---------- */
function authorizeUrl(s, state) {
  const q = new URLSearchParams({ client_id: s.clientId, redirect_uri: s.ruName, response_type: "code", scope: s.scopes.join(" "), state });
  return s.auth + "/oauth2/authorize?" + q.toString();
}
async function tokenCall(s, form) {
  let r;
  try {
    r = await fetch(s.api + "/identity/v1/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(s.clientId + ":" + s.clientSecret).toString("base64") },
      body: new URLSearchParams(form).toString(),
    });
  } catch { throw new EbayError("ebay_unreachable", "Couldn't reach eBay."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new EbayError(j.error || "token_failed", j.error_description || "eBay refused the sign-in (" + r.status + ").", r.status);
  return j;
}
const appToken = s => tokenCall(s, { grant_type: "client_credentials", scope: APP_SCOPE }).then(j => j.access_token);

async function ebayGet(url, token, headers = {}) {
  let r;
  try { r = await fetch(url, { headers: { authorization: "Bearer " + token, accept: "application/json", ...headers } }); }
  catch { throw new EbayError("ebay_unreachable", "Couldn't reach eBay."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = (j.errors && j.errors[0]) || {};
    throw new EbayError(r.status === 401 ? "ebay_signed_out" : r.status === 403 ? "ebay_forbidden" : "ebay_error",
      (e.message || "eBay answered with an error") + " (" + r.status + (e.errorId ? ", error " + e.errorId : "") + ")", r.status);
  }
  return j;
}

// Who the eBay account is (for the Settings card and eBay's account-deletion notices).
async function identity(s, token) {
  try { const j = await ebayGet(s.apiz + "/commerce/identity/v1/user/", token); return { userId: String(j.userId || ""), username: String(j.username || "") }; }
  catch { return { userId: "", username: "" }; }
}

async function fetchOrders(s, token, filter) {
  const out = [];
  for (let offset = 0, page = 0; page < 50; page++) {
    const j = await ebayGet(`${s.api}/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=200&offset=${offset}`, token);
    const list = j.orders || [];
    out.push(...list);
    if (!list.length || !j.next) break;
    offset += list.length;
  }
  return out;
}

/* ---------- digital signatures (Finances API, UK sellers) ---------- */
// eBay's Key Management API gives the app a signing key once; eBay never stores the private part, so we do (encrypted).
async function signingKey(s, db, now = Date.now()) {
  const rows = await db(`ebay_app_keys?env=eq.${s.env}&select=*`);
  const row = rows && rows[0];
  if (row && (!row.expires_at || Date.parse(row.expires_at) > now + 7 * DAY)) return { jwe: row.jwe, key: unseal(row.private_key, s.key, "signing:" + s.env) };
  const token = await appToken(s);
  let r;
  try {
    r = await fetch(s.apiz + "/developer/key_management/v1/signing_key", {
      method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ signingKeyCipher: "ED25519" }),
    });
  } catch { throw new EbayError("ebay_unreachable", "Couldn't reach eBay."); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.jwe || !j.privateKey) throw new EbayError("signing_key_failed", "eBay didn't give a signing key (" + r.status + ").", r.status);
  const exp = Number(j.expirationTime) || 0;
  await db("ebay_app_keys?on_conflict=env", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal",
    body: { env: s.env, signing_key_id: String(j.signingKeyId || ""), jwe: j.jwe, private_key: seal(j.privateKey, s.key, "signing:" + s.env),
      expires_at: exp ? new Date(exp < 1e12 ? exp * 1000 : exp).toISOString() : null } });
  return { jwe: j.jwe, key: j.privateKey };
}
function privateKeyOf(k) {
  const t = String(k).trim();
  return /BEGIN/.test(t) ? crypto.createPrivateKey(t) : crypto.createPrivateKey({ key: Buffer.from(t, "base64"), format: "der", type: "pkcs8" });
}
// The signature headers (HTTP Message Signatures) for a request with no body.
function signHeaders(s, sk, method, url, now = Date.now()) {
  const u = new URL(url), params = `("x-ebay-signature-key" "@method" "@path" "@authority");created=${Math.floor(now / 1000)}`;
  const base = [`"x-ebay-signature-key": ${sk.jwe}`, `"@method": ${method}`, `"@path": ${u.pathname}`, `"@authority": ${u.host}`, `"@signature-params": ${params}`].join("\n");
  const sig = crypto.sign(null, Buffer.from(base), privateKeyOf(sk.key)).toString("base64");
  return { "x-ebay-signature-key": sk.jwe, "signature-input": "sig1=" + params, signature: `sig1=:${sig}:`, ...(s.env === "sandbox" ? { "x-ebay-enforce-signature": "true" } : {}) };
}
async function fetchTransactions(s, token, sk, fromIso, toIso, now = Date.now()) {
  const out = [];
  for (let offset = 0, page = 0; page < 50; page++) {
    const url = `${s.apiz}/sell/finances/v1/transaction?filter=${encodeURIComponent(`transactionDate:[${fromIso}..${toIso}]`)}&limit=1000&offset=${offset}`;
    const j = await ebayGet(url, token, { "x-ebay-c-marketplace-id": "EBAY_GB", ...signHeaders(s, sk, "GET", url, now) });
    const list = j.transactions || [];
    out.push(...list);
    if (!list.length || !j.next) break;
    offset += list.length;
  }
  return out;
}

/* ---------- the database (server side, secret key) ---------- */
// Every query here names the user it's for: the secret key skips the database's own rules.
function rest(env = process.env) {
  const { url, secret } = config(env);
  return async function db(path, { method = "GET", body, prefer } = {}) {
    if (!url || !secret) throw new EbayError("not_set_up", "Supabase settings are missing on the server.");
    let r;
    try {
      r = await fetch(url + "/rest/v1/" + path, { method, headers: { apikey: secret, "content-type": "application/json", ...(prefer ? { prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new EbayError("db_unreachable", "Couldn't reach the database."); }
    const text = await r.text().catch(() => "");
    if (!r.ok) throw new EbayError(r.status === 404 ? "tables_missing" : "db_error", "Database error " + r.status + ": " + text.slice(0, 200), r.status);
    return text ? JSON.parse(text) : null;
  };
}
const ITEM_COLS = "id,name,size,status,platform,sold,sale_price,fees,postage,posted,cost,bought,created_at,import_id,source,source_ref,source_title,prev_status,needs_review";
async function userItems(db, userId) {
  const out = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const rows = await db(`items?user_id=eq.${userId}&select=${ITEM_COLS}&order=created_at.asc,id.asc&limit=1000&offset=${offset}`);
    out.push(...(rows || []));
    if (!rows || rows.length < 1000) break;
  }
  return out;
}
// Disconnect (and eBay's account-deletion notice): forget the sign-in and eBay's order numbers. Your sales stay.
async function forget(db, userId) {
  await db(`ebay_connections?user_id=eq.${userId}`, { method: "DELETE" });
  await db(`items?user_id=eq.${userId}&source=eq.ebay&source_ref=not.is.null`, { method: "PATCH", body: { source_ref: null }, prefer: "return=minimal" });
}
async function getConnection(db, userId) {
  const rows = await db(`ebay_connections?user_id=eq.${userId}&select=*`);
  return (rows && rows[0]) || null;
}

/* ---------- the sync ---------- */
// The start of the UK tax year we're in (6 April, which is always in British Summer Time).
function taxYearStart(now = Date.now()) {
  const d = new Date(now).toLocaleDateString("en-CA", { timeZone: "Europe/London" }), y = Number(d.slice(0, 4));
  return new Date(`${d.slice(5) >= "04-06" ? y : y - 1}-04-06T00:00:00+01:00`).getTime();
}
const isoAt = t => new Date(t).toISOString();

async function accessToken(s, db, c, now) {
  if (c.access_token && Date.parse(c.access_expires_at) > now + 60000) {
    try { return unseal(c.access_token, s.key, "access:" + c.user_id); } catch { /* fall through to a refresh */ }
  }
  let refresh;
  try { refresh = unseal(c.refresh_token, s.key, "refresh:" + c.user_id); } catch { throw new EbayError("reconnect", "The saved eBay sign-in can't be read (was EBAY_TOKEN_KEY changed?). Connect eBay again."); }
  let j;
  try { j = await tokenCall(s, { grant_type: "refresh_token", refresh_token: refresh, scope: s.scopes.join(" ") }); }
  catch (e) {
    if (e.code === "invalid_grant" || e.status === 400 || e.status === 401) throw new EbayError("reconnect", "eBay has signed Reselling HQ out. Connect eBay again.");
    throw e;
  }
  await db(`ebay_connections?user_id=eq.${c.user_id}`, { method: "PATCH", prefer: "return=minimal",
    body: { access_token: seal(j.access_token, s.key, "access:" + c.user_id), access_expires_at: isoAt(now + (Number(j.expires_in) || 7200) * 1000) } });
  return j.access_token;
}

async function runSync(s, db, c, now) {
  const token = await accessToken(s, db, c, now);
  const ty = taxYearStart(now);
  // First time: everything since 6 April. After that: anything eBay changed since last time (cancels, refunds,
  // posting), plus the last 30 days again because eBay's fees can arrive a day or two after the sale.
  const filters = !c.synced_to ? [`creationdate:[${isoAt(ty)}..]`]
    : [`lastmodifieddate:[${isoAt(Math.max(ty, Date.parse(c.synced_to) - 2 * DAY))}..]`, `creationdate:[${isoAt(Math.max(ty, now - 30 * DAY))}..]`];
  const byId = new Map();
  for (const f of filters) for (const o of await fetchOrders(s, token, f)) if (o && o.orderId) byId.set(o.orderId, o);
  const orders = [...byId.values()];

  let transactions = null, finances = s.finances ? "ok" : "switched off (EBAY_FINANCES=off)";
  if (orders.length && s.finances) {
    const from = Math.min(...orders.map(o => Date.parse(o.creationDate) || now)) - DAY;
    try { transactions = await fetchTransactions(s, token, await signingKey(s, db, now), isoAt(from), isoAt(now), now); }
    catch (e) { finances = String(e.message || e.code).slice(0, 200); }
  }
  const units = RHQ.ebaySales(orders, transactions);
  const plan = RHQ.planEbaySync(await userItems(db, c.user_id), units);
  for (let k = 0; k < plan.inserts.length; k += 100)
    await db("items?on_conflict=user_id,source_ref", { method: "POST", prefer: "resolution=ignore-duplicates,return=minimal",
      body: plan.inserts.slice(k, k + 100).map(r => ({ ...r, user_id: c.user_id })) });
  for (const u of plan.updates) await db(`items?id=eq.${u.id}&user_id=eq.${c.user_id}`, { method: "PATCH", body: u.patch, prefer: "return=minimal" });
  for (const id of plan.deletes) await db(`items?id=eq.${id}&user_id=eq.${c.user_id}&source_ref=not.is.null`, { method: "DELETE" });
  return { ok: true, orders: orders.length, ...plan.counts, finances, from: c.synced_to ? null : isoAt(ty).slice(0, 10) };
}

// Syncs one person's eBay sales into their tracker. Never runs twice at once for the same person.
async function syncUser(userId, { s = settings(), db = rest(), now = Date.now() } = {}) {
  const c = await getConnection(db, userId);
  if (!c) return { ok: false, code: "not_connected" };
  if (c.env !== s.env) return { ok: false, code: "wrong_env", message: `Connected to eBay's ${c.env}, but this website now uses ${s.env}. Disconnect and connect again.` };
  const stale = isoAt(now - 5 * 60000);
  const got = await db(`ebay_connections?user_id=eq.${userId}&or=${encodeURIComponent(`(sync_started_at.is.null,sync_started_at.lt."${stale}")`)}`,
    { method: "PATCH", body: { sync_started_at: isoAt(now) }, prefer: "return=representation" });
  if (!got || !got.length) return { ok: false, code: "busy", message: "A sync is already running. Try again in a minute." };
  let result;
  try {
    result = await runSync(s, db, got[0], now);
    await db(`ebay_connections?user_id=eq.${userId}`, { method: "PATCH", prefer: "return=minimal",
      body: { synced_to: isoAt(now), last_sync_at: isoAt(now), last_sync: { ...result, at: isoAt(now) }, sync_started_at: null, needs_reconnect: false } });
  } catch (e) {
    result = { ok: false, code: e.code || "failed", message: String(e.message || "The sync didn't finish.").slice(0, 300) };
    await db(`ebay_connections?user_id=eq.${userId}`, { method: "PATCH", prefer: "return=minimal",
      body: { last_sync: { ...result, at: isoAt(now) }, sync_started_at: null, ...(e.code === "reconnect" ? { needs_reconnect: true } : {}) } }).catch(() => {});
  }
  return result;
}

module.exports = {
  SCOPES, EbayError, settings, seal, unseal, makeState, readState, authorizeUrl, tokenCall, appToken, ebayGet, identity,
  signHeaders, rest, forget, getConnection, syncUser, taxYearStart,
};
