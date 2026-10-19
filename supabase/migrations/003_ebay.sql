-- Reselling HQ, Stage 5: eBay sync.
-- Paste all of this into Supabase: SQL Editor, New query, Run. Safe to run again.
-- Needs 001_accounts.sql and 002_tracker.sql to have been run first.
--
-- Your eBay sign-in (tokens) is stored encrypted, in a table only the server can read:
-- the app on your phone can't see it, and nor can anyone else's account.
-- We store no buyer names, usernames or addresses.

-- One eBay connection per person. Server only (no rules for signed-in people, so they see nothing).
create table if not exists public.ebay_connections (
  user_id uuid primary key references auth.users (id) on delete cascade,
  env text not null check (env in ('sandbox', 'production')),
  ebay_user_id text not null default '' check (length(ebay_user_id) <= 200),
  ebay_username text not null default '' check (length(ebay_username) <= 200),
  refresh_token text not null,          -- encrypted (AES-256-GCM) before it gets here
  refresh_expires_at timestamptz,
  access_token text,                    -- encrypted too
  access_expires_at timestamptz,
  needs_reconnect boolean not null default false,
  synced_to timestamptz,                -- eBay orders changed before this time are already in
  last_sync_at timestamptz,
  last_sync jsonb not null default '{}'::jsonb,
  sync_started_at timestamptz,          -- stops two syncs running at once
  created_at timestamptz not null default now()
);
create index if not exists ebay_connections_ebay_user on public.ebay_connections (ebay_user_id);
alter table public.ebay_connections enable row level security;
revoke all on public.ebay_connections from anon, authenticated;

-- The app's own signing key for eBay's Finances API (eBay asks for signed requests for UK sellers).
-- Made by the server the first time it's needed; the private part is stored encrypted. Server only.
create table if not exists public.ebay_app_keys (
  env text primary key check (env in ('sandbox', 'production')),
  signing_key_id text not null,
  jwe text not null,
  private_key text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.ebay_app_keys enable row level security;
revoke all on public.ebay_app_keys from anon, authenticated;

-- Where a sale came from, so syncing again never adds it twice.
-- source_ref is "ebay:<order>:<line>:<unit>"; the unique rule below is the database's own guarantee.
-- source_title is the eBay listing title (kept when a sale is matched to stock with a different name).
-- prev_status remembers what a stock item was before an eBay sale was matched to it (to undo a cancelled sale).
-- needs_review: 'new' (didn't match your stock), 'match' (matched by name, please confirm), 'cancelled'.
alter table public.items add column if not exists source text not null default '';
alter table public.items add column if not exists source_ref text;
alter table public.items add column if not exists source_title text;
alter table public.items add column if not exists prev_status text;
alter table public.items add column if not exists needs_review text;
do $$ begin
  alter table public.items add constraint items_source_len check (length(source) <= 20);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.items add constraint items_source_ref_len check (length(source_ref) <= 200);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.items add constraint items_source_title_len check (length(source_title) <= 300);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.items add constraint items_prev_status check (prev_status in ('In stock', 'Listed', 'Sold'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.items add constraint items_needs_review check (needs_review in ('new', 'match', 'cancelled'));
exception when duplicate_object then null; end $$;
create unique index if not exists items_source_ref on public.items (user_id, source_ref);
