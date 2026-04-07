import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function checkAndIncrementCredits(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return { allowed: true };

  const { data: m, error } = await supabase
    .from("memberships")
    .select("tier, status, credits_used, credits_limit")
    .eq("user_id", userId)
    .single();

  if (error || !m) return { allowed: true };

  const unlimited = m.credits_limit === -1;
  if (!unlimited && m.credits_used >= m.credits_limit) {
    return {
      allowed: false,
      reason: `Credit limit reached (${m.credits_used}/${m.credits_limit}) for tier "${m.tier}".`,
      tier: m.tier,
      used: m.credits_used,
      limit: m.credits_limit
    };
  }

  await supabase
    .from("memberships")
    .update({ credits_used: m.credits_used + 1 })
    .eq("user_id", userId);

  return { allowed: true };
}

export async function logUsageEvent(userId, fields) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return;
  await supabase.from("usage_events").insert({ user_id: userId, ...fields });
}

export async function logAnonUsage() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  try {
    await supabase.rpc("increment_anon_usage");
  } catch {
    // Fallback: manual increment if RPC unavailable
    try {
      const { data } = await supabase.from("anon_usage").select("credits_used").eq("id", 1).single();
      if (data) await supabase.from("anon_usage").update({ credits_used: data.credits_used + 1 }).eq("id", 1);
    } catch {}
  }
}
