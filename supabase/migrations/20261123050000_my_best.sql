-- Clarus Attention Test: "Share my best score".
--
-- The signed-in account panel shows "You're #3 ... best score 121 on Hard" and now offers to share that best
-- run as the same image score card a fresh result gets. The browser rebuilds the card from the run itself: it
-- re-scores plays.raw with scoring.js (scoreRun), so the card shows the real Reaction / Memory / Rules parts.
--
-- public.my_best()  The caller's own best valid play of all time (higher score first, the earlier play wins a
--                   tie, the same rule as the boards): raw run, overall score, level and when it was played.
--                   No row when signed out or when the caller has no valid play. Only ever the caller's row:
--                   it filters on auth.uid() and takes no parameters.
--
-- security definer like the board queries, so it doesn't depend on the plays RLS policies. This project does
-- not grant function rights by default, so execute is granted to signed-in browsers only.

create or replace function public.my_best()
returns table (raw jsonb, overall int, level text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.raw, p.overall::int, p.level, p.created_at
  from public.plays p
  where auth.uid() is not null
    and p.user_id = auth.uid()
    and p.valid
    and p.overall is not null
  order by p.overall desc, p.created_at asc
  limit 1;
$$;

revoke all on function public.my_best() from public, anon, authenticated, service_role;
grant execute on function public.my_best() to authenticated;

-- Make the API pick up the new function straight away.
notify pgrst, 'reload schema';
