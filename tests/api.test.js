// Tests for the server functions in /api. Claude and Supabase are faked: no real calls, no cost.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import claude from "../api/claude.js";
import health from "../api/health.js";
import account from "../api/account.js";
import config from "../api/config.js";

function fakeRes() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = c => { res.statusCode = c; return res; };
  res.json = b => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}
const post = body => ({ method: "POST", headers: { authorization: "Bearer good-token" }, body });
const reply = (status, json) => ({ ok: status < 300, status, json: async () => json });

// A fake Supabase: "good-token" belongs to me@example.com, who is on the allow list.
// Anything that isn't a Supabase address goes to `other` (the fake Claude).
const SB = { SUPABASE_URL: "https://abcd.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x", SUPABASE_SECRET_KEY: "sb_secret_x" };
function fakeSupabase(other = vi.fn(), { allowed = ["me@example.com"], email = "Me@Example.com" } = {}) {
  const sb = vi.fn(async (url, opts = {}) => {
    const h = opts.headers || {};
    if (url === "https://abcd.supabase.co/auth/v1/user")
      return h.authorization === "Bearer good-token" && h.apikey === "sb_publishable_x" ? reply(200, { id: "user-1", email }) : reply(401, {});
    if (url.startsWith("https://abcd.supabase.co/rest/v1/allowed_emails")) {
      if (h.apikey !== "sb_secret_x") return reply(401, {});
      const want = decodeURIComponent(url.split("email=eq.")[1] || "");
      return reply(200, allowed.filter(e => e === want).map(e => ({ email: e })));
    }
    if (url.startsWith("https://abcd.supabase.co/auth/v1/admin/users/"))
      return h.apikey === "sb_secret_x" && opts.method === "DELETE" ? reply(200, {}) : reply(401, {});
    return other(url, opts);
  });
  return sb;
}
const signedIn = other => fakeSupabase(other);

