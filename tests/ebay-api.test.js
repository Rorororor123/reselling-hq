// Tests for the eBay server functions (api/ebay.js, api/ebay-deletion.js, api/_ebay.js).
// eBay, Supabase's sign-in and the database are all pretend: no real calls, no cost.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import ebay from "../api/ebay.js";
import deletion from "../api/ebay-deletion.js";
import health from "../api/health.js";
const E = require("../api/_ebay.js");

const KEY = crypto.randomBytes(32).toString("base64");
const ENV = {
  SUPABASE_URL: "https://abcd.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SECRET_KEY: "sb_secret_x",
  EBAY_ENV: "sandbox", EBAY_CLIENT_ID: "client-id", EBAY_CLIENT_SECRET: "client-secret", EBAY_RUNAME: "Me-Me-Resell-abcde",
  EBAY_TOKEN_KEY: KEY, EBAY_VERIFICATION_TOKEN: "v".repeat(40), CRON_SECRET: "cron-secret",
};
const USERS = { "token-a": { id: "user-a", email: "me@example.com" }, "token-b": { id: "user-b", email: "other@example.com" } };

function fakeRes() {
  const res = { statusCode: 0, body: null, headers: {}, ended: false };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; res.ended = true; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.end = () => { res.ended = true; return res; };
  return res;
}
const call = async (handler, { method = "GET", query = {}, token, headers = {}, body } = {}) => {
  const res = fakeRes();
  await handler({ method, query, body, headers: { host: "rhq.example", ...(token ? { authorization: "Bearer " + token } : {}), ...headers } }, res);
  return res;
};
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/* ---------- a pretend database (just enough of PostgREST for these functions) ---------- */
function fakeDb() {
  const t = { ebay_connections: [], ebay_app_keys: [], items: [] };
  let next = 1;
  const val = v => v.replace(/^"|"$/g, "");
  const test = (row, col, cond) => {
    const [op, ...rest] = cond.split("."), v = val(rest.join("."));
    if (op === "eq") return String(row[col] ?? "") === v && row[col] != null;
    if (op === "lt") return row[col] != null && row[col] < v;
    if (op === "is") return v === "null" ? row[col] == null : row[col] === (v === "true");
    if (op === "not" && rest[0] === "is") return row[col] != null;
    throw new Error("filter not faked: " + col + "=" + cond);
  };
  const matches = (row, q) => {
    for (const [k, v] of q) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
      if (k === "or") { if (!v.slice(1, -1).split(",").some(p => { const [c, ...r] = p.split("."); return test(row, c, r.join(".")); })) return false; continue; }
      if (!test(row, k, v)) return false;
    }
    return true;
  };
  const defaults = { items: () => ({ category: "", size: "", cost: null, status: "In stock", bought: null, platform: "", sold: null, sale_price: null, fees: 0, postage: 0, posted: false,
    import_id: null, source: "", source_ref: null, source_title: null, prev_status: null, needs_review: null, created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, next)).toISOString() }) };
  const handle = async (url, opts) => {
    const u = new URL(url), table = u.pathname.replace("/rest/v1/", ""), q = [...u.searchParams], method = opts.method || "GET";
    if (!t[table]) return json(404, { code: "PGRST205" });
    const prefer = opts.headers.prefer || "", body = opts.body ? JSON.parse(opts.body) : null;
    const hit = t[table].filter(r => matches(r, q));
    const back = rows => /return=representation/.test(prefer) ? json(200, rows) : json(204);
    if (method === "GET") {
      const off = Number(u.searchParams.get("offset") || 0), lim = Number(u.searchParams.get("limit") || 1e9);
      return json(200, hit.slice(off, off + lim).map(r => ({ ...r })));
    }
    if (method === "PATCH") { hit.forEach(r => Object.assign(r, body)); return back(hit.map(r => ({ ...r }))); }
    if (method === "DELETE") { t[table] = t[table].filter(r => !hit.includes(r)); return json(204); }
    if (method === "POST") {
      const conflict = (u.searchParams.get("on_conflict") || "").split(",").filter(Boolean);
      for (const r of [].concat(body)) {
        const row = { ...(defaults[table] ? defaults[table]() : {}), id: table === "items" ? "item-" + next++ : undefined, ...r };
        const same = conflict.length && t[table].find(x => conflict.every(c => x[c] != null && x[c] === row[c]));
        const dupe = table === "items" && row.source_ref && t.items.find(x => x.user_id === row.user_id && x.source_ref === row.source_ref);
        if (same && /merge-duplicates/.test(prefer)) { Object.assign(same, r); continue; }
        if ((same || dupe) && /ignore-duplicates/.test(prefer)) continue;
        if (same || dupe) return json(409, { code: "23505" });
        t[table].push(row);
      }
      return json(201);
    }
    return json(405, {});
  };
  return { t, handle };
}

