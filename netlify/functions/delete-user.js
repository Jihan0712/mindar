// Use global fetch (Node 18+) available in Netlify Functions runtime.
exports.handler = async function(event) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key, Authorization',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  try {
    const adminKey = process.env.ADMIN_DELETE_KEY;
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;

    if (!adminKey || !serviceRole || !supabaseUrl) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Server not configured' }) };
    }

    const provided = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
    // Allow either the server ADMIN_DELETE_KEY or an authenticated admin session token.
    let authorized = false;
    if (provided && provided === adminKey) {
      authorized = true;
    } else {
      // Try Authorization: Bearer <access_token>
      const authHeader = event.headers['authorization'] || event.headers['Authorization'];
      if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        const accessToken = authHeader.split(' ')[1];
        try {
          // Validate the token and fetch the user id
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
              // Check admins table via REST API using service_role to ensure the token belongs to an admin
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
                if (Array.isArray(admRows) && admRows.length > 0) {
                  authorized = true;
                }
              }
            }
          }
        } catch (e) {
          console.warn('Auth token validation failed', e);
        }
      }
    }

    if (!authorized) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const userId = body.userId || body.user_id || body.id;
    if (!userId) return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing userId' }) };

    // Delete auth user via Supabase Admin REST API
    const adminUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
    const resp = await fetch(adminUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${serviceRole}`,
        apikey: serviceRole,
        'Content-Type': 'application/json',
      },
    });

    const text = await resp.text();
    if (!resp.ok) {
      return { statusCode: resp.status, headers: corsHeaders, body: text || JSON.stringify({ error: 'delete failed' }) };
    }

    // Optionally, you can perform DB cleanup here using the service role key via the REST API or SDK.

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
  }
};
