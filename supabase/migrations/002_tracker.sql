-- Reselling HQ, Stage 4: the built-in tracker (orders, stock and sales, expenses).
-- Paste all of this into Supabase: SQL Editor, New query, Run. Safe to run again.
-- Needs 001_accounts.sql to have been run first.
--
-- Same rules as Stage 3: row level security means the database only lets a signed-in
-- person see and change their own rows, and deleting a user deletes all their rows.

-- Things you've bought, from checkout to your door.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item text not null check (length(item) between 1 and 300),
  shop text not null default '' check (length(shop) <= 120),
  order_ref text not null default '' check (length(order_ref) <= 120),
  ordered date not null default current_date,
  qty integer not null default 1 check (qty between 1 and 500),
  cost numeric(10,2) not null default 0 check (cost >= 0),
  courier text not null default '' check (length(courier) <= 80),
  tracking text not null default '' check (length(tracking) <= 120),
  status text not null default 'Ordered' check (status in ('Ordered', 'Shipped', 'Out for delivery', 'Delivered', 'Cancelled')),
  status_at timestamptz not null default now(),
  preorder boolean not null default false,
  release date,
  category text not null default '' check (length(category) <= 80),
  size text not null default '' check (length(size) <= 120),
  notes text not null default '' check (length(notes) <= 2000),
  stocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_user on public.orders (user_id, ordered desc);

-- Your stock. A sale is an item with its sale details filled in, like the old tracker.
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 300),
  category text not null default '' check (length(category) <= 80),
  size text not null default '' check (length(size) <= 120),
  cost numeric(10,2) check (cost >= 0),
  status text not null default 'In stock' check (status in ('In stock', 'Listed', 'Sold')),
  bought date,
  listed date,
  ask_price numeric(10,2) check (ask_price >= 0),
  platform text not null default '' check (length(platform) <= 40),
  sold date,
  sale_price numeric(10,2) check (sale_price >= 0),
  fees numeric(10,2) not null default 0 check (fees >= 0),
  postage numeric(10,2) not null default 0 check (postage >= 0),
  posted boolean not null default false,
  notes text not null default '' check (length(notes) <= 2000),
  order_id uuid references public.orders (id) on delete set null,
  import_id text check (length(import_id) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists items_user on public.items (user_id, created_at desc);

-- Business costs. Monthly and yearly ones count again each month or year until their end date.
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null default current_date,
  description text not null check (length(description) between 1 and 300),
  category text not null default 'Other' check (length(category) <= 80),
  amount numeric(10,2) not null check (amount >= 0),
  repeat text not null default 'once' check (repeat in ('once', 'monthly', 'yearly')),
  end_date date,
  deductible boolean not null default true,
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_user on public.expenses (user_id, date desc);

alter table public.orders enable row level security;
alter table public.items enable row level security;
alter table public.expenses enable row level security;

drop policy if exists "own orders" on public.orders;
create policy "own orders" on public.orders for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own items" on public.items;
create policy "own items" on public.items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Keep updated_at (and the order's status time) current on every change.
create or replace function public.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
create or replace function public.touch_order() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status then new.status_at := now(); end if;
  return new;
end $$;
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.touch_order();
drop trigger if exists items_touch on public.items;
create trigger items_touch before update on public.items for each row execute function public.touch_row();
drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_row();
revoke execute on function public.touch_row() from public, anon, authenticated;
revoke execute on function public.touch_order() from public, anon, authenticated;

-- "Move into stock": turns a delivered order into one stock item per unit, all in one go.
-- Runs as the signed-in person (security invoker), so the rules above still apply.
create or replace function public.move_order_to_stock(p_order uuid) returns setof public.items
language plpgsql security invoker set search_path = '' as $$
declare
  o public.orders;
  each_cost numeric(10,2);
  i integer;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status <> 'Delivered' then raise exception 'order_not_delivered'; end if;
  if o.stocked_at is not null then raise exception 'order_already_stocked'; end if;
  each_cost := round(o.cost / o.qty, 2);
  for i in 1..o.qty loop
    -- The first item takes any leftover pennies so the total matches the order.
    return query insert into public.items (user_id, name, category, size, cost, status, bought, order_id)
      values (o.user_id, o.item, o.category, o.size,
              case when i = 1 then o.cost - each_cost * (o.qty - 1) else each_cost end,
              'In stock', o.ordered, o.id)
      returning *;
  end loop;
  update public.orders set stocked_at = now() where id = o.id;
end $$;
revoke execute on function public.move_order_to_stock(uuid) from public, anon;
grant execute on function public.move_order_to_stock(uuid) to authenticated;