/* ---------- a pretend eBay ---------- */
function fakeEbay() {
  const ec = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const e = { orders: [], transactions: [], filters: [], calls: [], refreshOk: true, financesDown: false, signing: null, signedOk: 0,
    notifyKey: ec, issued: 0 };
  e.handle = async (url, opts = {}) => {
    const u = new URL(url), p = u.pathname, auth = (opts.headers || {}).authorization || "";
    e.calls.push(p);
    if (p === "/identity/v1/oauth2/token") {
      if (auth !== "Basic " + Buffer.from("client-id:client-secret").toString("base64")) return json(401, { error: "invalid_client" });
      const f = new URLSearchParams(opts.body);
      if (f.get("grant_type") === "client_credentials") return json(200, { access_token: "app-token", expires_in: 7200 });
      if (f.get("grant_type") === "authorization_code") {
        if (f.get("code") !== "good-code" || f.get("redirect_uri") !== "Me-Me-Resell-abcde") return json(400, { error: "invalid_grant" });
        return json(200, { access_token: "access-1", expires_in: 7200, refresh_token: "refresh-1", refresh_token_expires_in: 47304000 });
      }
      if (f.get("grant_type") === "refresh_token") {
        if (!e.refreshOk || f.get("refresh_token") !== "refresh-1") return json(400, { error: "invalid_grant", error_description: "refresh token revoked" });
        return json(200, { access_token: "access-" + (++e.issued + 1), expires_in: 7200 });
      }
    }
    if (p === "/commerce/identity/v1/user/") return auth.startsWith("Bearer access-") ? json(200, { userId: "EBAYUSER1", username: "rhq_seller" }) : json(401, {});
    if (p === "/sell/fulfillment/v1/order") {
      if (!auth.startsWith("Bearer access-")) return json(401, { errors: [{ message: "Invalid access token" }] });
      e.filters.push(u.searchParams.get("filter"));
      const off = Number(u.searchParams.get("offset")), lim = Number(u.searchParams.get("limit"));
      const page = e.orders.slice(off, off + lim);
      return json(200, { orders: page, total: e.orders.length, next: off + lim < e.orders.length ? "more" : undefined });
    }
    if (p === "/developer/key_management/v1/signing_key") {
      if (auth !== "Bearer app-token") return json(401, {});
      const k = crypto.generateKeyPairSync("ed25519");
      e.signing = k;
      return json(201, { signingKeyId: "key-1", signingKeyCipher: "ED25519", jwe: "JWE-1", expirationTime: 1900000000,
        privateKey: k.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), publicKey: "x" });
    }
    if (p === "/sell/finances/v1/transaction") {
      if (e.financesDown) return json(403, { errors: [{ errorId: 1100, message: "Access denied: insufficient permissions" }] });
      const h = opts.headers, m = /^sig1=\("x-ebay-signature-key" "@method" "@path" "@authority"\);created=(\d+)$/.exec(h["signature-input"] || "");
      const sig = /^sig1=:(.+):$/.exec(h.signature || "");
      const base = m && [`"x-ebay-signature-key": ${h["x-ebay-signature-key"]}`, `"@method": GET`, `"@path": ${p}`, `"@authority": ${u.host}`,
        `"@signature-params": ("x-ebay-signature-key" "@method" "@path" "@authority");created=${m[1]}`].join("\n");
      if (!m || !sig || h["x-ebay-signature-key"] !== "JWE-1" || h["x-ebay-c-marketplace-id"] !== "EBAY_GB"
        || !crypto.verify(null, Buffer.from(base), e.signing.publicKey, Buffer.from(sig[1], "base64"))) return json(400, { errors: [{ errorId: 215122, message: "Signature validation failed" }] });
      e.signedOk++;
      return json(200, { transactions: e.transactions, total: e.transactions.length });
    }
    if (p.startsWith("/commerce/notification/v1/public_key/")) {
      return json(200, { algorithm: "ECDSA", digest: "SHA1", key: ec.publicKey.export({ format: "pem", type: "spki" }).replace(/\n/g, "") });
    }
    return json(404, {});
  };
  return e;
}

