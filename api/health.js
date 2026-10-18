// Reselling HQ: open /api/health to check the server's settings. Never shows any keys.
module.exports = async (req, res) => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const out = { claude: process.env.ANTHROPIC_API_KEY ? "key set" : "no key", supabase: "ok" };
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
