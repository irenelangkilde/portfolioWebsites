import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const sessionId = event.queryStringParameters?.sessionId;
  if (!sessionId) {
    return { statusCode: 400, body: JSON.stringify({ error: "sessionId is required" }) };
  }

  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("gift_codes")
    .select("code, tier")
    .eq("stripe_session_id", sessionId)
    .single();

  if (error || !data) {
    return { statusCode: 404, body: JSON.stringify({ error: "Gift code not found" }) };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ code: data.code, tier: data.tier }),
  };
}