let db, eb;
function wire() {
  return vi.fn(async (url, opts = {}) => {
    opts.headers = opts.headers || {};
    if (url === "https://abcd.supabase.co/auth/v1/user") {
      const u = USERS[(opts.headers.authorization || "").replace("Bearer ", "")];
      return u ? json(200, u) : json(401, {});
    }
    if (url.startsWith("https://abcd.supabase.co/rest/v1/allowed_emails")) return json(200, [{ email: "me@example.com" }, { email: "other@example.com" }].filter(r => url.includes(encodeURIComponent(r.email))));
    if (url.startsWith("https://abcd.supabase.co/rest/v1/")) {
      if (opts.headers.apikey !== "sb_secret_x") return json(401, {});
      return db.handle(url, opts);
    }
    if (/^https:\/\/(api|apiz|auth)\.sandbox\.ebay\.com\//.test(url)) return eb.handle(url, opts);
    throw new Error("unexpected address " + url);
  });
}
const order = (id, title, fields = {}) => ({
  orderId: id, creationDate: "2026-10-10T12:00:00.000Z", orderFulfillmentStatus: "FULFILLED", orderPaymentStatus: "PAID", cancelStatus: { cancelState: "NONE_REQUESTED" },
  totalMarketplaceFee: { value: "9.00" }, buyer: { username: "a_buyer" },
  lineItems: [{ lineItemId: id + "1", title, quantity: 1, sku: "", lineItemCost: { value: "60.00" }, deliveryCost: { shippingCost: { value: "3.50" } }, lineItemFulfillmentStatus: "FULFILLED" }],
  ...fields,
});
async function connect(token = "token-a") {
  const start = await call(ebay, { method: "POST", query: { action: "connect" }, token });
  const state = new URL(start.body.url).searchParams.get("state");
  return call(ebay, { query: { action: "callback", code: "good-code", state } });
}
const sync = (token = "token-a") => call(ebay, { method: "POST", query: { action: "sync" }, token });

beforeEach(() => {
  Object.assign(process.env, ENV);
  db = fakeDb(); eb = fakeEbay();
  vi.stubGlobal("fetch", wire());
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T09:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const k of Object.keys(ENV)) delete process.env[k]; delete process.env.EBAY_DELETION_URL; delete process.env.EBAY_FINANCES; });

