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

async function useFakeSupabase(page, { signedInAs = "me@example.com", allowed = ["me@example.com"], password = "correct-horse", code = "123456" } = {}) {
  const users = new Map(); // email -> user
  const userFor = email => { if (!users.has(email)) users.set(email, makeUser("user-" + (users.size + 1), email)); return users.get(email); };
  const store = { settings: [], reports: [], profiles: [], otpSentTo: [], deleted: [], passwords: {} };
  const byToken = new Map();
  const issue = user => { const s = session(user); byToken.set(s.access_token, user); return s; };

  await page.route("**/api/config", route => route.fulfill({ json: { supabaseUrl: URL_BASE, publishableKey: "sb_publishable_test" } }));
  await page.route("**/api/account", async route => {
    const user = byToken.get((route.request().headers().authorization || "").replace(/^Bearer /, ""));
    if (!user || route.request().method() !== "DELETE") return route.fulfill({ status: 401, json: { error: { code: "signed_out" } } });
    store.deleted.push(user.email);
    for (const t of ["settings", "reports"]) store[t] = store[t].filter(r => r.user_id !== user.id);
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
    if (!["settings", "reports", "profiles"].includes(table)) return json(404, { code: "PGRST205", message: "not found" });
    if (!caller) return json(200, []);
    const own = store[table].filter(r => (r.user_id || r.id) === caller.id);
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
    // Signed in once, at the first page load of the test (so signing out sticks).
    await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem(k, v); sessionStorage.setItem("seeded", "1"); } }, [STORAGE_KEY, JSON.stringify(s)]);
  }
  store.userFor = userFor;
  return store;
}

module.exports = { useFakeSupabase, STORAGE_KEY };
