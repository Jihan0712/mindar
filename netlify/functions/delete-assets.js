// Netlify Function: delete-assets
// Forwards an array of asset URLs to the Cloudflare Worker /delete endpoint
// Auth: Accepts either x-admin-key (server key) or Authorization: Bearer <access_token> for admin users

exports.handler = async function(event) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key, Authorization',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders };

  try {
    const adminKey = process.env.ADMIN_DELETE_KEY;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const workerBase = process.env.WORKER_BASE || process.env.WORKER_UPLOAD_URL || null;
    const workerKey = process.env.WORKER_DELETE_KEY || null;

    if (!adminKey || !serviceRole || !supabaseUrl) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server not configured' }) };
    }

    const provided = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
    let authorized = false;
    if (provided && provided === adminKey) {
      authorized = true;
    } else {
      const authHeader = event.headers['authorization'] || event.headers['Authorization'];
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        const accessToken = authHeader.split(' ')[1];
        try {
          const userResp = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: serviceRole,
            },
          });
          if (userResp.ok) {
            const userData = await userResp.json();
            const userId = userData?.id;
            if (userId) {
              const adminsUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/admins?select=user_id&user_id=eq.${encodeURIComponent(userId)}`;
              const admResp = await fetch(adminsUrl, {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${serviceRole}`,
                  apikey: serviceRole,
                },
              });
              if (admResp.ok) {
                const admRows = await admResp.json();
                if (Array.isArray(admRows) && admRows.length > 0) authorized = true;
              }
            }
          }
        } catch (e) {
          console.warn('Auth token validation failed', e);
        }
      }
    }

    if (!authorized) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };

    const body = event.body ? JSON.parse(event.body) : {};
    const assets = body.assets && Array.isArray(body.assets) ? body.assets : [];
    if (!assets.length) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'assets required' }) };

    if (!workerBase || !workerKey) {
      // cannot forward deletes without worker config
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Worker not configured for deletes' }) };
    }

    const assetResults = [];
    for (const a of assets) {
      try {
        const url = `${workerBase.replace(/\/$/, '')}/delete`;
        const wresp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-key': workerKey,
          },
          body: JSON.stringify({ url: a }),
        });
        const txt = await wresp.text().catch(() => '');
        assetResults.push({ url: a, status: wresp.status, body: txt });
      } catch (e) {
        assetResults.push({ url: a, error: String(e) });
      }
    }

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true, assetResults }) };
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(err) }) };
  }
};
