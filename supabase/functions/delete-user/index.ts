import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_KEY = Deno.env.get("ADMIN_DELETE_KEY");
const CLEANUP_TABLES = (Deno.env.get("CLEANUP_TABLES") || "").split(",").map(s=>s.trim()).filter(Boolean);

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
}

const supabaseAdmin = createClient(SUPABASE_URL ?? "", SERVICE_ROLE ?? "");

serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });

  const provided = req.headers.get('x-admin-key');
  if (!ADMIN_KEY || provided !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const userId = body.userId || body.user_id || body.id;
  if (!userId) return new Response(JSON.stringify({ error: 'Missing userId in body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  try {
    // Optional: clean up rows in configured tables (CLEANUP_TABLES env var comma-separated)
    for (const table of CLEANUP_TABLES) {
      try {
        const { error: delErr } = await supabaseAdmin.from(table).delete().eq('id', userId);
        if (delErr) console.warn(`cleanup ${table} error:`, delErr.message || delErr);
      } catch (e) {
        console.warn(`cleanup ${table} exception:`, e);
      }
    }

    // Delete the auth user
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('deleteUser error:', error);
      return new Response(JSON.stringify({ error: error.message || error }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Unexpected error in delete-user:', err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
