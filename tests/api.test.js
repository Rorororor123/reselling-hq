// Tests for the server functions in /api. Claude and Supabase are faked: no real calls, no cost.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import claude from "../api/claude.js";
import health from "../api/health.js";

function fakeRes() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const post = body => ({ method: "POST", headers: { "x-app-password": "pw" }, body });
const reply = (status, json) => ({ ok: status < 300, status, json: async () => json });

describe("api/claude.js", () => {
  beforeEach(() => { process.env.APP_PASSWORD = "pw"; process.env.ANTHROPIC_API_KEY = "test-key"; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.APP_PASSWORD; delete process.env.ANTHROPIC_API_KEY; });

  it("asks for the current web search tool on the weekly check", async () => {
    const fetch = vi.fn(async () => reply(200, { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }));
    vi.stubGlobal("fetch", fetch);
    await claude(post({ prompt: "hi", webSearch: true }), fakeRes());
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect(sent.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 6 }]);
  });

  it("sends no tools for listings and replies", async () => {
    const fetch = vi.fn(async () => reply(200, { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }));
    vi.stubGlobal("fetch", fetch);
    await claude(post({ prompt: "hi", tier: "quick" }), fakeRes());
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(sent.tools).toBeUndefined();
  });

  it("keeps only the final answer after searches (including the new filtering blocks)", async () => {
    const content = [
      { type: "text", text: "Let me search." },
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "pokemon tcg release" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
      { type: "server_tool_use", id: "c1", name: "code_execution", input: {} },
      { type: "bash_code_execution_tool_result", tool_use_id: "c1", content: { stdout: "" } },
      { type: "text", text: '{"summary":"good week"}' },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { stop_reason: "end_turn", content })));
    const res = fakeRes();
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ text: '{"summary":"good week"}', truncated: false });
  });

  it("carries on when Claude pauses mid-search", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(200, { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }] }))
      .mockResolvedValueOnce(reply(200, { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }));
    vi.stubGlobal("fetch", fetch);
    const res = fakeRes();
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).messages).toHaveLength(2);
    expect(res.body.text).toBe("done");
  });

  it("says clearly when Claude rejects the web search tool version", async () => {
    const msg = "tools.0: Input tag 'web_search_20260209' found using 'type' does not match any of the expected tags";
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { type: "error", error: { type: "invalid_request_error", message: msg } })));
    const res = fakeRes();
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toEqual({ code: "search_tool_rejected", message: msg });
  });

  it("doesn't blame the search tool for other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: { message: "prompt is too long" } })));
    const res = fakeRes();
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(res.body.error.code).toBe("upstream_error");
    vi.stubGlobal("fetch", vi.fn(async () => reply(429, { error: { message: "slow down" } })));
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(res.body.error.code).toBe("rate_limited");
  });

  it("refuses a wrong password without calling Claude", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const res = fakeRes();
    await claude({ method: "POST", headers: { "x-app-password": "nope" }, body: { prompt: "hi" } }, res);
    expect(res.statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("api/health.js", () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.SUPABASE_URL; delete process.env.SUPABASE_PUBLISHABLE_KEY; });

  it("says what's missing when Supabase isn't set up", async () => {
    const res = fakeRes();
    await health({}, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.supabase).toMatch(/not set up/);
  });

  it("reports ok when Supabase answers, and never shows the key", async () => {
    process.env.SUPABASE_URL = "https://abcd.supabase.co/";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_secretish";
    const fetch = vi.fn(async () => reply(200, {})); vi.stubGlobal("fetch", fetch);
    const res = fakeRes();
    await health({}, res);
    expect(fetch.mock.calls[0][0]).toBe("https://abcd.supabase.co/auth/v1/health");
    expect(fetch.mock.calls[0][1].headers.apikey).toBe("sb_publishable_secretish");
    expect(res.statusCode).toBe(200);
    expect(res.body.supabase).toBe("ok");
    expect(JSON.stringify(res.body)).not.toContain("sb_publishable");
  });

  it("explains a refused key", async () => {
    process.env.SUPABASE_URL = "https://abcd.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "wrong";
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, {})));
    const res = fakeRes();
    await health({}, res);
    expect(res.body.supabase).toMatch(/refused the key/);
  });
});

describe("sw.js", () => {
  it("only lists files that exist, including the split-out ones", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
    const shell = JSON.parse(src.match(/const SHELL = (\[.*?\]);/)[1]);
    expect(shell).toEqual(expect.arrayContaining(["/css/styles.css", "/js/core.js", "/js/app.js"]));
    for (const p of shell) if (p !== "/") expect(fs.existsSync(new URL(".." + p, import.meta.url)), p).toBe(true);
    expect(src).toContain('const CACHE = "rhq-v2"');
  });
});
