-- Newer Supabase projects no longer give service_role read and write rights on new public tables
-- (it only gets truncate, references, trigger and maintain). The Edge Functions use service_role to count
-- a player's plays, create a missing profile, save the play and set the launch-email opt-in, so grant
-- exactly those. service_role bypasses RLS but still needs table privileges.
grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.plays to service_role;
