-- Clarus Attention Test leaderboard.
--
-- Who can do what (anon = signed-out browser, authenticated = signed-in browser; both use the public anon key):
--   profiles  read/update own row only, and only display_name, show_on_board, launch_emails. No insert/delete
--             from browsers: a trigger creates the row on sign-up, deleting the auth user removes it.
--   plays     read own rows only. No insert/update/delete from browsers: only the submit-score Edge Function
--             writes, with the service role, after re-scoring the raw run on the server.
--   board()   anyone can call it. It returns rank, display name, score, device and time, never ids, emails or raw.
--   my_rank() the caller's own rank.
-- Days are UTC. "week" is the rolling last 7 x 24 hours.

-- ─── Helpers live in a schema the API does not expose ──────────────────────────────────────────────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Characters a display name may use: letters, numbers, space, . - _ plus combining marks used by
-- accented Latin, Indic scripts and Thai (so "José" or "प्रिया" work).
create or replace function private.at_name_ok(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select name is not null
     and name = btrim(name)
     and char_length(name) between 2 and 24
     and name ~ '^[[:alnum:] ._\u0300-\u036F\u0900-\u0DFF\u0E00-\u0E7F-]+$'
     and name ~ '[[:alnum:]]'
     and name !~ '  ';
$$;

-- A small blocklist, checked when a person edits their name (not on the default from Google: that is their
-- real name). Matches inside the name after lower-casing, undoing common digit swaps and dropping . - _ space.
create or replace function private.at_name_blocked(name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  -- Two lists: stems that are never part of a real name match anywhere (with separators removed);
  -- short words that hide inside real names ("Shital", "Hancock", "Draper") match only as a whole word.
  -- Keep in step with BLOCK_ANYWHERE / BLOCK_WORDS in assets/js/attention-test/board.js.
  with n as (
    select translate(lower(coalesce(name, '')), '013457', 'oieast') as s
  )
  select exists (
    select 1 from n, unnest(array[
      'fuck', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'asshole', 'motherf', 'dickhead', 'retard',
      'porn', 'chutiya', 'madarchod', 'bhenchod', 'behenchod', 'bhosdi'
    ]) as w
    where position(w in regexp_replace(n.s, '[ ._-]', '', 'g')) > 0
  ) or exists (
    select 1 from n, unnest(regexp_split_to_array(n.s, '[ ._-]+')) as part
    where part = any (array[
      'shit', 'slut', 'bitch', 'bastard', 'pussy', 'rape', 'rapist', 'hitler', 'nazi', 'cock',
      'penis', 'vagina', 'boob', 'boobs', 'tits', 'twat', 'wank', 'wanker', 'kike', 'chink', 'paki', 'gandu', 'sex'
    ])
  );
$$;

-- "Priya Sharma" -> "Priya S.", with characters we can't show removed; "Player" when nothing usable is left.
create or replace function private.at_default_name(full_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  cleaned text;
  parts text[];
  candidate text;
begin
  cleaned := regexp_replace(coalesce(full_name, ''), '[^[:alnum:] ._\u0300-\u036F\u0900-\u0DFF\u0E00-\u0E7F-]', '', 'g');
  cleaned := btrim(regexp_replace(cleaned, '\s+', ' ', 'g'));
  if cleaned = '' then
    return 'Player';
  end if;
  parts := string_to_array(cleaned, ' ');
  candidate := left(parts[1], 20);
  if array_length(parts, 1) > 1 then
    candidate := candidate || ' ' || left(parts[array_length(parts, 1)], 1) || '.';
  end if;
  candidate := btrim(candidate);
  if private.at_name_ok(candidate) then
    return candidate;
  end if;
  return 'Player';
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- ─── Tables ─────────────────────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Same rule as private.at_name_ok, written inline: a CHECK runs as the writing role, which can't call private.*.
  display_name text not null default 'Player' constraint profiles_display_name_ok check (
    display_name = btrim(display_name)
    and char_length(display_name) between 2 and 24
    and display_name ~ '^[[:alnum:] ._\u0300-\u036F\u0900-\u0DFF\u0E00-\u0E7F-]+$'
    and display_name ~ '[[:alnum:]]'
    and display_name !~ '  '
  ),
  show_on_board boolean not null default true,
  launch_emails boolean not null default false,
  launch_emails_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  device text not null check (device in ('phone', 'computer')),
  overall smallint check (overall between 0 and 200),
  reaction smallint check (reaction between 0 and 200),
  memory smallint check (memory between 0 and 200),
  rules smallint check (rules between 0 and 200),
  valid boolean not null,
  raw jsonb not null,
  scoring_version smallint not null,
  norms text not null,
  -- Raw measures, kept as columns so the norms can be re-fitted later without unpacking raw.
  median_ms integer,
  speed numeric(7, 4),
  performance numeric(5, 4),
  best_span smallint,
  rule_accuracy numeric(5, 4),
  rule_mean_ms integer,
  check (not valid or overall is not null)
);

-- Rate limit and "my plays": a user's plays by time.
create index plays_user_created_idx on public.plays (user_id, created_at desc);
-- Today / this week: valid plays by time.
create index plays_valid_created_idx on public.plays (created_at desc) include (user_id, overall, device) where valid;
-- All time: valid plays by score.
create index plays_valid_overall_idx on public.plays (overall desc, created_at) include (user_id, device) where valid;

-- ─── Triggers ───────────────────────────────────────────────────────────────────────────────────────────
-- Create the profile when someone signs up. It must never block a sign-up, so any problem falls back to "Player".
create or replace function private.at_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.profiles (user_id, display_name)
    values (new.id, private.at_default_name(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')))
    on conflict (user_id) do nothing;
  exception when others then
    insert into public.profiles (user_id, display_name) values (new.id, 'Player') on conflict (user_id) do nothing;
  end;
  return new;
end;
$$;

create trigger at_on_auth_user_created
  after insert on auth.users
  for each row execute function private.at_handle_new_user();

-- Keep updated_at and launch_emails_at right, and check edited names against the blocklist.
-- security definer so it can call private.at_name_blocked when a signed-in browser updates its row.
create or replace function private.at_profiles_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.launch_emails is distinct from old.launch_emails then
    new.launch_emails_at := case when new.launch_emails then now() else null end;
  end if;
  if new.display_name is distinct from old.display_name and private.at_name_blocked(new.display_name) then
    raise exception 'name_not_allowed' using errcode = '22023', hint = 'Pick a different display name.';
  end if;
  return new;
end;
$$;

create trigger at_profiles_before_update
  before update on public.profiles
  for each row execute function private.at_profiles_before_update();

-- ─── Privileges and row level security ──────────────────────────────────────────────────────────────────
-- Supabase grants everything on new public tables to anon and authenticated by default; take it back and
-- grant only what browsers need. RLS then limits the rows.
revoke all on public.profiles from anon, authenticated;
revoke all on public.plays from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, show_on_board, launch_emails) on public.profiles to authenticated;
grant select on public.plays to authenticated;

alter table public.profiles enable row level security;
alter table public.plays enable row level security;

create policy "profiles: read own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "plays: read own" on public.plays
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- No insert/update/delete policies on either table: with RLS on, browsers can't write those.
-- The service role (Edge Functions only, its key never leaves Supabase) bypasses RLS.

-- ─── Board queries ──────────────────────────────────────────────────────────────────────────────────────
-- Best valid play per person for a period and device, ranked: higher score first, the earlier play wins a tie.
-- Includes people who hide themselves only when include_user is them (for "my rank").
create or replace function private.at_ranked(period text, device text, include_user uuid)
returns table (user_id uuid, display_name text, score smallint, device text, achieved_at timestamptz, rank bigint)
language sql
stable
security definer
set search_path = ''
as $$
  -- $1 period, $2 device, $3 include_user (positional, so they can't be confused with column names)
  with bounds as (
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
  best as (
    select distinct on (p.user_id)
           p.user_id, p.overall, p.device, p.created_at
    from public.plays p
    join public.profiles pr on pr.user_id = p.user_id
    cross join bounds b
    where p.valid
      and p.overall is not null
      and p.created_at >= b.since
      and (b.dev is null or p.device = b.dev)
      and (pr.show_on_board or p.user_id = $3)
    order by p.user_id, p.overall desc, p.created_at asc
  )
  select b.user_id, pr.display_name, b.overall, b.device, b.created_at,
         row_number() over (order by b.overall desc, b.created_at asc, b.user_id) as rank
  from best b
  join public.profiles pr on pr.user_id = b.user_id;
$$;

revoke all on function private.at_ranked(text, text, uuid) from public, anon, authenticated;

-- The public board. is_me marks the caller's own row (false for everyone when signed out).
create or replace function public.board(period text default 'today', device text default 'all', max_rows int default 50)
returns table (rank bigint, display_name text, score smallint, device text, achieved_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select r.rank, r.display_name, r.score, r.device, r.achieved_at, coalesce(r.user_id = auth.uid(), false)
  from private.at_ranked($1, $2, null) r
  order by r.rank
  limit greatest(1, least(coalesce($3, 50), 100));
$$;

-- The caller's rank among people on the board (counting themselves even when hidden). No row when signed
-- out or when they have no valid play in the period.
create or replace function public.my_rank(period text default 'today', device text default 'all')
returns table (rank bigint, score smallint, device text, achieved_at timestamptz, total bigint, hidden boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select * from private.at_ranked($1, $2, auth.uid())
  )
  select r.rank, r.score, r.device, r.achieved_at,
         (select count(*) from r),
         not coalesce((select pr.show_on_board from public.profiles pr where pr.user_id = r.user_id), true)
  from r
  where auth.uid() is not null and r.user_id = auth.uid();
$$;

revoke all on function public.board(text, text, int) from public;
revoke all on function public.my_rank(text, text) from public;
grant execute on function public.board(text, text, int) to anon, authenticated;
grant execute on function public.my_rank(text, text) to authenticated;
