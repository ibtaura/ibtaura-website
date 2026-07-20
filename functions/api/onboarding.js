/**
 * Cloudflare Pages Function — receives submissions from onboarding.html
 * and appends each one as a row in the Zoho Sheet:
 *
 *   "IBT Aura — Team Onboarding Responses"
 *   https://sheet.zoho.in/sheet/open/fb09s218a1adaefd94b69aa8ce543d43e91e3
 *
 * Required environment variables — add these in the Cloudflare dashboard under
 * Settings → Environment variables, and mark each one as "Encrypt":
 *
 *   ZOHO_CLIENT_ID
 *   ZOHO_CLIENT_SECRET
 *   ZOHO_REFRESH_TOKEN
 *
 * Secrets live only in Cloudflare — they are never exposed to the browser.
 */

const RESOURCE_ID = 'fb09s218a1adaefd94b69aa8ce543d43e91e3';
const WORKSHEET_NAME = 'Sheet1';
const ACCOUNTS_HOST = 'https://accounts.zoho.in';
const SHEET_HOST = 'https://sheet.zoho.in';

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();

    for (const field of ['fullName', 'email', 'mobile']) {
      if (!body[field] || !String(body[field]).trim()) {
        return json({ error: `Missing required field: ${field}` }, 400);
      }
    }

    const accessToken = await getAccessToken(env);

    const row = {
      'Submitted At': formatIST(body.submittedAt),
      'Full Name': clean(body.fullName),
      'Email ID': clean(body.email),
      'Mobile Number': clean(body.mobile),
      'Preferred Time to Work': clean(body.preferredTime),
      'On-site / Online': clean(body.workMode),
      'Technical Skills': clean(body.technicalSkills),
      'Passive Skills': clean(body.passiveSkills),
      'Travel Availability': clean(body.travel),
      'Additional Description': clean(body.additional)
    };

    const params = new URLSearchParams({
      method: 'worksheet.records.add',
      worksheet_name: WORKSHEET_NAME,
      header_row: '1',
      json_data: JSON.stringify([row])
    });

    const res = await fetch(`${SHEET_HOST}/api/v2/${RESOURCE_ID}`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const result = await res.json();
    if (!res.ok || result.status !== 'success') {
      return json({ error: 'Could not write to the sheet', detail: result }, 502);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Server error', detail: String(err && err.message) }, 500);
  }
}

/** Exchange the long-lived refresh token for a short-lived access token. */
async function getAccessToken(env) {
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET || !env.ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho environment variables are not configured in Cloudflare');
  }

  const params = new URLSearchParams({
    refresh_token: env.ZOHO_REFRESH_TOKEN,
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });

  const res = await fetch(`${ACCOUNTS_HOST}/oauth/v2/token?${params.toString()}`, {
    method: 'POST'
  });
  const data = await res.json();

  if (!data.access_token) {
    throw new Error('Zoho token refresh failed');
  }
  return data.access_token;
}

/** Render the timestamp in IST so the sheet reads naturally. */
function formatIST(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function clean(value) {
  return String(value == null ? '' : value).trim().slice(0, 5000);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
