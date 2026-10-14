-- Ledgerline core schema for Supabase.
--
-- Privacy model, enforced by the database rather than the app:
--   * Every policy requires a two-factor session (aal2). A stolen password alone reads nothing.
--   * A household has at most two members, "me" (who created it) and "partner" (who joined
--     with an invite code).
--   * documents: one "shared" workspace document both partners read and write, plus one
--     private document per person that only that person can read or write.
--   * private_summaries: totals a person chooses to share from their private items. Only the
--     owner writes it; the partner can read it. Nothing else about private items is visible.
--   * provider_*: data synced from Up and SnapTrade by the server. A person sees accounts
--     their own connection reports, plus accounts their partner marked as shared.
--   * connections: encrypted provider tokens. Clients can read status columns only; token
--     columns are never granted to them.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------ tables
create table public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  person text not null check (person in ('me', 'partner')),
  display_name text not null check (char_length(display_name) between 1 and 60),
  ai_enabled boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (household_id, person),
  unique (user_id)
);

create table public.invites (
  household_id uuid primary key references public.households (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users (id) on delete cascade
);

create table public.documents (
  household_id uuid not null references public.households (id) on delete cascade,
  scope text not null check (scope in ('shared', 'me', 'partner')),
  data jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (household_id, scope),
  check (octet_length(data::text) < 5000000)
);

create table public.private_summaries (
  household_id uuid not null references public.households (id) on delete cascade,
  person text not null check (person in ('me', 'partner')),
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, person),
  check (octet_length(data::text) < 100000)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  person text not null check (person in ('me', 'partner')),
  provider text not null check (provider in ('up', 'snaptrade')),
  -- AES-256-GCM ciphertext made by the server; the key never reaches the database.
  secret_ciphertext text not null,
  webhook_id text,
  webhook_secret_ciphertext text,
  new_account_visibility text not null default 'private' check (new_account_visibility in ('shared', 'private')),
  status text not null default 'active' check (status in ('pending', 'active', 'error', 'revoked')),
  status_message text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, person, provider)
);

create table public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  provider text not null check (provider in ('up', 'snaptrade')),
  external_id text not null,
  -- People whose connection reports this account. Both, for an Up 2Up account.
  owners text[] not null check (owners <@ array['me', 'partner'] and cardinality(owners) between 1 and 2),
  joint boolean not null default false,
  visibility text not null default 'private' check (visibility in ('shared', 'private')),
  name text not null,
  account_type text not null,
  institution text not null,
  currency text not null default 'AUD',
  -- Signed as reported: positive = money held, negative = money owed.
  balance_cents bigint not null,
  available_cents bigint,
  as_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (household_id, provider, external_id),
  -- Joint accounts are always shared.
  check (not joint or visibility = 'shared')
);

create table public.provider_balances (
  account_id uuid not null references public.provider_accounts (id) on delete cascade,
  date date not null,
  balance_cents bigint not null,
  primary key (account_id, date)
);

create table public.provider_transactions (
  account_id uuid not null references public.provider_accounts (id) on delete cascade,
  external_id text not null,
  date date not null,
  description text not null,
  amount_cents bigint not null,
  pending boolean not null default false,
  merchant text,
  -- For transfers between Up accounts: the other account's provider id.
  transfer_external_id text,
  updated_at timestamptz not null default now(),
  primary key (account_id, external_id)
);
create index provider_transactions_date on public.provider_transactions (account_id, date desc);

create table public.provider_positions (
  account_id uuid not null references public.provider_accounts (id) on delete cascade,
  symbol text not null,
  description text,
  units numeric not null,
  price_cents bigint,
  value_cents bigint,
  currency text not null default 'AUD',
  updated_at timestamptz not null default now(),
  primary key (account_id, symbol)
);

