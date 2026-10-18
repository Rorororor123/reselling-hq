// Reselling HQ: tells the app where your Supabase project is. Both values are safe to be public:
// the publishable key only lets people sign in, and the database rules decide what they can see.
const { config } = require("./_supabase");

module.exports = (req, res) => {
  const { url, publishable } = config();
  res.setHeader("cache-control", "no-store");
  if (!url || !publishable || publishable.startsWith("sb_secret_")) return res.status(503).json({ error: { code: "not_set_up" } });
  res.status(200).json({ supabaseUrl: url, publishableKey: publishable });
};
