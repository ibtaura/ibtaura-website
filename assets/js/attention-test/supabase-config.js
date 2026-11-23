// Supabase project for the Attention Test leaderboard. Leave both empty and the page shows
// "Leaderboard opens soon" instead (the game itself never needs this).
//
// Fill these from Supabase -> Project Settings -> API (see supabase/README.md). Both values are public
// by design: every visitor's browser receives them. The anon key only lets a browser do what the
// database's row level security policies allow (read the public board, read and edit your own profile).
// Never put the service_role key (or any other secret) here: this repo and this file are public.
export const SUPABASE_URL = 'https://vhtdmyshflayqoyhktgc.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ckmtPkYGPHQAnUWfu-Qz7w_qev3xFMe'; // the project's publishable key
