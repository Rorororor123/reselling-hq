// Proves the security rules and "Move into stock" in supabase/migrations/002_tracker.sql.
// Runs the real files in a small built-in Postgres (PGlite), like rls.test.js.
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
const count = async (id, t) => (await as(id, `select count(*)::int n from public.${t}`)).rows[0].n;
const newOrder = async (id, fields) => {
  const keys = Object.keys(fields);
  const r = await as(id, `insert into public.orders (${keys.join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning id`, Object.values(fields));
  return r.rows[0].id;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  for (let k = 0; k < 2; k++) { await db.exec(read("001_accounts.sql")); await db.exec(read("002_tracker.sql")); } // safe to run twice
  await db.query("insert into auth.users (id, email) values ($1, 'a@example.com'), ($2, 'b@example.com')", [A, B]);
  for (const [who, name] of [[A, "A"], [B, "B"]]) {
    await newOrder(who, { item: name + " order", cost: 10 });
    await as(who, "insert into public.items (name, cost) values ($1, 5)", [name + " item"]);
    await as(who, "insert into public.expenses (description, amount) values ($1, 3)", [name + " expense"]);
  }
});

describe("tracker row level security", () => {
  for (const [t, col] of [["orders", "item"], ["items", "name"], ["expenses", "description"]]) {
    it(`each person sees and changes only their own ${t}`, async () => {
      expect((await as(A, `select ${col} v from public.${t}`)).rows).toEqual([{ v: "A " + t.slice(0, -1) }]);
      await as(A, `update public.${t} set ${col} = 'hacked' where user_id = $1`, [B]);
      await as(A, `delete from public.${t} where user_id = $1`, [B]);
      expect(await count(B, t)).toBe(1);
      expect((await as(B, `select ${col} v from public.${t}`)).rows[0].v).toMatch(/^B /);
      expect((await as(null, `select * from public.${t}`)).rows).toEqual([]);
    });
    it(`nobody can write ${t} in someone else's name`, async () => {
      const extra = t === "expenses" ? ", amount" : "";
      await expect(as(A, `insert into public.${t} (user_id, ${col}${extra}) values ($1, 'x'${extra ? ", 1" : ""})`, [B])).rejects.toThrow(/row-level security/);
      await expect(as(A, `update public.${t} set user_id = $1`, [B])).rejects.toThrow(/row-level security/);
    });
  }
  it("refuses nonsense values", async () => {
    await expect(as(A, "insert into public.orders (item, status) values ('x', 'Lost')")).rejects.toThrow(/check/);
    await expect(as(A, "insert into public.items (name, cost) values ('x', -1)")).rejects.toThrow(/check/);
    await expect(as(A, "insert into public.expenses (description, amount, repeat) values ('x', 1, 'daily')")).rejects.toThrow(/check/);
  });
  it("records when an order's status changed", async () => {
    const id = await newOrder(A, { item: "Status test", cost: 1 });
    const before = (await as(A, "select status_at from public.orders where id = $1", [id])).rows[0].status_at;
    await new Promise(r => setTimeout(r, 15));
    await as(A, "update public.orders set notes = 'x' where id = $1", [id]);
    expect((await as(A, "select status_at from public.orders where id = $1", [id])).rows[0].status_at).toEqual(before);
    await as(A, "update public.orders set status = 'Shipped' where id = $1", [id]);
    expect((await as(A, "select status_at from public.orders where id = $1", [id])).rows[0].status_at > before).toBe(true);
  });
});

describe("move into stock", () => {
  it("makes one item per unit, with the cost split to the penny, then marks the order", async () => {
    const id = await newOrder(A, { item: "Mini tin", qty: 3, cost: 10, status: "Delivered", category: "Pokémon", size: "Sealed", ordered: "2026-10-01" });
    const made = (await as(A, "select name, cost::text, status, bought::text, category, size from public.move_order_to_stock($1)", [id])).rows;
    expect(made).toHaveLength(3);
    expect(made.map(r => r.cost)).toEqual(["3.34", "3.33", "3.33"]);
    expect(made[0]).toMatchObject({ name: "Mini tin", status: "In stock", bought: "2026-10-01", category: "Pokémon", size: "Sealed" });
    expect((await as(A, "select stocked_at is not null s from public.orders where id = $1", [id])).rows[0].s).toBe(true);
    expect((await as(A, "select count(*)::int n from public.items where order_id = $1", [id])).rows[0].n).toBe(3);
  });
  it("won't do it twice, or before delivery", async () => {
    const id = await newOrder(A, { item: "Twice", cost: 5, status: "Delivered" });
    await as(A, "select * from public.move_order_to_stock($1)", [id]);
    await expect(as(A, "select * from public.move_order_to_stock($1)", [id])).rejects.toThrow(/already_stocked/);
    const early = await newOrder(A, { item: "Early", cost: 5, status: "Shipped" });
    await expect(as(A, "select * from public.move_order_to_stock($1)", [early])).rejects.toThrow(/not_delivered/);
  });
  it("can't touch someone else's order", async () => {
    const id = await newOrder(B, { item: "B's delivered", cost: 5, status: "Delivered" });
    await expect(as(A, "select * from public.move_order_to_stock($1)", [id])).rejects.toThrow(/order_not_found/);
    await expect(as(null, "select * from public.move_order_to_stock($1)", [id])).rejects.toThrow(/permission denied/);
    expect((await as(B, "select stocked_at from public.orders where id = $1", [id])).rows[0].stocked_at).toBeNull();
  });
});

describe("deleting an account", () => {
  it("removes all its orders, items and expenses and nobody else's", async () => {
    await db.query("delete from auth.users where id = $1", [A]);
    for (const t of ["orders", "items", "expenses"]) {
      expect((await db.query(`select count(*)::int n from public.${t} where user_id = $1`, [A])).rows[0].n).toBe(0);
      expect((await db.query(`select count(*)::int n from public.${t} where user_id = $1`, [B])).rows[0].n).toBeGreaterThan(0);
    }
  });
});
