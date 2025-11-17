const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

exports.handler = async function(event) {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
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
    if (!provided || provided !== adminKey) {
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