describe("api/claude.js", () => {
  beforeEach(() => { Object.assign(process.env, SB, { ANTHROPIC_API_KEY: "test-key" }); });
  afterEach(() => { vi.unstubAllGlobals(); for (const k of [...Object.keys(SB), "ANTHROPIC_API_KEY"]) delete process.env[k]; });

  it("asks for the current web search tool on the weekly check", async () => {
    const fetch = vi.fn(async () => reply(200, { stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }));
    vi.stubGlobal("fetch", signedIn(fetch));
    await claude(post({ prompt: "hi", webSearch: true }), fakeRes());
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect(sent.tools).toEqual([{ type: "web_search_20260209", name: "web_search", max_uses: 6 }]);
  });

  it("sends no tools for listings and replies", async () => {
    const fetch = vi.fn(async () => reply(200, { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }));
    vi.stubGlobal("fetch", signedIn(fetch));
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
    vi.stubGlobal("fetch", signedIn(vi.fn(async () => reply(200, { stop_reason: "end_turn", content }))));
    const res = fakeRes();
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ text: '{"summary":"good week"}', truncated: false });
  });

  it("carries on when Claude pauses mid-search", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(reply(200, { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }] }))
      .mockResolvedValueOnce(reply(200, { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] }));
    vi.stubGlobal("fetch", signedIn(fetch));
    const res = fakeRes();
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).messages).toHaveLength(2);
    expect(res.body.text).toBe("done");
  });

  it("says clearly when Claude rejects the web search tool version", async () => {
    const msg = "tools.0: Input tag 'web_search_20260209' found using 'type' does not match any of the expected tags";
    vi.stubGlobal("fetch", signedIn(vi.fn(async () => reply(400, { type: "error", error: { type: "invalid_request_error", message: msg } }))));
    const res = fakeRes();
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.error).toEqual({ code: "search_tool_rejected", message: msg });
  });

  it("doesn't blame the search tool for other errors", async () => {
    vi.stubGlobal("fetch", signedIn(vi.fn(async () => reply(400, { error: { message: "prompt is too long" } }))));
    const res = fakeRes();
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(res.body.error.code).toBe("upstream_error");
    vi.stubGlobal("fetch", signedIn(vi.fn(async () => reply(429, { error: { message: "slow down" } }))));
    await claude(post({ prompt: "hi", webSearch: true }), res);
    expect(res.body.error.code).toBe("rate_limited");
  });

  it("refuses anyone not signed in, without calling Claude", async () => {
    const claudeFetch = vi.fn(); vi.stubGlobal("fetch", signedIn(claudeFetch));
    for (const headers of [{}, { authorization: "Bearer stolen-or-expired" }, { "x-app-password": "the old password" }]) {
      const res = fakeRes();
      await claude({ method: "POST", headers, body: { prompt: "hi" } }, res);
      expect(res.statusCode).toBe(401);
      expect(res.body.error.code).toBe("signed_out");
    }
    expect(claudeFetch).not.toHaveBeenCalled();
  });

  it("refuses a signed-in account that isn't on the allow list", async () => {
    const claudeFetch = vi.fn(); vi.stubGlobal("fetch", fakeSupabase(claudeFetch, { allowed: ["someone-else@example.com"] }));
    const res = fakeRes();
    await claude(post({ prompt: "hi" }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("not_allowed");
    expect(claudeFetch).not.toHaveBeenCalled();
  });

  it("refuses everything if the server's Supabase settings are missing", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const claudeFetch = vi.fn(); vi.stubGlobal("fetch", signedIn(claudeFetch));
    const res = fakeRes();
    await claude(post({ prompt: "hi" }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe("not_set_up");
    expect(claudeFetch).not.toHaveBeenCalled();
  });

  it("refuses when Supabase can't be reached, rather than letting the call through", async () => {
    const claudeFetch = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async url => { if (String(url).includes("supabase")) throw new Error("down"); return claudeFetch(url); }));
    const res = fakeRes();
    await claude(post({ prompt: "hi" }), res);
    expect(res.statusCode).toBe(502);
    expect(claudeFetch).not.toHaveBeenCalled();
  });
});

describe("api/account.js (delete my account)", () => {
  beforeEach(() => Object.assign(process.env, SB));
  afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(SB)) delete process.env[k]; });

  it("deletes only the signed-in person's account", async () => {
    const fetch = fakeSupabase(); vi.stubGlobal("fetch", fetch);
    const res = fakeRes();
    await account({ method: "DELETE", headers: { authorization: "Bearer good-token" } }, res);
    expect(res.statusCode).toBe(200);
    const deletes = fetch.mock.calls.filter(c => c[1] && c[1].method === "DELETE");
    expect(deletes.map(c => c[0])).toEqual(["https://abcd.supabase.co/auth/v1/admin/users/user-1"]);
  });

  it("still works for someone taken off the allow list", async () => {
    vi.stubGlobal("fetch", fakeSupabase(vi.fn(), { allowed: [] }));
    const res = fakeRes();
    await account({ method: "DELETE", headers: { authorization: "Bearer good-token" } }, res);
    expect(res.statusCode).toBe(200);
  });

  it("refuses when not signed in, and only answers DELETE", async () => {
    const fetch = fakeSupabase(); vi.stubGlobal("fetch", fetch);
    let res = fakeRes();
    await account({ method: "DELETE", headers: {} }, res);
    expect(res.statusCode).toBe(401);
    res = fakeRes();
    await account({ method: "GET", headers: { authorization: "Bearer good-token" } }, res);
    expect(res.statusCode).toBe(405);
    expect(fetch.mock.calls.some(c => c[1] && c[1].method === "DELETE")).toBe(false);
  });
});

