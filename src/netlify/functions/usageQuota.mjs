import { createClient } from "@supabase/supabase-js";
import { isDeletable, deletionDate, DELETION_GRACE_MONTHS } from "./membershipDates.mjs";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function skipUsageQuota() {
  return process.env.PORTFOLIO_SKIP_USAGE_QUOTA === "true";
}

export async function checkAndIncrementCredits(userId) {
  if (skipUsageQuota()) return { allowed: true };
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return { allowed: true };

  const { data: m, error } = await supabase
    .from("memberships")
    .select("tier, status, credits_used, credits_limit, hosting_until")
    .eq("user_id", userId)
    .single();

  if (error || !m) return { allowed: true };

  // Credits expire 18 months after hosting lapsed — the same moment the published site
  // becomes deletable, so hosting_until remains the single date the whole system reasons
  // about. Editor access is deliberately NOT gated: someone may want to open old work long
  // after they have stopped paying, and refusing that costs a goodwill visit to gain
  // nothing. It is generating new sites that consumes real money.
  //
  // An absent hosting_until does not expire anything. Free-tier accounts and anything
  // predating hosting_until have none, and treating absent as expired would lock out every
  // one of them — the same trap that would have delisted their sites.
  if (m.hosting_until && isDeletable(m.hosting_until)) {
    return {
      allowed: false,
      reason: `Credits expired on ${new Date(deletionDate(m.hosting_until)).toISOString().slice(0, 10)}, `
            + `${DELETION_GRACE_MONTHS} months after hosting ended. Buying any plan restores them.`,
      tier: m.tier,
      used: m.credits_used,
      limit: m.credits_limit,
      expired: true,
    };
  }

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
  if (skipUsageQuota()) return;
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return;
  await supabase.from("usage_events").insert({ user_id: userId, ...fields });
}

export async function logAnonUsage() {
  if (skipUsageQuota()) return;
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
