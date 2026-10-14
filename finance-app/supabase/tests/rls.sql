-- Row level security tests. Run with: npm run test:db (needs a local Postgres; see README).
-- Any failed check raises an exception and stops the script with a non-zero exit code.
\set ON_ERROR_STOP 1
\set QUIET 1

create function public.t_assert(ok boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', msg; end if;
end
$$;
grant execute on function public.t_assert(boolean, text) to authenticated, anon;

-- A = creates the household ("me"), B = partner, C = someone in another household.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');

create function public.t_as(who text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000000' || who, 'aal', aal)::text, true);
end
$$;
grant execute on function public.t_as(text, text) to authenticated, anon;

-- 1. Two-factor sign-in is required to create a household.
begin;
set local role authenticated;
select public.t_as('a', 'aal1');
do $$ begin
  perform public.create_household('Alex');
  raise exception 'FAILED: household created without two-factor sign-in';
exception when insufficient_privilege then null;
end $$;
rollback;

-- 2. A creates a household and an invite; B joins with it.
begin;
set local role authenticated;
select public.t_as('a');
select public.create_household('Alex');
do $$ begin
  perform public.create_household('Alex again');
  raise exception 'FAILED: second household allowed';
exception when unique_violation then null;
end $$;
select set_config('t.code', public.create_invite(), false);
commit;

begin;
set local role authenticated;
select public.t_as('c');
do $$ begin
  perform public.join_household('00000-00000-00000-00000', 'Chris');
  raise exception 'FAILED: joined with a wrong code';
exception when no_data_found then null;
end $$;
rollback;

begin;
set local role authenticated;
select public.t_as('b');
select public.join_household(current_setting('t.code'), 'Blake');
select public.t_assert(public.my_person() = 'partner', 'B is the partner');
commit;

begin;
set local role authenticated;
select public.t_as('c');
do $$ begin
  perform public.join_household(current_setting('t.code'), 'Chris');
  raise exception 'FAILED: invite code reused';
exception when no_data_found then null;
end $$;
select public.create_household('Chris');
commit;

-- 3. Documents: shared for both, private for the owner only, with version checks.
begin;
set local role authenticated;
select public.t_as('a');
select public.t_assert(public.save_document('shared', '{"v":"a1"}', 0) = 1, 'A creates shared doc');
select public.t_assert(public.save_document('me', '{"secret":"alex"}', 0) = 1, 'A creates private doc');
do $$ begin
  perform public.save_document('partner', '{"x":1}', 0);
  raise exception 'FAILED: A wrote the partner''s private doc';
exception when insufficient_privilege then null;
end $$;
commit;

begin;
set local role authenticated;
select public.t_as('b');
select public.t_assert(public.save_document('partner', '{"secret":"blake"}', 0) = 1, 'B creates private doc');
select public.t_assert((select count(*) from public.documents) = 2, 'B sees shared + own private only');
select public.t_assert(not exists (select 1 from public.documents where scope = 'me'), 'B cannot read A''s private doc');
select public.t_assert(public.save_document('shared', '{"v":"b2"}', 1) = 2, 'B updates shared doc');
update public.documents set data = '{"hack":1}' where scope = 'me';
commit;

begin;
set local role authenticated;
select public.t_as('a');
select public.t_assert((select data ->> 'secret' from public.documents where scope = 'me') = 'alex', 'B''s update of A''s private doc changed nothing');
do $$ begin
  perform public.save_document('shared', '{"v":"a-stale"}', 1);
  raise exception 'FAILED: stale save accepted';
exception when serialization_failure then null;
end $$;
select public.t_assert((select data ->> 'v' from public.documents where scope = 'shared') = 'b2', 'stale save did not overwrite');
rollback;

-- 4. Another household and weaker sessions see nothing.
begin;
set local role authenticated;
select public.t_as('c');
select public.t_assert((select count(*) from public.documents) = 0, 'C sees no documents');
select public.t_assert((select count(*) from public.members) = 1, 'C sees only themself');
select public.t_as('a', 'aal1');
select public.t_assert((select count(*) from public.documents) = 0, 'password-only session sees no documents');
select public.t_assert((select count(*) from public.members) = 0, 'password-only session sees no members');
rollback;

begin;
set local role anon;
do $$ begin
  perform 1 from public.documents;
  raise exception 'FAILED: anon read documents';
exception when insufficient_privilege then null;
end $$;
rollback;

-- 5. Provider data follows account ownership and visibility.
do $$
declare
  hid uuid := (select household_id from public.members where person = 'me' and user_id = '00000000-0000-0000-0000-00000000000a');
begin
  insert into public.provider_accounts (id, household_id, provider, external_id, owners, joint, visibility, name, account_type, institution, balance_cents, as_at) values
    ('10000000-0000-0000-0000-000000000001', hid, 'up', 'x', array['me'], false, 'private', 'Alex private', 'transaction', 'Up', 100, now()),
    ('10000000-0000-0000-0000-000000000002', hid, 'up', 'y', array['me', 'partner'], true, 'shared', '2Up', 'transaction', 'Up', 200, now()),
    ('10000000-0000-0000-0000-000000000003', hid, 'up', 'z', array['me'], false, 'shared', 'Alex shared saver', 'savings', 'Up', 300, now());
  insert into public.provider_transactions (account_id, external_id, date, description, amount_cents) values
    ('10000000-0000-0000-0000-000000000001', 't1', current_date, 'private coffee', -500),
    ('10000000-0000-0000-0000-000000000002', 't2', current_date, 'groceries', -9000),
    ('10000000-0000-0000-0000-000000000003', 't3', current_date, 'interest', 12);
  insert into public.provider_balances (account_id, date, balance_cents) values ('10000000-0000-0000-0000-000000000001', current_date, 100);
  insert into public.connections (household_id, person, provider, secret_ciphertext) values (hid, 'me', 'up', 'ciphertext');
end $$;

begin;
set local role authenticated;
select public.t_as('b');
select public.t_assert((select count(*) from public.provider_accounts) = 2, 'B sees the joint and shared accounts only');
select public.t_assert((select count(*) from public.provider_transactions) = 2, 'B sees transactions of visible accounts only');
select public.t_assert(not exists (select 1 from public.provider_transactions where description = 'private coffee'), 'B cannot see A''s private transactions');
select public.t_assert((select count(*) from public.provider_balances) = 0, 'B cannot see A''s private balance history');
update public.provider_accounts set visibility = 'shared' where external_id = 'x';
select public.t_assert((select count(*) from public.connections) = 1, 'B can see connection status');
do $$ begin
  perform secret_ciphertext from public.connections;
  raise exception 'FAILED: token ciphertext readable';
exception when insufficient_privilege then null;
end $$;
commit;

begin;
set local role authenticated;
select public.t_as('a');
select public.t_assert((select visibility from public.provider_accounts where external_id = 'x') = 'private', 'B could not share A''s account');
select public.t_assert((select count(*) from public.provider_accounts) = 3, 'A sees all three accounts');
update public.provider_accounts set visibility = 'private' where external_id = 'y';
select public.t_assert((select visibility from public.provider_accounts where external_id = 'y') = 'shared', 'joint account stays shared');
do $$ begin
  update public.provider_accounts set balance_cents = 1 where external_id = 'x';
  raise exception 'FAILED: client changed a synced balance';
exception when insufficient_privilege then null;
end $$;
update public.provider_accounts set visibility = 'shared' where external_id = 'x';
commit;

begin;
set local role authenticated;
select public.t_as('b');
select public.t_assert((select count(*) from public.provider_accounts) = 3, 'B sees the account A chose to share');
select public.t_as('c');
select public.t_assert((select count(*) from public.provider_accounts) = 0, 'C sees no provider accounts');
select public.t_assert((select count(*) from public.connections) = 0, 'C sees no connections');
rollback;

-- 6. Private summaries: written by their owner, readable by the partner.
begin;
set local role authenticated;
select public.t_as('a');
insert into public.private_summaries (household_id, person, data) values (public.my_household(), 'me', '{"total":1}');
do $$ begin
  insert into public.private_summaries (household_id, person, data) values (public.my_household(), 'partner', '{"total":999}');
  raise exception 'FAILED: A wrote a summary for B';
exception when insufficient_privilege then null;
end $$;
commit;

begin;
set local role authenticated;
select public.t_as('b');
select public.t_assert((select count(*) from public.private_summaries where person = 'me') = 1, 'B reads A''s shared totals');
delete from public.private_summaries where person = 'me';
commit;

begin;
set local role authenticated;
select public.t_as('a');
select public.t_assert((select count(*) from public.private_summaries) = 1, 'B could not delete A''s summary');
rollback;

\echo 'RLS tests passed'
