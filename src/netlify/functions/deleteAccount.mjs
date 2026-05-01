import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const token = (event.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: "Authorization required" }) };
  }

  const supabase = getSupabaseAdmin();

  // Verify the token belongs to a real session
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid or expired token" }) };
  }

  // Delete the auth user — cascades to memberships if FK is set up,
  // otherwise Supabase cleans up auth.users and related auth schema rows.
  const { error: deleteErr } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    console.error("deleteAccount error:", deleteErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: deleteErr.message }) };
  }

  console.log(`Deleted account for user ${user.id} (${user.email})`);
  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