create table public.ai_usage (
  household_id uuid not null references public.households (id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  -- US dollars in millionths, so the cap check never rounds.
  cost_micros bigint not null default 0,
  questions integer not null default 0,
  primary key (household_id, month)
);

-- ------------------------------------------------------------------ helpers
create function public.mfa_ok() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create function public.my_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select household_id from public.members where user_id = auth.uid()
$$;

create function public.my_person() returns text
language sql stable security definer set search_path = '' as $$
  select person from public.members where user_id = auth.uid()
$$;

-- ------------------------------------------------------------------ row level security
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.documents enable row level security;
alter table public.private_summaries enable row level security;
alter table public.connections enable row level security;
alter table public.provider_accounts enable row level security;
alter table public.provider_balances enable row level security;
alter table public.provider_transactions enable row level security;
alter table public.provider_positions enable row level security;
alter table public.ai_usage enable row level security;

revoke all on all tables in schema public from anon, authenticated;

grant select on public.households to authenticated;
create policy households_read on public.households for select to authenticated
  using (public.mfa_ok() and id = public.my_household());

grant select on public.members to authenticated;
grant update (display_name, ai_enabled) on public.members to authenticated;
create policy members_read on public.members for select to authenticated
  using (public.mfa_ok() and household_id = public.my_household());
create policy members_update_self on public.members for update to authenticated
  using (public.mfa_ok() and user_id = auth.uid()) with check (user_id = auth.uid());

-- invites: no client access; created and redeemed through the functions below.

grant select, insert, update on public.documents to authenticated;
create policy documents_read on public.documents for select to authenticated
  using (public.mfa_ok() and household_id = public.my_household() and (scope = 'shared' or scope = public.my_person()));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.mfa_ok() and household_id = public.my_household() and (scope = 'shared' or scope = public.my_person()));
create policy documents_update on public.documents for update to authenticated
  using (public.mfa_ok() and household_id = public.my_household() and (scope = 'shared' or scope = public.my_person()))
  with check (household_id = public.my_household() and (scope = 'shared' or scope = public.my_person()));

grant select, insert, update, delete on public.private_summaries to authenticated;
create policy summaries_read on public.private_summaries for select to authenticated
  using (public.mfa_ok() and household_id = public.my_household());
create policy summaries_write on public.private_summaries for insert to authenticated
  with check (public.mfa_ok() and household_id = public.my_household() and person = public.my_person());
create policy summaries_update on public.private_summaries for update to authenticated
  using (public.mfa_ok() and household_id = public.my_household() and person = public.my_person())
  with check (household_id = public.my_household() and person = public.my_person());
create policy summaries_delete on public.private_summaries for delete to authenticated
  using (public.mfa_ok() and household_id = public.my_household() and person = public.my_person());

-- Status columns only. secret_ciphertext and webhook columns are never granted.
grant select (id, household_id, person, provider, new_account_visibility, status, status_message, last_sync_at, created_at) on public.connections to authenticated;
create policy connections_read on public.connections for select to authenticated
  using (public.mfa_ok() and household_id = public.my_household());

grant select on public.provider_accounts to authenticated;
grant update (visibility) on public.provider_accounts to authenticated;
create policy accounts_read on public.provider_accounts for select to authenticated
  using (public.mfa_ok() and household_id = public.my_household() and (public.my_person() = any (owners) or visibility = 'shared'));
-- Only the sole owner of a non-joint account decides whether their partner sees it.
create policy accounts_visibility on public.provider_accounts for update to authenticated
  using (public.mfa_ok() and household_id = public.my_household() and not joint and owners = array[public.my_person()])
  with check (not joint and owners = array[public.my_person()]);

grant select on public.provider_balances, public.provider_transactions, public.provider_positions to authenticated;
-- The subquery runs under provider_accounts' own policy, so these follow the account's visibility.
create policy balances_read on public.provider_balances for select to authenticated
  using (exists (select 1 from public.provider_accounts a where a.id = account_id));
create policy transactions_read on public.provider_transactions for select to authenticated
  using (exists (select 1 from public.provider_accounts a where a.id = account_id));
