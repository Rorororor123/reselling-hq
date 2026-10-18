// Reselling HQ: open /api/health to check the server's settings. Shows which settings exist, never their values.
const NAMES = ["ANTHROPIC_API_KEY", "APP_PASSWORD", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];
// Public Supabase Auth addresses that answer with just the publishable key (sent as the apikey header).
const CHECKS = ["/auth/v1/health", "/auth/v1/settings"];

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
  }
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

module.exports.projectUrl = projectUrl;