describe("api/config.js", () => {
  afterEach(() => { for (const k of Object.keys(SB)) delete process.env[k]; });

  it("gives the app the project address and publishable key, never the secret key", () => {
    Object.assign(process.env, SB, { SUPABASE_URL: "https://abcd.supabase.co/rest/v1/" });
    const res = fakeRes();
    config({}, res);
    expect(res.body).toEqual({ supabaseUrl: "https://abcd.supabase.co", publishableKey: "sb_publishable_x" });
    expect(JSON.stringify(res.body)).not.toContain("sb_secret");
  });

  it("says not set up, rather than handing out a secret key put in the wrong setting", () => {
    Object.assign(process.env, { SUPABASE_URL: "https://abcd.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops" });
    const res = fakeRes();
    config({}, res);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("sb_secret");
  });
});

describe("api/health.js", () => {
  afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(SB)) delete process.env[k]; });

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

  it("lists which settings exist and which deployment answered, without values", async () => {
    Object.assign(process.env, { SUPABASE_URL: "https://abcd.supabase.co", VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "claude/nice-cerf-59n5u2", VERCEL_GIT_COMMIT_SHA: "b625f17abcdef", VERCEL_PROJECT_PRODUCTION_URL: "reselling-hq.vercel.app" });
    const res = fakeRes();
    await health({}, res);
    expect(res.body.settings).toEqual({ ANTHROPIC_API_KEY: "missing", APP_PASSWORD: "missing", SUPABASE_URL: "set", SUPABASE_PUBLISHABLE_KEY: "missing", SUPABASE_SECRET_KEY: "missing" });
    expect(res.body.deployment).toEqual({ environment: "preview", branch: "claude/nice-cerf-59n5u2", commit: "b625f17", project: "reselling-hq.vercel.app" });
    for (const k of ["VERCEL_ENV", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA", "VERCEL_PROJECT_PRODUCTION_URL"]) delete process.env[k];
  });

  it("explains a refused key", async () => {
    process.env.SUPABASE_URL = "https://abcd.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "wrong";
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, {})));
    const res = fakeRes();
    await health({}, res);
    expect(res.body.supabase).toMatch(/refused the key/);
  });

  it("tidies whatever was pasted into the bare project address", () => {
    const { projectUrl } = health;
    for (const v of ["https://abcd1234.supabase.co", "https://abcd1234.supabase.co/", "https://abcd1234.supabase.co/rest/v1/",
      "https://abcd1234.supabase.co/rest/v1", "  https://abcd1234.supabase.co/rest/v1/  ", "abcd1234.supabase.co", '"https://abcd1234.supabase.co"']) {
      expect(projectUrl(v), v).toBe("https://abcd1234.supabase.co");
    }
    expect(projectUrl("https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api")).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(projectUrl("")).toBeNull();
    expect(projectUrl("not a url at all")).toBeNull();
  });

  it("calls the right address even when SUPABASE_URL ends in /rest/v1/", async () => {
    process.env.SUPABASE_URL = "https://abcd1234.supabase.co/rest/v1/";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    const fetch = vi.fn(async () => reply(200, {})); vi.stubGlobal("fetch", fetch);
    const res = fakeRes();
    await health({}, res);
    expect(fetch.mock.calls[0][0]).toBe("https://abcd1234.supabase.co/auth/v1/health");
    expect(res.body.supabase).toBe("ok");
    expect(res.body.checked).toBe("https://abcd1234.supabase.co/auth/v1/health");
    expect(res.body.supabaseUrlNote).toMatch(/tidy it to https:\/\/abcd1234.supabase.co/);
  });

  it("tries the Auth settings address if the health address isn't found", async () => {
    process.env.SUPABASE_URL = "https://abcd1234.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    const fetch = vi.fn().mockResolvedValueOnce(reply(404, {})).mockResolvedValueOnce(reply(200, {}));
    vi.stubGlobal("fetch", fetch);
    const res = fakeRes();
    await health({}, res);
    expect(fetch.mock.calls.map(c => c[0])).toEqual(["https://abcd1234.supabase.co/auth/v1/health", "https://abcd1234.supabase.co/auth/v1/settings"]);
    expect(res.body.supabase).toBe("ok");
    expect(res.body.supabaseUrlNote).toBeUndefined();
  });

  it("explains a 404 by naming the address, not blaming a pause", async () => {
    process.env.SUPABASE_URL = "https://abcd1234.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_x";
    vi.stubGlobal("fetch", vi.fn(async () => reply(404, {})));
    const res = fakeRes();
    await health({}, res);
    expect(res.body.supabase).toMatch(/couldn't find https:\/\/abcd1234.supabase.co\/auth\/v1\/settings \(404\)/);
    expect(res.body.supabase).not.toMatch(/paused/);
  });

  it("warns if the secret key was pasted into the publishable setting, without calling Supabase", async () => {
    process.env.SUPABASE_URL = "https://abcd1234.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_secret_oops";
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const res = fakeRes();
    await health({}, res);
    expect(fetch).not.toHaveBeenCalled();
    expect(res.body.supabase).toMatch(/secret key/);
    expect(JSON.stringify(res.body)).not.toContain("sb_secret_oops");
  });
});

