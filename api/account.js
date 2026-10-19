// Reselling HQ: "Delete my account". Removes the sign-in and, through the database rules, every row that belonged to it.
const { config, fail, requireUser } = require("./_supabase");

module.exports = async (req, res) => {
  if (req.method !== "DELETE") return fail(res, 405, "method_not_allowed");
  const user = await requireUser(req, res, { checkAllowList: false });
  if (!user) return;
  const { url, secret } = config();
  try {
    const r = await fetch(url + "/auth/v1/admin/users/" + encodeURIComponent(user.id), { method: "DELETE", headers: { apikey: secret } });
    if (!r.ok && r.status !== 404) return fail(res, 502, "delete_failed");
    res.status(200).json({ deleted: true });
  } catch {
    fail(res, 502, "delete_failed");
  }
};