create policy positions_read on public.provider_positions for select to authenticated
  using (exists (select 1 from public.provider_accounts a where a.id = account_id));

grant select on public.ai_usage to authenticated;
create policy ai_usage_read on public.ai_usage for select to authenticated
  using (public.mfa_ok() and household_id = public.my_household());

-- ------------------------------------------------------------------ household functions
create function public.create_household(p_display_name text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  hid uuid;
begin
  if auth.uid() is null or not public.mfa_ok() then raise exception 'Two-factor sign-in is required' using errcode = '42501'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then raise exception 'You already belong to a household' using errcode = '23505'; end if;
  insert into public.households default values returning id into hid;
  insert into public.members (household_id, user_id, person, display_name) values (hid, auth.uid(), 'me', trim(p_display_name));
  return hid;
end
$$;

-- Returns a one-time code, valid for 7 days, that lets the partner join.
create function public.create_invite() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  hid uuid := public.my_household();
  raw text;
begin
  if auth.uid() is null or not public.mfa_ok() then raise exception 'Two-factor sign-in is required' using errcode = '42501'; end if;
  if hid is null then raise exception 'Create a household first' using errcode = 'P0002'; end if;
  if exists (select 1 from public.members where household_id = hid and person = 'partner') then raise exception 'Your partner has already joined' using errcode = '23505'; end if;
  raw := upper(encode(extensions.gen_random_bytes(10), 'hex'));
  insert into public.invites (household_id, code_hash, expires_at, created_by)
    values (hid, encode(extensions.digest(raw, 'sha256'), 'hex'), now() + interval '7 days', auth.uid())
    on conflict (household_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, created_by = excluded.created_by;
  return substr(raw, 1, 5) || '-' || substr(raw, 6, 5) || '-' || substr(raw, 11, 5) || '-' || substr(raw, 16, 5);
end
$$;

create function public.join_household(p_code text, p_display_name text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  inv public.invites;
  clean text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Fa-f]', '', 'g'));
begin
  if auth.uid() is null or not public.mfa_ok() then raise exception 'Two-factor sign-in is required' using errcode = '42501'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then raise exception 'You already belong to a household' using errcode = '23505'; end if;
  select * into inv from public.invites
    where code_hash = encode(extensions.digest(clean, 'sha256'), 'hex') and expires_at > now()
    for update;
  if not found then raise exception 'That invite code is wrong or has expired' using errcode = 'P0002'; end if;
  insert into public.members (household_id, user_id, person, display_name) values (inv.household_id, auth.uid(), 'partner', trim(p_display_name));
  delete from public.invites where household_id = inv.household_id;
  return inv.household_id;
end
$$;

-- Saves a document only if nobody else saved it since the caller loaded it.
-- Returns the new version, or raises 40001 so the app can merge and retry.
create function public.save_document(p_scope text, p_data jsonb, p_expected_version integer) returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare
  hid uuid := public.my_household();
  v integer;
begin
  if p_expected_version = 0 then
    insert into public.documents (household_id, scope, data, version, updated_by)
      values (hid, p_scope, p_data, 1, auth.uid())
      on conflict (household_id, scope) do nothing
      returning version into v;
  else
    update public.documents set data = p_data, version = version + 1, updated_at = now(), updated_by = auth.uid()
      where household_id = hid and scope = p_scope and version = p_expected_version
      returning version into v;
  end if;
  if v is null then raise exception 'The document changed since it was loaded' using errcode = '40001'; end if;
  return v;
end
$$;

-- Functions: nothing for anonymous callers; signed-in callers get only these.
revoke all on all functions in schema public from anon, authenticated, public;
grant execute on function public.mfa_ok(), public.my_household(), public.my_person() to authenticated;
grant execute on function public.create_household(text), public.create_invite(), public.join_household(text, text), public.save_document(text, jsonb, integer) to authenticated;

-- ------------------------------------------------------------------ realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.documents, public.private_summaries, public.provider_accounts, public.provider_transactions;
  end if;
end
$$;
