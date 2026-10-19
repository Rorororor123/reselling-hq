// Reselling HQ: eBay's required "marketplace account deletion" address.
// eBay checks it with a challenge (GET) and then sends a notice (POST) whenever an eBay user closes their account.
// We check eBay really sent the notice (its signature), then forget that person's eBay connection and order numbers.
const crypto = require("crypto");
const E = require("./_ebay");

// eBay's public keys, kept for an hour so a burst of notices doesn't ask eBay every time.
const keys = new Map();

module.exports = async (req, res) => {
  const s = E.settings();
  res.setHeader("cache-control", "no-store");
  if (req.method === "GET") {
    const code = req.query && req.query.challenge_code;
    if (!code) return res.status(400).json({ error: { code: "no_challenge" } });
    if (!s.verificationToken) return res.status(500).json({ error: { code: "not_set_up", message: "EBAY_VERIFICATION_TOKEN is missing." } });
    const endpoint = process.env.EBAY_DELETION_URL || "https://" + req.headers.host + "/api/ebay-deletion";
    const challengeResponse = crypto.createHash("sha256").update(String(code)).update(s.verificationToken).update(endpoint).digest("hex");
    res.setHeader("content-type", "application/json");
    return res.status(200).json({ challengeResponse });
  }
  if (req.method !== "POST") return res.status(405).json({ error: { code: "method_not_allowed" } });

  const body = req.body && typeof req.body === "object" ? req.body : null;
  if (!body || !(await verified(s, req.headers["x-ebay-signature"], body))) return res.status(412).json({ error: { code: "bad_signature" } });
  const data = (body.notification && body.notification.data) || {};
  if (body.metadata && body.metadata.topic === "MARKETPLACE_ACCOUNT_DELETION" && (data.userId || data.username)) {
    try {
      const db = E.rest(), seen = new Set();
      for (const [col, v] of [["ebay_user_id", data.userId], ["ebay_username", data.username]]) {
        if (!v) continue;
        for (const c of (await db(`ebay_connections?${col}=eq.${encodeURIComponent(String(v))}&select=user_id`)) || []) seen.add(c.user_id);
      }
      for (const id of seen) await E.forget(db, id);
    } catch {
      return res.status(500).json({ error: { code: "failed" } }); // eBay tries again later
    }
  }
  res.status(204).end();
};

// The x-ebay-signature header is base64 JSON: {alg, kid, signature, digest}. The key comes from eBay's Notification API.
async function verified(s, header, body) {
  let sig;
  try { sig = JSON.parse(Buffer.from(String(header || ""), "base64").toString("utf8")); } catch { return false; }
  if (!sig || !sig.kid || !sig.signature || !s.clientId || !s.clientSecret) return false;
  try {
    let k = keys.get(sig.kid);
    if (!k || k.until < Date.now()) {
      const j = await E.ebayGet(s.api + "/commerce/notification/v1/public_key/" + encodeURIComponent(sig.kid), await E.appToken(s));
      k = { pem: pem(j.key), digest: String(j.digest || sig.digest || "SHA1").toLowerCase().replace("-", ""), until: Date.now() + 3600000 };
      keys.set(sig.kid, k);
    }
    return crypto.verify(k.digest, Buffer.from(JSON.stringify(body)), k.pem, Buffer.from(sig.signature, "base64"));
  } catch {
    return false;
  }
}
// eBay sends the key on one line; Node wants the usual 64-character lines.
function pem(key) {
  const b = String(key || "").replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return "-----BEGIN PUBLIC KEY-----\n" + b.match(/.{1,64}/g).join("\n") + "\n-----END PUBLIC KEY-----\n";
}

module.exports.pem = pem;
module.exports.keys = keys;
