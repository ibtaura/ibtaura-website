// Shared helpers for the Attention Test Edge Functions: CORS allowlist, JSON replies, the signed-in user.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.119.0';

// Comma-separated; a "*" stands for one or more host labels (for Cloudflare preview URLs).
const DEFAULT_ORIGINS = 'https://adarna.us,https://*.workers.dev,http://localhost:8787';

function originPatterns(): RegExp[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') || DEFAULT_ORIGINS;
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .map((pattern) => {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+(?:\\.[a-z0-9-]+)*');
      return new RegExp(`^${escaped}$`, 'i');
    });
}

/** True when the request comes from an allowed page, or from no page at all (curl, server to server). */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('Origin');
  if (!origin) return true;
  return originPatterns().some((re) => re.test(origin));
}

export function corsHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  const origin = req.headers.get('Origin');
  if (origin && originAllowed(req)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Handles OPTIONS and the origin/method checks every function shares. Returns a Response to send, or null. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: originAllowed(req) ? 204 : 403, headers: corsHeaders(req) });
  }
  if (!originAllowed(req)) return json(req, 403, { error: 'forbidden', reason: 'origin' });
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });
  return null;
}

/** The first of the named environment variables that is set. */
function env(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error(`missing env ${names.join(' or ')}`);
}

// Projects with the newer API keys may not have the legacy anon / service_role JWT keys. Supabase injects
// the legacy names when they exist; otherwise set SB_PUBLISHABLE_KEY and SB_SECRET_KEY with
// `npx supabase secrets set` (see supabase/README.md). Custom secrets can't start with SUPABASE_.
const SECRET_KEY = () => env('SUPABASE_SERVICE_ROLE_KEY', 'SB_SECRET_KEY');
const PUBLIC_KEY = () => env('SUPABASE_ANON_KEY', 'SB_PUBLISHABLE_KEY');

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** The service-role client. Bypasses RLS: use it only after checking who is asking. */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), SECRET_KEY(), noSession);
}

/** A client that acts as the signed-in caller (RLS and auth.uid() apply). */
export function userClient(token: string): SupabaseClient {
  return createClient(env('SUPABASE_URL'), PUBLIC_KEY(), {
    ...noSession,
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/** Verifies the caller's access token with Supabase Auth. Returns the user and token, or null. */
export async function getCaller(req: Request): Promise<{ user: User; token: string } | null> {
  const header = req.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  // The anon key itself is a JWT but not a user's; getUser rejects it.
  const { data, error } = await userClient(token).auth.getUser(token);
  if (error || !data?.user) return null;
  return { user: data.user, token };
}
