// Minimal external backend for Option 2: full account deletion
// Usage: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your hosting env
// Start locally: npm install; npm start

import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const PORT = process.env.PORT || 8080;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ALLOW_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.warn('WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Configure env in production.');
}

app.use(cors({ origin: (origin, cb) => {
  if (!origin || ALLOW_ORIGINS.includes('*') || ALLOW_ORIGINS.includes(origin)) return cb(null, true);
  return cb(new Error('Not allowed by CORS'));
}, credentials: false }));
app.use(express.json());

app.post('/admin-delete-user', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const supabaseForUser = createClient(SUPABASE_URL, SERVICE_ROLE, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await supabaseForUser.auth.getUser();
    const requester = u?.user;
    if (!requester?.id) return res.status(401).json({ error: 'Not authenticated' });

    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    if (user_id === requester.id) return res.status(400).json({ error: 'Admins cannot delete their own account' });

    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: adminRow, error: adminErr } = await adminClient
      .from('admins')
      .select('user_id')
      .eq('user_id', requester.id)
      .maybeSingle();
    if (adminErr) return res.status(500).json({ error: 'Admin check failed' });
    if (!adminRow) return res.status(403).json({ error: 'Forbidden: admin only' });

    // Domain cleanup (idempotent)
    await adminClient.from('targets').delete().eq('user_id', user_id);
    await adminClient.from('admins').delete().eq('user_id', user_id);
    await adminClient.from('profiles').delete().eq('user_id', user_id);

    // Auth delete
    const { error: authErr } = await adminClient.auth.admin.deleteUser(user_id);
    if (authErr) return res.json({ status: 'domain_only', warning: 'Auth delete failed', detail: String(authErr) });

    return res.json({ status: 'deleted' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Admin backend listening on :${PORT}`));
