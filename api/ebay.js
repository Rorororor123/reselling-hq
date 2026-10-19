// Reselling HQ: connect eBay, bring in your eBay sales, disconnect.
//   GET  /api/ebay?action=status      what the Settings card shows
//   POST /api/ebay?action=connect     gives the eBay sign-in link
//   GET  /api/ebay?action=callback    where eBay sends you back after you agree (no sign-in token: the "state" proves who you are)
//   POST /api/ebay?action=sync        Sync now
//   POST /api/ebay?action=disconnect  forgets the eBay sign-in; your sales stay
//   GET  /api/ebay (from Vercel's daily job, with CRON_SECRET) syncs everyone connected
// You sign in on eBay's own site. Reselling HQ never sees your eBay password.
const { fail, requireUser } = require("./_supabase");
const E = require("./_ebay");

const back = (res, query) => { res.statusCode = 302; res.setHeader("location", "/?" + query); res.setHeader("cache-control", "no-store"); res.end(); };

module.exports = async (req, res) => {
  const s = E.settings(), action = String((req.query && req.query.action) || "");
  res.setHeader("cache-control", "no-store");

  if (!action && req.method === "GET") return cron(req, res, s);
  if (action === "callback") return callback(req, res, s);

  const user = await requireUser(req, res);
  if (!user) return;
  const db = E.rest();
  try {
    if (action === "status" && req.method === "GET") {
      const c = s.ready ? await E.getConnection(db, user.id).catch(e => { if (e.code === "tables_missing") return { missing: true }; throw e; }) : null;
      if (c && c.missing) return res.status(200).json({ configured: s.ready, env: s.env, connected: false, tablesMissing: true });
      return res.status(200).json({
        configured: s.ready, env: s.env, connected: !!c,
        ...(c ? { username: c.ebay_username, connectedEnv: c.env, needsReconnect: !!c.needs_reconnect, lastSyncAt: c.last_sync_at, lastSync: c.last_sync,
          syncing: !!c.sync_started_at && Date.parse(c.sync_started_at) > Date.now() - 5 * 60000 } : {}),
      });
    }
    if (!s.ready) return fail(res, 503, "ebay_not_set_up", "eBay isn't set up on this website yet.");
    if (req.method !== "POST") return fail(res, 405, "method_not_allowed");
    if (action === "connect") return res.status(200).json({ url: E.authorizeUrl(s, E.makeState(user.id, s.key)) });
    if (action === "sync") {
      const r = await E.syncUser(user.id, { s, db });
      return res.status(r.ok ? 200 : r.code === "not_connected" ? 404 : r.code === "busy" ? 409 : 502).json(r.ok ? r : { error: { code: r.code, message: r.message } });
    }
    if (action === "disconnect") { await E.forget(db, user.id); return res.status(200).json({ disconnected: true }); }
    return fail(res, 404, "unknown_action");
  } catch (e) {
    return fail(res, e.code === "tables_missing" ? 503 : 502, e.code || "failed", e.code === "tables_missing" ? "Run supabase/migrations/003_ebay.sql in Supabase." : "Something went wrong talking to eBay or the database.");
  }
};

// eBay sends you back here with a one-time code, which we swap for your eBay tokens and save encrypted.
async function callback(req, res, s) {
  const q = req.query || {};
  if (q.error === "invalid_scope") return back(res, "ebay=error&reason=scope");
  if (q.error) return back(res, "ebay=declined");
  if (!s.ready) return back(res, "ebay=error&reason=not_set_up");
  const userId = E.readState(q.state, s.key);
  if (!userId) return back(res, "ebay=error&reason=expired");
  if (!q.code) return back(res, "ebay=declined");
  const db = E.rest(), now = Date.now();
  try {
    const t = await E.tokenCall(s, { grant_type: "authorization_code", code: String(q.code), redirect_uri: s.ruName });
    if (!t.refresh_token || !t.access_token) throw new E.EbayError("token_failed");
    const who = await E.identity(s, t.access_token);
    await db("ebay_connections?on_conflict=user_id", { method: "POST", prefer: "resolution=merge-duplicates,return=minimal", body: {
      user_id: userId, env: s.env, ebay_user_id: who.userId.slice(0, 200), ebay_username: who.username.slice(0, 200),
      refresh_token: E.seal(t.refresh_token, s.key, "refresh:" + userId),
      refresh_expires_at: new Date(now + (Number(t.refresh_token_expires_in) || 47304000) * 1000).toISOString(),
      access_token: E.seal(t.access_token, s.key, "access:" + userId),
      access_expires_at: new Date(now + (Number(t.expires_in) || 7200) * 1000).toISOString(),
      needs_reconnect: false, sync_started_at: null,
    } });
    return back(res, "ebay=connected");
  } catch (e) {
    return back(res, "ebay=error&reason=" + encodeURIComponent(e.code === "tables_missing" ? "tables_missing" : "connect_failed"));
  }
}

// Vercel's daily job (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
async function cron(req, res, s) {
  if (!s.cronSecret || req.headers.authorization !== "Bearer " + s.cronSecret) return fail(res, 401, "not_allowed");
  if (!s.ready) return res.status(200).json({ skipped: "ebay_not_set_up" });
  const db = E.rest(), started = Date.now(), out = { synced: 0, failed: 0, skipped: 0 };
  const conns = (await db(`ebay_connections?env=eq.${s.env}&needs_reconnect=eq.false&select=user_id`)) || [];
  for (const c of conns) {
    if (Date.now() - started > 45000) { out.skipped++; continue; } // tomorrow's run picks them up
    const r = await E.syncUser(c.user_id, { s, db }).catch(() => ({ ok: false }));
    r.ok ? out.synced++ : out.failed++;
  }
  res.status(200).json(out);
}
