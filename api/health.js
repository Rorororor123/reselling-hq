// Reselling HQ: open /api/health to check the server's settings. Shows which settings exist, never their values.
const NAMES = ["ANTHROPIC_API_KEY", "APP_PASSWORD", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"];

module.exports = async (req, res) => {
  const env = process.env;
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
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
  if (!url || !key) {
    out.supabase = "not set up: add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy";
  } else {
    try {
      const r = await fetch(url.replace(/\/+$/, "") + "/auth/v1/health", { headers: { apikey: key } });
      if (!r.ok) out.supabase = r.status === 401 || r.status === 403
        ? "Supabase refused the key: check SUPABASE_PUBLISHABLE_KEY"
        : "Supabase answered with an error (" + r.status + "): it may be paused, check the Supabase dashboard";
    } catch {
      out.supabase = "couldn't reach Supabase: check SUPABASE_URL";
    }
  }
  res.setHeader("cache-control", "no-store");
  res.status(out.supabase === "ok" ? 200 : 503).json(out);
};
