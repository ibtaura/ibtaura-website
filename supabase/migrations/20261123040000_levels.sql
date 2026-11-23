-- Clarus Attention Test: difficulty levels (Easy / Normal / Hard) on one shared board.
--
-- Owner decision (2026-11-23): there is ONE leaderboard for all levels. scoring.js adds a level bonus to the
-- overall score (Easy -10, Normal 0, Hard +10), so scores from different levels compare directly and the
-- ranking rules do not change. The board only shows which level each person's best run was played on.
--
-- What changes:
--   plays.level            'easy' | 'normal' | 'hard', not null, default 'normal' (rows saved before levels
--                          existed were Normal runs). Written only by the submit-score Edge Function.
--   private.at_ranked()    also returns the level of the person's best play.
--   board(), my_rank()     same parameters as before, plus a level column in the result.
--   friends_board()        same parameters, plus level, and NO friend_ref any more: friends can't remove each
--                          other (20261123030000_no_friend_removal.sql), so other people's friend codes are not
--                          returned. remove_friend stays revoked from every browser role (not touched here).
--                          It now includes every friend whatever their show_on_board: that switch hides a player
--                          from the global board only (owner decision, 2026-11-23).
-- A changed return type needs drop + create, which also drops the grants, so every grant is re-applied below
-- exactly as before. This project does not grant function rights by default.

-- ─── Column ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.plays
  add column level text not null default 'normal'
  constraint plays_level_ok check (level in ('easy', 'normal', 'hard'));

-- The board queries read level from the play they rank, so carry it in the two board indexes (index-only scans).
drop index if exists public.plays_valid_created_idx;
drop index if exists public.plays_valid_overall_idx;
create index plays_valid_created_idx on public.plays (created_at desc) include (user_id, overall, device, level) where valid;
create index plays_valid_overall_idx on public.plays (overall desc, created_at) include (user_id, device, level) where valid;

-- ─── Drop the old signatures (return types change) ──────────────────────────────────────────────────────
drop function if exists public.board(text, text, int);
drop function if exists public.my_rank(text, text);
drop function if exists public.friends_board(text, text);
drop function if exists private.at_ranked(text, text, uuid);

-- ─── Board queries ──────────────────────────────────────────────────────────────────────────────────────
-- Best valid play per person for a period and device, ranked: higher score first, the earlier play wins a tie.
-- Includes people who hide themselves only when include_user is them (for "my rank"). level is the level of
-- that best play.
create function private.at_ranked(period text, device text, include_user uuid)
returns table (user_id uuid, display_name text, score smallint, device text, achieved_at timestamptz, rank bigint,
               level text)
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
           p.user_id, p.overall, p.device, p.created_at, p.level
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
         row_number() over (order by b.overall desc, b.created_at asc, b.user_id) as rank,
         b.level
  from best b
  join public.profiles pr on pr.user_id = b.user_id;
$$;

-- The public board. is_me marks the caller's own row (false for everyone when signed out).
create function public.board(period text default 'today', device text default 'all', max_rows int default 50)
returns table (rank bigint, display_name text, score smallint, device text, achieved_at timestamptz, is_me boolean,
               level text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.rank, r.display_name, r.score, r.device, r.achieved_at, coalesce(r.user_id = auth.uid(), false), r.level
  from private.at_ranked($1, $2, null) r
  order by r.rank
  limit greatest(1, least(coalesce($3, 50), 100));
$$;

-- The caller's rank among people on the board (counting themselves even when hidden). No row when signed
-- out or when they have no valid play in the period.
create function public.my_rank(period text default 'today', device text default 'all')
returns table (rank bigint, score smallint, device text, achieved_at timestamptz, total bigint, hidden boolean,
               level text)
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
         not coalesce((select pr.show_on_board from public.profiles pr where pr.user_id = r.user_id), true),
         r.level
  from r
  where auth.uid() is not null and r.user_id = auth.uid();
$$;

-- ─── Friends board ──────────────────────────────────────────────────────────────────────────────────────
-- Same rules as private.at_ranked (best valid play per person, higher score first, the earlier play wins a
-- tie, UTC days, "week" = last 7 x 24 hours), but only over the caller and their friends. Empty when signed out.
-- show_on_board does NOT apply here (owner, 2026-11-23): "Show me on the global board" only hides a player from
-- board() and the global my_rank(); friends always see each other's best score.
create function public.friends_board(period text default 'today', device text default 'all')
returns table (rank bigint, display_name text, score smallint, device text, achieved_at timestamptz,
               is_me boolean, level text)
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
           p.user_id, p.overall, p.device, p.created_at, p.level
    from public.plays p
    join members mb on mb.user_id = p.user_id
    cross join bounds b
    where p.valid
      and p.overall is not null
      and p.created_at >= b.since
      and (b.dev is null or p.device = b.dev)
    order by p.user_id, p.overall desc, p.created_at asc
  ),
  ranked as (
    select b.*, row_number() over (order by b.overall desc, b.created_at asc, b.user_id) as rnk
    from best b
  )
  select r.rnk, pr.display_name, r.overall, r.device, r.created_at,
         r.user_id = m.id,
         r.level
  from ranked r
  join public.profiles pr on pr.user_id = r.user_id
  cross join me m
  order by r.rnk
  limit 100;
$$;

-- ─── Privileges (same as before: board for everyone, my_rank and friends_board for signed-in browsers) ──
revoke all on function private.at_ranked(text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.board(text, text, int) from public, anon, authenticated, service_role;
revoke all on function public.my_rank(text, text) from public, anon, authenticated, service_role;
revoke all on function public.friends_board(text, text) from public, anon, authenticated, service_role;
grant execute on function public.board(text, text, int) to anon, authenticated;
grant execute on function public.my_rank(text, text) to authenticated;
grant execute on function public.friends_board(text, text) to authenticated;

-- Make the API pick up the new result columns straight away.
notify pgrst, 'reload schema';