describe("encryption and the sign-in state", () => {
  const key = Buffer.from(KEY, "base64");
  it("tokens go in encrypted and only come out for the same owner", () => {
    const sealed = E.seal("refresh-secret", key, "refresh:user-a");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("refresh-secret");
    expect(E.unseal(sealed, key, "refresh:user-a")).toBe("refresh-secret");
    expect(() => E.unseal(sealed, key, "refresh:user-b")).toThrow();
    const raw = Buffer.from(sealed.slice(3), "base64"); raw[raw.length - 1] ^= 1;
    expect(() => E.unseal("v1." + raw.toString("base64"), key, "refresh:user-a")).toThrow();
    expect(() => E.unseal(sealed, crypto.randomBytes(32), "refresh:user-a")).toThrow();
  });
  it("the state can't be faked, changed or reused after 10 minutes", () => {
    const s = E.makeState("user-a", key, 1000);
    expect(E.readState(s, key, 2000)).toBe("user-a");
    expect(E.readState(s, key, 1000 + 10 * 60000 + 1)).toBe(null);
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "user-b", n: "x", x: 9e15 })).toString("base64url");
    expect(E.readState(forged + "." + sig, key, 2000)).toBe(null);
    expect(E.readState(body + ".AAAA", key, 2000)).toBe(null);
    expect(E.readState(s, crypto.randomBytes(32), 2000)).toBe(null);
    expect(E.readState("", key)).toBe(null);
  });
  it("the tax year starts on 6 April (UK time)", () => {
    expect(new Date(E.taxYearStart(Date.parse("2026-10-19T09:00:00Z"))).toISOString()).toBe("2026-04-05T23:00:00.000Z");
    expect(new Date(E.taxYearStart(Date.parse("2027-04-05T12:00:00Z"))).toISOString()).toBe("2026-04-05T23:00:00.000Z");
    expect(new Date(E.taxYearStart(Date.parse("2027-04-06T12:00:00Z"))).toISOString()).toBe("2027-04-05T23:00:00.000Z");
  });
});

describe("connecting eBay", () => {
  it("needs you to be signed in", async () => {
    expect((await call(ebay, { method: "POST", query: { action: "connect" } })).statusCode).toBe(401);
  });
  it("sends you to eBay's own sign-in with the RuName, the read-only order permission and a state", async () => {
    const r = await call(ebay, { method: "POST", query: { action: "connect" }, token: "token-a" });
    const u = new URL(r.body.url);
    expect(u.origin + u.pathname).toBe("https://auth.sandbox.ebay.com/oauth2/authorize");
    expect(u.searchParams.get("client_id")).toBe("client-id");
    expect(u.searchParams.get("redirect_uri")).toBe("Me-Me-Resell-abcde");
    expect(u.searchParams.get("scope").split(" ")).toContain("https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly");
    expect(E.readState(u.searchParams.get("state"), Buffer.from(KEY, "base64"))).toBe("user-a");
  });
  it("coming back from eBay saves the tokens encrypted and says connected", async () => {
    const r = await connect();
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe("/?ebay=connected");
    const c = db.t.ebay_connections[0];
    expect(c).toMatchObject({ user_id: "user-a", env: "sandbox", ebay_user_id: "EBAYUSER1", ebay_username: "rhq_seller", needs_reconnect: false });
    expect(JSON.stringify(c)).not.toMatch(/refresh-1|access-1/);
    const st = await call(ebay, { query: { action: "status" }, token: "token-a" });
    expect(st.body).toMatchObject({ configured: true, env: "sandbox", connected: true, username: "rhq_seller" });
    expect(JSON.stringify(st.body)).not.toMatch(/token|v1\./i);
  });
  it("EBAY_FINANCES=off leaves out the fees permission (fees then come from the order totals)", async () => {
    process.env.EBAY_FINANCES = "off";
    const r = await call(ebay, { method: "POST", query: { action: "connect" }, token: "token-a" });
    expect(new URL(r.body.url).searchParams.get("scope")).not.toContain("sell.finances");
    expect((await call(ebay, { query: { action: "callback", error: "invalid_scope" } })).headers.location).toBe("/?ebay=error&reason=scope");
    delete process.env.EBAY_FINANCES;
  });
  it("a declined, faked or stale sign-in connects nothing", async () => {
    expect((await call(ebay, { query: { action: "callback", error: "access_denied" } })).headers.location).toBe("/?ebay=declined");
    expect((await call(ebay, { query: { action: "callback", code: "good-code", state: "made.up" } })).headers.location).toBe("/?ebay=error&reason=expired");
    const start = await call(ebay, { method: "POST", query: { action: "connect" }, token: "token-a" });
    const state = new URL(start.body.url).searchParams.get("state");
    expect((await call(ebay, { query: { action: "callback", code: "bad-code", state } })).headers.location).toBe("/?ebay=error&reason=connect_failed");
    vi.setSystemTime(new Date("2026-10-19T09:11:00Z"));
    expect((await call(ebay, { query: { action: "callback", code: "good-code", state } })).headers.location).toBe("/?ebay=error&reason=expired");
    expect(db.t.ebay_connections).toEqual([]);
  });
  it("says so plainly when eBay isn't set up on this website", async () => {
    delete process.env.EBAY_CLIENT_ID;
    expect((await call(ebay, { query: { action: "status" }, token: "token-a" })).body).toMatchObject({ configured: false, connected: false });
    expect((await call(ebay, { method: "POST", query: { action: "connect" }, token: "token-a" })).statusCode).toBe(503);
  });
});

