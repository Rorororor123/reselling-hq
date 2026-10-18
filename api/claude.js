// Reselling HQ: sends prompts to the Claude API. Your API key stays on the server.
const MODELS = {
  default: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
  quick: process.env.CLAUDE_MODEL_FAST || "claude-haiku-5-5",
};
// Current web search version (with dynamic filtering) for Sonnet 5.5.
const WEB_SEARCH = { type: "web_search_20260209", name: "web_search", max_uses: 6 };

function fail(res, status, code, message) {
  res.status(status).json({ error: { code, message: message || code } });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return fail(res, 405, "method_not_allowed");
  const password = process.env.APP_PASSWORD;
  if (!password || req.headers["x-app-password"] !== password) return fail(res, 401, "bad_password");
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fail(res, 500, "no_key");

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const { prompt, images = [], tier = "default", webSearch = false, maxTokens = 3000 } = body;
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 200000) return fail(res, 400, "bad_prompt");
  if (!Array.isArray(images) || images.length > 6) return fail(res, 400, "bad_images");

  const content = [
    ...images.map((im) => ({
      type: "image",
      source: { type: "base64", media_type: im.type === "image/png" ? "image/png" : "image/jpeg", data: String(im.data || "") },
    })),
    { type: "text", text: prompt },
  ];
  const messages = [{ role: "user", content }];
  const request = {
    model: MODELS[tier] || MODELS.default,
    max_tokens: Math.min(Number(maxTokens) || 3000, 8000),
    messages,
  };
  if (webSearch) request.tools = [WEB_SEARCH];

  try {
    let last;
    for (let round = 0; round < 4; round++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const j = await r.json();
      if (!r.ok) {
        const msg = (j.error && j.error.message) || "Claude API error";
        // A 400 that names the tool means Claude refused this web search version, so say so plainly.
        const toolRejected = r.status === 400 && webSearch && /web_search|tools/i.test(msg);
        const code = toolRejected ? "search_tool_rejected" : r.status === 429 ? "rate_limited" : r.status === 401 ? "no_key" : "upstream_error";
        return fail(res, 502, code, msg);
      }
      last = j;
      if (j.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: j.content }); continue; }
      break;
    }
    // Keep only the text written after the last search result (the final answer).
    const blocks = last.content || [];
    let start = 0;
    blocks.forEach((b, i) => { if (/tool_result$/.test(b.type) || b.type === "server_tool_use") start = i + 1; });
    let text = blocks.slice(start).filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text.trim()) text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (!text.trim()) return fail(res, 502, "empty_completion");
    res.status(200).json({ text, truncated: last.stop_reason === "max_tokens" });
  } catch (e) {
    fail(res, 502, "upstream_error", String(e && e.message));
  }
};
module.exports.WEB_SEARCH = WEB_SEARCH;
