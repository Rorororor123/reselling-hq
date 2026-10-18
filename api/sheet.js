// Reselling HQ: fetches your published Google Sheet tab as CSV.
const { requireUser } = require("./_supabase");
module.exports = async (req, res) => {
  if (!(await requireUser(req, res))) return;
  let url;
  try { url = new URL(String(req.query.url || "")); } catch { return res.status(400).json({ error: { code: "bad_url" } }); }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || !url.pathname.startsWith("/spreadsheets/"))
    return res.status(400).json({ error: { code: "bad_url" } });
  try {
    const r = await fetch(url.toString(), { redirect: "follow" });
    const text = await r.text();
    if (!r.ok || /^\s*<!doctype html|<html/i.test(text.slice(0, 200)))
      return res.status(502).json({ error: { code: "not_published" } });
    res.status(200).json({ text: text.slice(0, 2000000) });
  } catch {
    res.status(502).json({ error: { code: "upstream_error" } });
  }
};
