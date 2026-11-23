// POST /functions/v1/delete-me
// Header: Authorization: Bearer <the signed-in user's access token>.
// Deletes the caller's auth user; the foreign keys (on delete cascade) remove their profile and plays.
// Replies 200 { deleted: true }, or 401 / 500 { error }.
import { adminClient, getCaller, json, preflight } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  const early = preflight(req);
  if (early) return early;

  try {
    const caller = await getCaller(req);
    if (!caller) return json(req, 401, { error: 'unauthorized', reason: 'signIn' });

    const { error } = await adminClient().auth.admin.deleteUser(caller.user.id);
    if (error) throw error;
    return json(req, 200, { deleted: true });
  } catch (err) {
    console.error('delete-me failed', err instanceof Error ? err.message : err);
    return json(req, 500, { error: 'server_error' });
  }
});
