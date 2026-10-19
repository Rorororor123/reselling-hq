// A pretend Supabase for the browser tests, so they run the real sign-in library without a real project.
// It answers the sign-in and database addresses the app uses, and only ever hands a person their own rows
// (like the real row level security). No network, no cost.
const URL_BASE = "https://fakeproj.supabase.co";
const STORAGE_KEY = "sb-fakeproj-auth-token";
const NOW = Date.parse("2026-10-18T09:00:00+01:00"); // the tests' fixed clock

const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = user => [b64({ alg: "HS256", typ: "JWT" }), b64({ sub: user.id, email: user.email, aud: "authenticated", role: "authenticated", exp: NOW / 1000 + 86400 * 30 }), "fakesig"].join(".");
const makeUser = (id, email) => ({ id, email, aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-01T00:00:00Z" });
function session(user) {
  return { access_token: jwt(user), refresh_token: "refresh-" + user.id, token_type: "bearer", expires_in: 86400 * 30, expires_at: Math.floor(NOW / 1000) + 86400 * 30, user };
}

const TRACKER = ["orders", "items", "expenses"];
// What the database fills in itself when a row is added (see supabase/migrations/002_tracker.sql).
const DEFAULTS = {
  orders: () => ({ shop: "", order_ref: "", ordered: "2026-10-18", qty: 1, cost: 0, courier: "", tracking: "", status: "Ordered", preorder: false, release: null, category: "", size: "", notes: "", stocked_at: null }),
  items: () => ({ category: "", size: "", cost: null, status: "In stock", bought: null, listed: null, ask_price: null, platform: "", sold: null, sale_price: null, fees: 0, postage: 0, posted: false, notes: "", order_id: null, import_id: null,
    source: "", source_ref: null, source_title: null, prev_status: null, needs_review: null }),
  expenses: () => ({ date: "2026-10-18", category: "Other", repeat: "once", end_date: null, deductible: true, notes: "" }),
};

// tracker: false pretends 002_tracker.sql hasn't been run. seed: rows to start with, owned by the signed-in person.
async function useFakeSupabase(page, { signedInAs = "me@example.com", allowed = ["me@example.com"], password = "correct-horse", code = "123456", tracker = true, seed = {} } = {}) {
  const users = new Map(); // email -> user
  const userFor = email => { if (!users.has(email)) users.set(email, makeUser("user-" + (users.size + 1), email)); return users.get(email); };
  const store = { settings: [], reports: [], profiles: [], orders: [], items: [], expenses: [], otpSentTo: [], deleted: [], passwords: {} };
  let nextId = 1;
  const stamp = () => new Date(NOW + nextId * 1000).toISOString();
  const addRow = (table, userId, r) => {
    const row = { ...DEFAULTS[table](), id: "row-" + nextId++, created_at: stamp(), updated_at: stamp(), ...r, user_id: userId };
    if (table === "orders" && !row.status_at) row.status_at = row.created_at;
    store[table].push(row);
    return row;
  };
  const byToken = new Map();
  const issue = user => { const s = session(user); byToken.set(s.access_token, user); return s; };

  await page.route("**/api/config", route => route.fulfill({ json: { supabaseUrl: URL_BASE, publishableKey: "sb_publishable_test" } }));
  // eBay isn't set up unless a test says otherwise (tests/ebay.spec.js routes /api/ebay itself).
  await page.route(u => u.pathname === "/api/ebay", route => route.fulfill({ json: { configured: false, env: "sandbox", connected: false } }));
  await page.route("**/api/account", async route => {
    const user = byToken.get((route.request().headers().authorization || "").replace(/^Bearer /, ""));
    if (!user || route.request().method() !== "DELETE") return route.fulfill({ status: 401, json: { error: { code: "signed_out" } } });
    store.deleted.push(user.email);
    for (const t of ["settings", "reports", ...TRACKER]) store[t] = store[t].filter(r => r.user_id !== user.id);
    users.delete(user.email);
    await route.fulfill({ json: { deleted: true } });
  });

  await page.route(URL_BASE + "/**", async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
    const caller = byToken.get((req.headers().authorization || "").replace(/^Bearer /, ""));
    const body = () => { try { return req.postDataJSON(); } catch { return null; } };

    // Sign-in addresses
    if (u.pathname === "/auth/v1/otp") {
      const email = String(body().email).toLowerCase();
      if (!allowed.includes(email)) return json(403, { code: 403, error_code: "hook_error", msg: "Reselling HQ is private for now." });
      store.otpSentTo.push({ email, redirect: u.searchParams.get("redirect_to") });
      return json(200, {});
    }
    if (u.pathname === "/auth/v1/verify") {
      const b = body();
      if (b.token !== code) return json(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return json(200, issue(userFor(String(b.email).toLowerCase())));
    }
    if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "password") {
      const b = body(), email = String(b.email).toLowerCase();
      if (!allowed.includes(email) || b.password !== (store.passwords[email] || password)) return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      return json(200, issue(userFor(email)));
    }
    if (u.pathname === "/auth/v1/user") {
      if (!caller) return json(401, { code: 401, msg: "invalid JWT" });
      if (method === "PUT") { const b = body(); if (b.password) store.passwords[caller.email] = b.password; }
      return json(200, caller);
    }
    if (u.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, body: "" });

    // Database: like row level security, a caller only sees and writes their own rows.
    const table = u.pathname.replace("/rest/v1/", "");
    const one = /vnd\.pgrst\.object/.test(req.headers().accept || "");
    const reply = rows => one ? (rows.length === 1 ? json(200, rows[0]) : json(406, { code: "PGRST116", message: "not one row" })) : json(200, rows);
    if (table === "rpc/move_order_to_stock") {
      if (!tracker) return json(404, { code: "PGRST202", message: "Could not find the function" });
      if (!caller) return json(401, { code: "42501", message: "permission denied" });
      const o = store.orders.find(x => x.id === body().p_order && x.user_id === caller.id);
      if (!o) return json(400, { code: "P0001", message: "order_not_found" });
      if (o.status !== "Delivered") return json(400, { code: "P0001", message: "order_not_delivered" });
      if (o.stocked_at) return json(400, { code: "P0001", message: "order_already_stocked" });
      const each = Math.round(o.cost / o.qty * 100) / 100, made = [];
      for (let i = 1; i <= o.qty; i++) made.push(addRow("items", caller.id, { name: o.item, category: o.category, size: o.size, cost: i === 1 ? Math.round((o.cost - each * (o.qty - 1)) * 100) / 100 : each, bought: o.ordered, order_id: o.id }));
      o.stocked_at = stamp();
      return json(200, made);
    }
    const known = ["settings", "reports", "profiles", ...(tracker ? TRACKER : [])];
    if (!known.includes(table)) return json(404, { code: "PGRST205", message: "Could not find the table 'public." + table + "' in the schema cache" });
    if (!caller) return json(200, []);
    const own = store[table].filter(r => (r.user_id || r.id) === caller.id);
    const idEq = (u.searchParams.get("id") || "").replace(/^eq\./, "");
    if (TRACKER.includes(table)) {
      if (method === "GET") return reply(own);
      if (method === "POST") {
        const rows = [].concat(body());
        if (rows.some(r => r.user_id && r.user_id !== caller.id)) return json(403, { code: "42501", message: "new row violates row-level security policy" });
        const made = rows.map(r => addRow(table, caller.id, r));
        return /return=representation/.test(req.headers().prefer || "") ? reply(made) : json(201);
      }
      const hit = own.filter(r => r.id === idEq);
      if (method === "PATCH") {
        const b = body();
        for (const r of hit) { if (table === "orders" && b.status && b.status !== r.status) r.status_at = stamp(); Object.assign(r, b, { updated_at: stamp() }); }
        return reply(hit);
      }
      if (method === "DELETE") { store[table] = store[table].filter(r => !hit.includes(r)); return json(204); }
    }
    if (method === "GET") {
      let rows = [...own];
      if ((u.searchParams.get("order") || "").startsWith("ts.desc")) rows.sort((a, b) => b.ts - a.ts);
      if (u.searchParams.get("limit")) rows = rows.slice(0, Number(u.searchParams.get("limit")));
      return json(200, rows);
    }
    if (method === "POST") {
      const rows = [].concat(body());
      if (rows.some(r => r.user_id !== caller.id)) return json(403, { code: "42501", message: "new row violates row-level security policy" });
      for (const r of rows) {
        const same = table === "settings" ? x => x.user_id === r.user_id : x => x.user_id === r.user_id && x.id === r.id;
        store[table] = store[table].filter(x => !same(x)).concat([{ ...r }]);
      }
      return json(201);
    }
    return json(405, {});
  });

  if (signedInAs) {
    const s = issue(userFor(signedInAs));
    store.profiles.push({ id: s.user.id, email: signedInAs });
    for (const t of TRACKER) for (const r of seed[t] || []) addRow(t, s.user.id, r);
    // Signed in once, at the first page load of the test (so signing out sticks).
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("seeded", "1"); } }, [STORAGE_KEY, JSON.stringify(s)]);
  }
  store.userFor = userFor;
  return store;
}

module.exports = { useFakeSupabase, STORAGE_KEY };
