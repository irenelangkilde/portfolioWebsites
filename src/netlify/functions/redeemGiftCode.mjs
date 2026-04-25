import { createClient } from "@supabase/supabase-js";

// What each gift tier grants when redeemed.
// Adjust credits/downloads/deploys to match your service tiers.
const GIFT_GRANTS = {
  starter_gift: { tier: "basic",   credits_limit: 10, downloads_limit: 1, deploys_limit: 1 },
  pro_gift:     { tier: "premium", credits_limit: 25, downloads_limit: 5, deploys_limit: 5 },
};

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

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { code, userId } = body;
  if (!code || !userId) {
    return { statusCode: 400, body: JSON.stringify({ error: "code and userId are required" }) };
  }

  const supabase = getSupabaseAdmin();
  const normalizedCode = code.trim().toUpperCase();

  const { data: gift, error: fetchErr } = await supabase
    .from("gift_codes")
    .select("*")
    .eq("code", normalizedCode)
    .single();

  if (fetchErr || !gift) {
    return { statusCode: 404, body: JSON.stringify({ error: "Gift code not found." }) };
  }
  if (gift.redeemed_at) {
    return { statusCode: 409, body: JSON.stringify({ error: "This gift code has already been redeemed." }) };
  }
  if (new Date(gift.expires_at) < new Date()) {
    return { statusCode: 410, body: JSON.stringify({ error: "This gift code has expired." }) };
  }

  const { error: redeemErr } = await supabase
    .from("gift_codes")
    .update({ redeemed_by: userId, redeemed_at: new Date().toISOString() })
    .eq("id", gift.id);

  if (redeemErr) {
    console.error("Failed to mark gift code redeemed:", redeemErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to redeem gift code." }) };
  }

  const grants = GIFT_GRANTS[gift.tier];
  if (!grants) {
    return { statusCode: 500, body: JSON.stringify({ error: `Unknown gift tier: ${gift.tier}` }) };
  }

  const { error: membershipErr } = await supabase
    .from("memberships")
    .update({ ...grants, status: "active" })
    .eq("user_id", userId);

  if (membershipErr) {
    console.error("Failed to upgrade membership:", membershipErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Code redeemed but membership upgrade failed — contact support." }) };
  }

  console.log(`Gift code ${normalizedCode} (${gift.tier}) redeemed by user ${userId}`);
  return { statusCode: 200, body: JSON.stringify({ success: true, tier: gift.tier }) };
}
