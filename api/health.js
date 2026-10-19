// Reselling HQ: open /api/health to check the server's settings. Shows which settings exist, never their values.
const { projectUrl } = require("./_supabase");
const E = require("./_ebay");
const NAMES = ["ANTHROPIC_API_KEY", "APP_PASSWORD", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
  "EBAY_ENV", "EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME", "EBAY_TOKEN_KEY", "EBAY_VERIFICATION_TOKEN", "CRON_SECRET", "EBAY_FINANCES"];
// Public Supabase Auth addresses that answer with just the publishable key (sent as the apikey header).
const CHECKS = ["/auth/v1/health", "/auth/v1/settings"];

module.exports = async (req, res) => {
  const env = process.env;
  const url = projectUrl(env.SUPABASE_URL);
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || "").trim();
  const out = {
    claude: env.ANTHROPIC_API_KEY ? "key set" : "no key",
    supabase: "ok",
    settings: Object.fromEntries(NAMES.map(n => [n, env[n] ? "set" : "missing"])),
    // Which deployment answered (Vercel adds these itself), to spot a stale link or the wrong project.
    deployment: {
      environment: env.VERCEL_ENV || "unknown",
      branch: env.VERCEL_GIT_COMMIT_REF || "unknown",
      commit: (env.VERCEL_GIT_COMMIT_SHA || "unknown").slice(0, 7),
      project: env.VERCEL_PROJECT_PRODUCTION_URL || "unknown",
    },
  };
  if (!env.SUPABASE_URL || !key) {
    out.supabase = "not set up: add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy";
  } else if (!url) {
    out.supabase = "SUPABASE_URL doesn't look like a web address: it should be like https://abcd.supabase.co";
  } else if (key.startsWith("sb_secret_")) {
    out.supabase = "SUPABASE_PUBLISHABLE_KEY holds a secret key (sb_secret_): use the publishable key (sb_publishable_) and delete the secret one from that setting";
  } else {
    out.supabaseUrl = url; // the project address isn't secret; the key is never shown
    if (url !== String(env.SUPABASE_URL).trim()) out.supabaseUrlNote = "extra bits on the end of SUPABASE_URL were ignored; you can tidy it to " + url;
    out.supabase = await check(url, key, out);
    if (out.supabase === "ok") out.accounts = await checkAccounts(url, String(env.SUPABASE_SECRET_KEY || "").trim());
  }
  out.ebay = await checkEbay(env, out.supabase === "ok" && url, String(env.SUPABASE_SECRET_KEY || "").trim());
  res.setHeader("cache-control", "no-store");
  res.status(out.supabase === "ok" ? 200 : 503).json(out);
};

async function check(url, key, out) {
  let status = 0;
  for (const path of CHECKS) {
    out.checked = url + path;
    try {
      const r = await fetch(url + path, { headers: { apikey: key } });
      status = r.status;
    } catch {
      return "couldn't reach " + url + ": check SUPABASE_URL is your Project URL";
    }
    if (status >= 200 && status < 300) return "ok";
    if (status !== 404) break; // only a "not found" is worth trying the next address for
  }
  if (status === 401 || status === 403) return "Supabase refused the key: check SUPABASE_PUBLISHABLE_KEY is the publishable key (sb_publishable_) from this same project";
  if (status === 404) return "Supabase couldn't find " + out.checked + " (404): check SUPABASE_URL is the Project URL from Project Settings, Data API";
  return "Supabase answered with an error (" + status + "): it may be paused or restarting, check the Supabase dashboard";
}

// Sign-in needs the secret key and the Stage 3 tables. Counts the allow list without showing any email.
async function checkAccounts(url, secret) {
  if (!secret) return "not set up: add SUPABASE_SECRET_KEY in Vercel, then redeploy";
  if (!secret.startsWith("sb_secret_")) return "SUPABASE_SECRET_KEY should start with sb_secret_: copy the secret key from Project Settings, API Keys";
  let r;
  try { r = await fetch(url + "/rest/v1/allowed_emails?select=email", { headers: { apikey: secret } }); } catch { return "couldn't reach Supabase"; }
  if (r.status === 401 || r.status === 403) return "Supabase refused SUPABASE_SECRET_KEY: check it's the secret key from this same project";
  if (r.status === 404) return "tables missing: run supabase/migrations/001_accounts.sql in the Supabase SQL Editor";
  if (!r.ok) return "Supabase answered with an error (" + r.status + ")";
  const n = (await r.json()).length;
  if (!n) return "allow list is empty: add your email (see README, Stage 3 setup)";
  return "ok (" + n + " email" + (n > 1 ? "s" : "") + " on the allow list)";
}

// eBay (Stage 5): the settings are all there, eBay accepts the keys, and the eBay tables exist.
async function checkEbay(env, url, secret) {
  if (!env.EBAY_CLIENT_ID && !env.EBAY_CLIENT_SECRET && !env.EBAY_RUNAME) return "not set up: add the EBAY_ settings in Vercel (see README, eBay)";
  const s = E.settings(env);
  const missing = ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_RUNAME", "EBAY_TOKEN_KEY"].filter(n => !String(env[n] || "").trim());
  if (missing.length) return "missing " + missing.join(", ");
  if (!s.key) return "EBAY_TOKEN_KEY should be 32 random bytes in base64 (44 characters ending in =): make one with the SQL in the README";
  if (/^https?:/i.test(s.ruName)) return "EBAY_RUNAME should be the RuName eBay shows (like Your_Name-YourName-Resell-abcde), not a web address";
  try { await E.appToken(s); } catch (e) {
    if (e.code === "ebay_unreachable") return "couldn't reach eBay";
    return "eBay refused EBAY_CLIENT_ID or EBAY_CLIENT_SECRET: check they're the " + s.env + " keys (App ID and Cert ID) from the same keyset";
  }
  if (url && secret) {
    try {
      const r = await fetch(url + "/rest/v1/ebay_connections?select=user_id&limit=1", { headers: { apikey: secret } });
      if (r.status === 404) return "tables missing: run supabase/migrations/003_ebay.sql in the Supabase SQL Editor";
    } catch { /* the Supabase check above already says so */ }
  }
  const extra = [!s.verificationToken ? "EBAY_VERIFICATION_TOKEN missing (needed for production keys)" : "", !s.cronSecret ? "CRON_SECRET missing (the daily sync won't run)" : ""].filter(Boolean);
  return "ok (" + s.env + ")" + (extra.length ? "; " + extra.join("; ") : "");
}

module.exports.projectUrl = projectUrl;
