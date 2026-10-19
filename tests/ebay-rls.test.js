// Proves the database rules in supabase/migrations/003_ebay.sql, in a small built-in Postgres (PGlite),
// like tracker-rls.test.js: eBay sign-ins are server-only, and the same eBay sale can't be stored twice.
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";

const read = f => fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", f), "utf8");
const A = "00000000-0000-0000-0000-00000000000a";
const B = "00000000-0000-0000-0000-00000000000b";

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
async function as(id, sql, params) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id || ""]);
    await tx.exec(`set local role ${id ? "authenticated" : "anon"}`);
    return tx.query(sql, params);
  });
}
// The server uses the secret key, which acts as service_role (skips the rules, so it always names the user).
async function server(sql, params) {
  return db.transaction(async (tx) => { await tx.exec("set local role service_role"); return tx.query(sql, params); });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (let k = 0; k < 2; k++) for (const f of ["001_accounts.sql", "002_tracker.sql", "003_ebay.sql"]) await db.exec(read(f)); // safe to run twice
  await db.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  await server("insert into public.ebay_connections (user_id, env, ebay_username, refresh_token) values ($1, 'sandbox', 'a_seller', 'v1.secret')", [A]);
  await server("insert into public.ebay_app_keys (env, signing_key_id, jwe, private_key) values ('sandbox', 'k', 'jwe', 'v1.private')");
});

describe("eBay connections and signing keys", () => {
  for (const t of ["ebay_connections", "ebay_app_keys"]) {
    it(`${t}: signed-in people (even the owner) and visitors can't read or write it`, async () => {
      await expect(as(A, `select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await expect(as(null, `select * from public.${t}`)).rejects.toThrow(/permission denied/);
      await expect(as(A, `delete from public.${t}`)).rejects.toThrow(/permission denied/);
      expect((await server(`select count(*)::int n from public.${t}`)).rows[0].n).toBe(1);
    });
  }
  it("nobody can make a connection in someone else's name", async () => {
    await expect(as(A, "insert into public.ebay_connections (user_id, env, refresh_token) values ($1, 'sandbox', 'x')", [B])).rejects.toThrow(/permission denied/);
  });
  it("only sandbox or production", async () => {
    await expect(server("insert into public.ebay_connections (user_id, env, refresh_token) values ($1, 'live', 'x')", [B])).rejects.toThrow(/check/);
  });
});

describe("synced sales", () => {
  it("the same eBay sale can't be stored twice for the same person (but two people are separate)", async () => {
    await as(A, "insert into public.items (name, status, source, source_ref) values ('Sold on eBay', 'Sold', 'ebay', 'ebay:O1:L1:1')");
    await expect(as(A, "insert into public.items (name, status, source, source_ref) values ('Again', 'Sold', 'ebay', 'ebay:O1:L1:1')")).rejects.toThrow(/duplicate key|unique/);
    await as(B, "insert into public.items (name, status, source, source_ref) values ('B sale', 'Sold', 'ebay', 'ebay:O1:L1:1')");
    // Items without an eBay sale (source_ref empty) are unaffected.
    await as(A, "insert into public.items (name) values ('Stock 1'), ('Stock 2')");
  });
  it("each person still sees only their own items", async () => {
    const names = (await as(A, "select name from public.items order by name")).rows.map(r => r.name);
    expect(names).toEqual(["Sold on eBay", "Stock 1", "Stock 2"]);
    await as(A, "update public.items set needs_review = 'new' where source_ref = 'ebay:O1:L1:1'");
    expect((await as(B, "select needs_review from public.items")).rows).toEqual([{ needs_review: null }]);
  });
  it("refuses nonsense values", async () => {
    await expect(as(A, "insert into public.items (name, needs_review) values ('x', 'maybe')")).rejects.toThrow(/check/);
    await expect(as(A, "insert into public.items (name, prev_status) values ('x', 'Lost')")).rejects.toThrow(/check/);
  });
  it("deleting an account removes its eBay connection and items, and nobody else's", async () => {
    await server("insert into public.ebay_connections (user_id, env, refresh_token) values ($1, 'sandbox', 'v1.b')", [B]);
    await db.query("delete from auth.users where id = $1", [A]);
    expect((await server("select user_id from public.ebay_connections")).rows).toEqual([{ user_id: B }]);
    expect((await db.query("select count(*)::int n from public.items where user_id = $1", [A])).rows[0].n).toBe(0);
    expect((await db.query("select count(*)::int n from public.items where user_id = $1", [B])).rows[0].n).toBe(1);
  });
});
