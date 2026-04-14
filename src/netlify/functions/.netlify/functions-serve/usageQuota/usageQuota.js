var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// usageQuota.mjs
var usageQuota_exports = {};
__export(usageQuota_exports, {
  checkAndIncrementCredits: () => checkAndIncrementCredits,
  logAnonUsage: () => logAnonUsage,
  logUsageEvent: () => logUsageEvent
});
module.exports = __toCommonJS(usageQuota_exports);
var import_supabase_js = require("@supabase/supabase-js");
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return (0, import_supabase_js.createClient)(url, key, { auth: { persistSession: false } });
}
async function checkAndIncrementCredits(userId) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return { allowed: true };
  const { data: m, error } = await supabase.from("memberships").select("tier, status, credits_used, credits_limit").eq("user_id", userId).single();
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
  await supabase.from("memberships").update({ credits_used: m.credits_used + 1 }).eq("user_id", userId);
  return { allowed: true };
}
async function logUsageEvent(userId, fields) {
  const supabase = getSupabaseAdmin();
  if (!supabase || !userId) return;
  await supabase.from("usage_events").insert({ user_id: userId, ...fields });
}
async function logAnonUsage() {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  try {
    await supabase.rpc("increment_anon_usage");
  } catch {
    try {
      const { data } = await supabase.from("anon_usage").select("credits_used").eq("id", 1).single();
      if (data) await supabase.from("anon_usage").update({ credits_used: data.credits_used + 1 }).eq("id", 1);
    } catch {
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkAndIncrementCredits,
  logAnonUsage,
  logUsageEvent
});
//# sourceMappingURL=usageQuota.js.map