describe("health: sign-in setup", () => {
  afterEach(() => { vi.unstubAllGlobals(); for (const k of Object.keys(SB)) delete process.env[k]; });
  const run = async (fetchFor) => {
    vi.stubGlobal("fetch", vi.fn(async url => url.includes("/rest/v1/") ? fetchFor() : reply(200, {})));
    const res = fakeRes(); await health({}, res); return res.body;
  };

  it("says ok and counts the allow list without showing any email", async () => {
    Object.assign(process.env, SB);
    const body = await run(() => reply(200, [{ email: "me@example.com" }]));
    expect(body.accounts).toBe("ok (1 email on the allow list)");
    expect(JSON.stringify(body)).not.toContain("me@example.com");
    expect(JSON.stringify(body)).not.toContain("sb_secret_x");
  });

  it("explains each way it can go wrong", async () => {
    Object.assign(process.env, SB);
    expect((await run(() => reply(404, {}))).accounts).toMatch(/tables missing: run supabase\/migrations\/001_accounts.sql/);
    expect((await run(() => reply(401, {}))).accounts).toMatch(/refused SUPABASE_SECRET_KEY/);
    expect((await run(() => reply(200, []))).accounts).toMatch(/allow list is empty/);
    process.env.SUPABASE_SECRET_KEY = "sb_publishable_wrongone";
    expect((await run(() => reply(200, []))).accounts).toMatch(/should start with sb_secret_/);
    delete process.env.SUPABASE_SECRET_KEY;
    expect((await run(() => reply(200, []))).accounts).toMatch(/add SUPABASE_SECRET_KEY/);
  });
});

describe("vendored Supabase library", () => {
  it("is the exact file from the pinned npm package", async () => {
    const fs = await import("node:fs");
    const ours = fs.readFileSync(new URL("../js/vendor/supabase-2.117.2.js", import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(new URL("../node_modules/@supabase/supabase-js/package.json", import.meta.url), "utf8"));
    expect(pkg.version).toBe("2.117.2");
    expect(ours.equals(fs.readFileSync(new URL("../node_modules/@supabase/supabase-js/dist/umd/supabase.js", import.meta.url)))).toBe(true);
  });
});

describe("sw.js", () => {
  it("only lists files that exist, including the split-out ones", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
    const shell = JSON.parse(src.match(/const SHELL = (\[.*?\]);/)[1]);
    expect(shell).toEqual(expect.arrayContaining(["/css/styles.css", "/js/core.js", "/js/app.js"]));
    for (const p of shell) if (p !== "/") expect(fs.existsSync(new URL(".." + p, import.meta.url)), p).toBe(true);
    expect(shell).toEqual(expect.arrayContaining(["/js/account.js", "/js/tracker.js", "/js/stock.js", "/js/xlsx.js", "/js/vendor/supabase-2.117.2.js"]));
    expect(src).toContain('const CACHE = "rhq-v5"');
  });
});
