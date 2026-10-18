// Proves the database security rules in supabase/migrations/001_accounts.sql.
// Runs the real file in a small built-in Postgres (PGlite) with a stand-in for Supabase's auth schema.
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";

const SQL = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "001_accounts.sql"), "utf8");
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

// The bits of Supabase the migration relies on: its roles, auth.users and auth.uid().
const SUPABASE_STANDIN = `
  create role anon nologin; create role authenticated nologin;
  create role service_role nologin bypassrls; create role supabase_auth_admin nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role, supabase_auth_admin;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

let db;
// Run some SQL as a signed-in user (or signed out when id is null), like Supabase's API does.
async function as(id, sql, params) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id || ""]);
    await tx.exec(`set local role ${id ? "authenticated" : "anon"}`);
    return tx.query(sql, params);
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  await db.exec(SQL);
  await db.exec(SQL); // running it twice must be safe
  await db.query("insert into public.allowed_emails (email) values ('a@example.com'), ('b@example.com')");
  await db.query("insert into auth.users (id, email) values ($1, 'A@example.com'), ($2, 'b@example.com')", [A, B]);
  await as(A, "insert into public.settings (user_id, data) values ($1, '{\"budget\": 111}')", [A]);
  await as(B, "insert into public.settings (user_id, data) values ($1, '{\"budget\": 222}')", [B]);
  await as(A, "insert into public.reports (id, ts, data) values ('r1', 1, '{\"who\": \"A\"}')");
  await as(B, "insert into public.reports (id, ts, data) values ('r1', 1, '{\"who\": \"B\"}')");
});

describe("row level security", () => {
  it("each person sees only their own settings and reports", async () => {
    expect((await as(A, "select data->>'budget' b from public.settings")).rows).toEqual([{ b: "111" }]);
    expect((await as(B, "select data->>'budget' b from public.settings")).rows).toEqual([{ b: "222" }]);
    expect((await as(A, "select data->>'who' w from public.reports")).rows).toEqual([{ w: "A" }]);
    expect((await as(B, "select data->>'who' w from public.reports")).rows).toEqual([{ w: "B" }]);
  });

  it("signed-out visitors see nothing", async () => {
    for (const t of ["settings", "reports", "profiles"])
      expect((await as(null, `select * from public.${t}`)).rows).toEqual([]);
    await as(null, "update public.settings set data = '{}'");
    expect((await as(A, "select data->>'budget' b from public.settings")).rows).toEqual([{ b: "111" }]);
  });

  it("nobody can change or delete someone else's rows", async () => {
    await as(A, "update public.settings set data = '{\"budget\": 0}' where user_id = $1", [B]);
    await as(A, "delete from public.reports where user_id = $1", [B]);
    expect((await as(B, "select data->>'budget' b from public.settings")).rows).toEqual([{ b: "222" }]);
    expect((await as(B, "select count(*)::int n from public.reports")).rows).toEqual([{ n: 1 }]);
  });

  it("nobody can write rows in someone else's name", async () => {
    await expect(as(A, "insert into public.reports (id, user_id, ts, data) values ('x', $1, 2, '{}')", [B])).rejects.toThrow(/row-level security/);
  });

  it("the app can't read or change the allow list", async () => {
    await expect(as(A, "select * from public.allowed_emails")).rejects.toThrow(/permission denied/);
    await expect(as(A, "insert into public.allowed_emails values ('c@example.com')")).rejects.toThrow(/permission denied/);
  });

  it("a profile is made for each new user, visible only to them", async () => {
    expect((await as(A, "select email from public.profiles")).rows).toEqual([{ email: "a@example.com" }]);
  });

  it("keeps only the newest 52 reports", async () => {
    for (let i = 2; i <= 60; i++) await as(A, "insert into public.reports (id, ts, data) values ($1, $2, '{}')", ["r" + i, i]);
    const r = await as(A, "select count(*)::int n, min(ts)::int oldest from public.reports");
    expect(r.rows).toEqual([{ n: 52, oldest: 9 }]);
    expect((await as(B, "select count(*)::int n from public.reports")).rows).toEqual([{ n: 1 }]);
  });
});

describe("sign-up check", () => {
  const hook = async (email) => (await db.query("select public.hook_before_user_created($1) r", [{ user: { email } }])).rows[0].r;
  it("lets allowed emails in, whatever the capitals or spaces", async () => {
    expect(await hook(" A@Example.com ")).toEqual({});
  });
  it("refuses everyone else", async () => {
    expect(await hook("stranger@example.com")).toEqual({ error: { http_code: 403, message: "Reselling HQ is private for now." } });
    expect((await hook(undefined)).error.http_code).toBe(403);
  });
  it("can't be called by the app", async () => {
    await expect(as(A, "select public.hook_before_user_created('{}')")).rejects.toThrow(/permission denied/);
  });
});

describe("deleting an account", () => {
  it("removes every row that belonged to it and nobody else's", async () => {
    await db.query("delete from auth.users where id = $1", [A]);
    for (const [t, col] of [["settings", "user_id"], ["reports", "user_id"], ["profiles", "id"]]) {
      expect((await db.query(`select count(*)::int n from public.${t} where ${col} = $1`, [A])).rows).toEqual([{ n: 0 }]);
      expect((await db.query(`select count(*)::int n from public.${t} where ${col} = $1`, [B])).rows).toEqual([{ n: 1 }]);
    }
  });
});
