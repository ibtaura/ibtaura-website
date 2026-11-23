-- Owner decision (2026-11-23): friends can't remove each other. Browsers lose the right to call
-- remove_friend; the function stays for an admin to use from the SQL editor if ever needed.
revoke all on function public.remove_friend(text) from public, anon, authenticated, service_role;
