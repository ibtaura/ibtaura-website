-- Clarus Attention Test: friends board.
--
-- A friend is someone connected through a friend link. Every profile gets a short friend_code; a signed-in
-- player's challenge link carries it as ?f=<code>. When someone opens that link and is (or becomes) signed
-- in, the page calls add_friend(code) and the two become friends in both directions.
--
-- Who can do what (authenticated = signed-in browser; signed-out browsers get nothing here):
--   profiles.friend_code  8 characters from abcdefghjkmnpqrstuvwxyz23456789, unique, set by a trigger on
--                         insert. Readable through the existing "profiles: read own" policy; not updatable
--                         from browsers (no column grant).
--   friendships           read own rows only (user_id = caller). No insert/update/delete from browsers: only
--                         add_friend / remove_friend write, as security definer.
--   add_friend(code)      the caller and the code's owner become friends (both directions, max 500 each).
--                         Returns the friend's display name, or null when the code is unknown.
--   remove_friend(code)   ends the friendship in both directions. code is the friend_ref from friends_board.
--   friends_board()       the caller plus their friends, each person's best valid play in the period/device,
--                         ranked inside that group. Friends who hide themselves are left out; the caller is
--                         always included. friend_ref (the friend's code, already public in their links) lets
--                         the page remove a friend; it is null on the caller's own row.
-- This project does not grant table or function rights by default, so every grant below is explicit.

-- ─── Friend codes ───────────────────────────────────────────────────────────────────────────────────────
-- 8 characters from a 31-letter alphabet with no look-alikes (no i, l, o, 0, 1): about 8.5e11 codes.
-- Random bytes come from gen_random_uuid() (built in, no extension needed). Bytes 6 and 8 of a v4 uuid carry
-- the version and variant bits, so they are skipped.
create or replace function private.at_new_friend_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  b bytea := uuid_send(gen_random_uuid());
  i int;
  code text := '';
begin
  foreach i in array array[0, 1, 2, 3, 4, 5, 10, 11] loop
    code := code || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return code;
end;
$$;

-- A fresh code that no profile uses yet.
create or replace function private.at_unused_friend_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  code text;
  tries int := 0;
begin
  loop
    code := private.at_new_friend_code();
    exit when not exists (select 1 from public.profiles p where p.friend_code = code);
    tries := tries + 1;
    if tries >= 20 then
      raise exception 'friend_code_exhausted';
    end if;
  end loop;
  return code;
end;
$$;

alter table public.profiles add column friend_code text;

-- Backfill existing profiles one by one so a code is never reused. The update trigger is switched off for
-- this so updated_at stays as it was.
alter table public.profiles disable trigger at_profiles_before_update;
do $$
declare
  r record;
begin
  for r in select user_id from public.profiles where friend_code is null loop
    update public.profiles set friend_code = private.at_unused_friend_code() where user_id = r.user_id;
  end loop;
end;
$$;
alter table public.profiles enable trigger at_profiles_before_update;

alter table public.profiles
  alter column friend_code set not null,
  add constraint profiles_friend_code_key unique (friend_code),
  add constraint profiles_friend_code_ok check (friend_code ~ '^[a-hjkmnp-z2-9]{8}$');

-- New profiles get their code from a trigger rather than a column default: a default runs as the inserting
-- role (service_role in submit-score), which can't call functions in schema private. Any code supplied on
-- insert is replaced. The unique constraint is the final guard against a race between two sign-ups.
create or replace function private.at_profiles_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.friend_code := private.at_unused_friend_code();
  return new;
end;
$$;

create trigger at_profiles_before_insert
  before insert on public.profiles
  for each row execute function private.at_profiles_before_insert();

revoke all on function private.at_new_friend_code() from public, anon, authenticated, service_role;
revoke all on function private.at_unused_friend_code() from public, anon, authenticated, service_role;
revoke all on function private.at_profiles_before_insert() from public, anon, authenticated, service_role;

-- ─── Friendships ────────────────────────────────────────────────────────────────────────────────────────
-- One row per direction: (a, b) and (b, a) are both stored, so "my friends" is a plain lookup on user_id.
create table public.friendships (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- The cascade from a deleted user and remove_friend look rows up by friend_id too.
create index friendships_friend_idx on public.friendships (friend_id);

revoke all on public.friendships from public, anon, authenticated;
grant select on public.friendships to authenticated;
grant select, insert, update, delete on public.friendships to service_role;

alter table public.friendships enable row level security;

create policy "friendships: read own" on public.friendships
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Add and remove ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.add_friend(code text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c text := lower(btrim(coalesce($1, '')));
  other uuid;
  other_name text;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if c !~ '^[a-hjkmnp-z2-9]{8}$' then
    raise exception 'bad_code' using errcode = '22023', hint = 'A friend code is 8 letters and digits.';
  end if;

  select p.user_id, p.display_name into other, other_name
  from public.profiles p
  where p.friend_code = c;

  if other is null then
    return null;
  end if;
  if other = me then
    raise exception 'own_code' using errcode = '22023', hint = 'That is your own friend link.';
  end if;

  -- Already friends: nothing to do (and no cap check, so re-opening a link never fails).
  if exists (select 1 from public.friendships f where f.user_id = me and f.friend_id = other) then
    insert into public.friendships (user_id, friend_id) values (other, me) on conflict do nothing;
    return other_name;
  end if;

  if (select count(*) from public.friendships f where f.user_id = me) >= 500
     or (select count(*) from public.friendships f where f.user_id = other) >= 500 then
    raise exception 'friend_limit' using errcode = '54000', hint = 'A friends board holds up to 500 people.';
  end if;

  insert into public.friendships (user_id, friend_id)
  values (me, other), (other, me)
  on conflict do nothing;

  return other_name;
end;
$$;

-- Returns true when a friendship was removed.
create or replace function public.remove_friend(code text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  c text := lower(btrim(coalesce($1, '')));
  other uuid;
  n int;
begin
  if me is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if c !~ '^[a-hjkmnp-z2-9]{8}$' then
    return false;
  end if;

  select p.user_id into other from public.profiles p where p.friend_code = c;
  if other is null or other = me then
    return false;
  end if;

  delete from public.friendships f
  where (f.user_id = me and f.friend_id = other)
     or (f.user_id = other and f.friend_id = me);
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ─── Friends board ──────────────────────────────────────────────────────────────────────────────────────
-- Same rules as private.at_ranked (best valid play per person, higher score first, the earlier play wins a
-- tie, UTC days, "week" = last 7 x 24 hours), but only over the caller and their friends. Empty when signed out.
create or replace function public.friends_board(period text default 'today', device text default 'all')
returns table (rank bigint, display_name text, score smallint, device text, achieved_at timestamptz,
               is_me boolean, friend_ref text)
language sql
stable
security definer
set search_path = ''
as $$
  -- $1 period, $2 device (positional, so they can't be confused with column names)
  with me as (
    select auth.uid() as id
  ),
  bounds as (
    select case lower(coalesce($1, 'all'))
             when 'today' then date_trunc('day', now() at time zone 'utc') at time zone 'utc'
             when 'week' then now() - interval '7 days'
             else '-infinity'::timestamptz
           end as since,
           case lower(coalesce($2, 'all'))
             when 'phone' then 'phone'
             when 'computer' then 'computer'
             else null
           end as dev
  ),
  members as (
    select m.id as user_id from me m where m.id is not null
    union
    select f.friend_id from public.friendships f join me m on f.user_id = m.id
  ),
  best as (
    select distinct on (p.user_id)
           p.user_id, p.overall, p.device, p.created_at
    from public.plays p
    join members mb on mb.user_id = p.user_id
    join public.profiles pr on pr.user_id = p.user_id
    cross join bounds b
    cross join me m
    where p.valid
      and p.overall is not null
      and p.created_at >= b.since
      and (b.dev is null or p.device = b.dev)
      and (pr.show_on_board or p.user_id = m.id)
    order by p.user_id, p.overall desc, p.created_at asc
  ),
  ranked as (
    select b.*, row_number() over (order by b.overall desc, b.created_at asc, b.user_id) as rnk
    from best b
  )
  select r.rnk, pr.display_name, r.overall, r.device, r.created_at,
         r.user_id = m.id,
         case when r.user_id = m.id then null else pr.friend_code end
  from ranked r
  join public.profiles pr on pr.user_id = r.user_id
  cross join me m
  order by r.rnk
  limit 100;
$$;

revoke all on function public.add_friend(text) from public, anon, service_role;
revoke all on function public.remove_friend(text) from public, anon, service_role;
revoke all on function public.friends_board(text, text) from public, anon, service_role;
grant execute on function public.add_friend(text) to authenticated;
grant execute on function public.remove_friend(text) to authenticated;
grant execute on function public.friends_board(text, text) to authenticated;
