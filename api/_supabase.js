// Reselling HQ: shared Supabase helpers for the server functions (files starting with _ aren't web addresses).

// Turn whatever was pasted into the bare project address, e.g. https://abcd.supabase.co
// Copes with spaces, quotes, a missing https://, /rest/v1/ or any other path, and a dashboard link.
function projectUrl(raw) {
  let v = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  let u;
  try { u = new URL(v); } catch { return null; }
  const dash = u.hostname.endsWith("supabase.com") && u.pathname.match(/\/project\/([a-z0-9]{20})/);
  if (dash) return "https://" + dash[1] + ".supabase.co";
  return u.origin;
}

function config(env = process.env) {
  return {
    url: projectUrl(env.SUPABASE_URL),
    publishable: String(env.SUPABASE_PUBLISHABLE_KEY || "").trim(),
    secret: String(env.SUPABASE_SECRET_KEY || "").trim(),
  };
}

function fail(res, status, code, message) {
  res.status(status).json({ error: { code, message: message || code } });
}

// Works out who is calling from the sign-in token the app sends, and checks they're on the allow list.
// Returns the user ({id, email}) or sends a refusal and returns null.
// checkAllowList: false skips the allow list (so someone taken off it can still delete their account).
async function requireUser(req, res, { checkAllowList = true } = {}) {
  const { url, publishable, secret } = config();
  if (!url || !publishable || !secret) { fail(res, 500, "not_set_up", "Supabase settings are missing on the server."); return null; }
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || "");
  if (!m) { fail(res, 401, "signed_out"); return null; }
  try {
    const r = await fetch(url + "/auth/v1/user", { headers: { apikey: publishable, authorization: "Bearer " + m[1] } });
    if (r.status === 401 || r.status === 403) { fail(res, 401, "signed_out"); return null; }
    if (!r.ok) { fail(res, 502, "auth_error"); return null; }
    const user = await r.json();
    const email = String(user.email || "").toLowerCase();
    if (!user.id || !email) { fail(res, 401, "signed_out"); return null; }
    if (!checkAllowList) return { id: user.id, email };
    const a = await fetch(url + "/rest/v1/allowed_emails?select=email&email=eq." + encodeURIComponent(email), { headers: { apikey: secret } });
    if (!a.ok) { fail(res, 502, "auth_error"); return null; }
    if (!(await a.json()).length) { fail(res, 403, "not_allowed"); return null; }
    return { id: user.id, email };
  } catch {
    fail(res, 502, "auth_error");
    return null;
  }
}

module.exports = { projectUrl, config, fail, requireUser };