describe("syncing", () => {
  beforeEach(async () => {
    db.t.items.push(
      { ...{ category: "", size: "UK 9", cost: 120, status: "Listed", bought: "2026-09-01", platform: "", sold: null, sale_price: null, fees: 0, postage: 0, posted: false, import_id: null, source: "", source_ref: null, source_title: null, prev_status: null, needs_review: null, created_at: "2026-09-01T00:00:00Z" },
        id: "stock-1", user_id: "user-a", name: "Jordan 4 Military Black" },
      // Someone else's identical stock: must never be touched.
      { category: "", size: "UK 9", cost: 99, status: "Listed", bought: "2026-08-01", platform: "", sold: null, sale_price: null, fees: 0, postage: 0, posted: false, import_id: null, source: "", source_ref: null, source_title: null, prev_status: null, needs_review: null, created_at: "2026-08-01T00:00:00Z",
        id: "stock-b", user_id: "user-b", name: "Jordan 4 Military Black" });
    eb.orders = [order("O1", "Air Jordan 4 Retro Military Black UK 9"), order("O2", "Pokemon Surging Sparks ETB")];
    eb.transactions = [
      { transactionType: "SALE", orderId: "O1", bookingEntry: "CREDIT", amount: { value: "51.00" }, totalFeeAmount: { value: "12.50" } },
      { transactionType: "SHIPPING_LABEL", orderId: "O1", bookingEntry: "DEBIT", amount: { value: "3.85" } },
    ];
    await connect();
  });

  it("first sync: everything since 6 April, matched to your stock, fees and postage from eBay's Finances (signed)", async () => {
    const r = await sync();
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatchObject({ ok: true, orders: 2, matched: 1, added: 1, review: 2, finances: "ok", from: "2026-04-05" });
    expect(eb.filters).toEqual(["creationdate:[2026-04-05T23:00:00.000Z..]"]);
    expect(eb.signedOk).toBe(1);
    const mine = db.t.items.filter(i => i.user_id === "user-a");
    expect(mine.find(i => i.id === "stock-1")).toMatchObject({ status: "Sold", platform: "eBay", sold: "2026-10-10", sale_price: 63.5, fees: 12.5, postage: 3.85, posted: true,
      source: "ebay", source_ref: "ebay:O1:O11:1", prev_status: "Listed", needs_review: "match", cost: 120 });
    expect(mine.find(i => i.source_ref === "ebay:O2:O21:1")).toMatchObject({ name: "Pokemon Surging Sparks ETB", cost: null, fees: 9, needs_review: "new" });
    expect(db.t.items.find(i => i.id === "stock-b")).toMatchObject({ status: "Listed", source_ref: null });
    expect(JSON.stringify(db.t.items)).not.toContain("a_buyer");
    // The signing key is kept, encrypted, for next time.
    expect(db.t.ebay_app_keys[0]).toMatchObject({ env: "sandbox", jwe: "JWE-1" });
    expect(db.t.ebay_app_keys[0].private_key).toMatch(/^v1\./);
    const c = db.t.ebay_connections[0];
    expect(c).toMatchObject({ synced_to: "2026-10-19T09:00:00.000Z", sync_started_at: null, last_sync: { ok: true, added: 1 } });
  });

  it("syncing again adds nothing twice, and looks at what changed since last time", async () => {
    await sync();
    const before = JSON.stringify(db.t.items);
    vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
    const r = await sync();
    expect(r.body).toMatchObject({ ok: true, added: 0, matched: 0, linked: 0, updated: 0, undone: 0 });
    expect(JSON.stringify(db.t.items)).toBe(before);
    expect(eb.filters.slice(1)).toEqual(["lastmodifieddate:[2026-10-17T09:00:00.000Z..]", "creationdate:[2026-09-20T09:00:00.000Z..]"]);
    expect(eb.calls.filter(p => p === "/developer/key_management/v1/signing_key")).toHaveLength(1);
  });

  it("a later cancel undoes the sale: matched stock goes back to Listed, the added one is removed", async () => {
    await sync();
    eb.orders = eb.orders.map(o => ({ ...o, cancelStatus: { cancelState: "CANCELED" } }));
    const r = await sync();
    expect(r.body).toMatchObject({ undone: 2 });
    expect(db.t.items.find(i => i.id === "stock-1")).toMatchObject({ status: "Listed", sold: null, sale_price: null, source_ref: null, prev_status: null });
    expect(db.t.items.filter(i => i.user_id === "user-a")).toHaveLength(1);
  });

  it("with EBAY_FINANCES=off it doesn't ask the Finances API at all", async () => {
    process.env.EBAY_FINANCES = "off";
    const r = await sync();
    delete process.env.EBAY_FINANCES;
    expect(r.body).toMatchObject({ ok: true, finances: "switched off (EBAY_FINANCES=off)" });
    expect(eb.calls).not.toContain("/sell/finances/v1/transaction");
    expect(db.t.items.find(i => i.id === "stock-1")).toMatchObject({ fees: 9 });
  });
  it("if eBay's Finances API says no, fees come from the order totals and the sync still works", async () => {
    eb.financesDown = true;
    const r = await sync();
    expect(r.body).toMatchObject({ ok: true, matched: 1, added: 1 });
    expect(r.body.finances).toMatch(/Access denied/);
    expect(db.t.items.find(i => i.id === "stock-1")).toMatchObject({ fees: 9, postage: 0 });
  });

  it("refreshes an expired eBay sign-in, and asks you to connect again when eBay has revoked it", async () => {
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    expect((await sync()).body.ok).toBe(true);
    expect(eb.issued).toBe(1);
    vi.setSystemTime(new Date("2026-10-19T15:00:00Z"));
    eb.refreshOk = false;
    const r = await sync();
    expect(r.statusCode).toBe(502);
    expect(r.body.error.code).toBe("reconnect");
    expect(db.t.ebay_connections[0]).toMatchObject({ needs_reconnect: true, sync_started_at: null });
    expect((await call(ebay, { query: { action: "status" }, token: "token-a" })).body.needsReconnect).toBe(true);
  });

  it("never runs two syncs at once for the same person", async () => {
    db.t.ebay_connections[0].sync_started_at = "2026-10-19T08:58:00.000Z";
    const r = await sync();
    expect(r.statusCode).toBe(409);
    expect(db.t.items.find(i => i.id === "stock-1").status).toBe("Listed");
    db.t.ebay_connections[0].sync_started_at = "2026-10-19T08:50:00.000Z"; // a sync that crashed long ago doesn't block forever
    expect((await sync()).statusCode).toBe(200);
  });

  it("someone without an eBay connection can't sync anyone else's", async () => {
    const r = await sync("token-b");
    expect(r.statusCode).toBe(404);
    expect(db.t.items.find(i => i.id === "stock-1").status).toBe("Listed");
  });

  it("disconnect forgets the sign-in and eBay's order numbers, but your sales stay", async () => {
    await sync();
    const r = await call(ebay, { method: "POST", query: { action: "disconnect" }, token: "token-a" });
    expect(r.body).toEqual({ disconnected: true });
    expect(db.t.ebay_connections).toEqual([]);
    const mine = db.t.items.filter(i => i.user_id === "user-a");
    expect(mine).toHaveLength(2);
    expect(mine.every(i => i.status === "Sold" && i.source_ref === null && i.source === "ebay")).toBe(true);
    // Connecting again later doesn't double up: the sales already in the tracker are linked.
    await connect();
    const again = await sync();
    expect(again.body).toMatchObject({ added: 0, matched: 0, linked: 2 });
    expect(db.t.items.filter(i => i.user_id === "user-a")).toHaveLength(2);
  });

  it("the daily job needs the CRON_SECRET and syncs everyone connected", async () => {
    expect((await call(ebay, {})).statusCode).toBe(401);
    expect((await call(ebay, { headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    const r = await call(ebay, { headers: { authorization: "Bearer cron-secret" } });
    expect(r.body).toEqual({ synced: 1, failed: 0, skipped: 0 });
    expect(db.t.items.find(i => i.id === "stock-1").status).toBe("Sold");
  });
});

describe("eBay's account-deletion notices", () => {
  it("answers eBay's challenge with SHA-256 of code + token + this address", async () => {
    const r = await call(deletion, { query: { challenge_code: "abc123" } });
    const want = crypto.createHash("sha256").update("abc123" + "v".repeat(40) + "https://rhq.example/api/ebay-deletion").digest("hex");
    expect(r.body).toEqual({ challengeResponse: want });
    process.env.EBAY_DELETION_URL = "https://resellinghq.vercel.app/api/ebay-deletion";
    expect((await call(deletion, { query: { challenge_code: "abc123" } })).body.challengeResponse)
      .toBe(crypto.createHash("sha256").update("abc123" + "v".repeat(40) + "https://resellinghq.vercel.app/api/ebay-deletion").digest("hex"));
  });
  const notice = { metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0", deprecated: false },
    notification: { notificationId: "n-1", eventDate: "2026-10-19T08:00:00.000Z", publishDate: "2026-10-19T08:00:01.000Z", publishAttemptCount: 1,
      data: { username: "rhq_seller", userId: "EBAYUSER1", eiasToken: "x" } } };
  const signed = (body, key = eb.notifyKey.privateKey) => Buffer.from(JSON.stringify({ alg: "ECDSA", kid: "kid-1", digest: "SHA1",
    signature: crypto.sign("sha1", Buffer.from(JSON.stringify(body)), key).toString("base64") })).toString("base64");
  it("a genuine notice forgets that eBay user's connection and order numbers", async () => {
    await connect();
    db.t.items.push({ id: "s1", user_id: "user-a", name: "x", status: "Sold", source: "ebay", source_ref: "ebay:O1:1:1" });
    const r = await call(deletion, { method: "POST", body: notice, headers: { "x-ebay-signature": signed(notice) } });
    expect(r.statusCode).toBe(204);
    expect(db.t.ebay_connections).toEqual([]);
    expect(db.t.items[0]).toMatchObject({ status: "Sold", source_ref: null });
  });
  it("a notice that isn't really from eBay is refused and changes nothing", async () => {
    await connect();
    deletion.keys.clear();
    const fake = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    expect((await call(deletion, { method: "POST", body: notice, headers: { "x-ebay-signature": signed(notice, fake) } })).statusCode).toBe(412);
    expect((await call(deletion, { method: "POST", body: notice })).statusCode).toBe(412);
    expect(db.t.ebay_connections).toHaveLength(1);
  });
});

describe("health check: eBay", () => {
  it("says what's missing, then ok once eBay accepts the keys", async () => {
    for (const k of ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME"]) delete process.env[k];
    expect((await call(health)).body.ebay).toMatch(/^not set up/);
    Object.assign(process.env, ENV, { EBAY_TOKEN_KEY: "short" });
    expect((await call(health)).body.ebay).toMatch(/EBAY_TOKEN_KEY should be 32 random bytes/);
    Object.assign(process.env, ENV, { EBAY_CLIENT_SECRET: "wrong" });
    expect((await call(health)).body.ebay).toMatch(/eBay refused EBAY_CLIENT_ID or EBAY_CLIENT_SECRET: check they're the sandbox keys/);
    Object.assign(process.env, ENV);
    const r = await call(health);
    expect(r.body.ebay).toBe("ok (sandbox)");
    expect(r.body.settings).toMatchObject({ EBAY_CLIENT_ID: "set", CRON_SECRET: "set" });
    expect(JSON.stringify(r.body)).not.toContain("client-secret");
  });
});
