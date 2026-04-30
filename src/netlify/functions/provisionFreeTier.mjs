import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

let localEnvCache = null;
function loadLocalEnv() {
  if (localEnvCache) return localEnvCache;
  localEnvCache = {};
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../.env")];
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf-8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!(match[1] in localEnvCache)) localEnvCache[match[1]] = value;
      }
      break;
    } catch {}
  }
  return localEnvCache;
}
function getEnv(name) { return process.env[name] || loadLocalEnv()[name] || ""; }

function getSupabaseAdmin() {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { userId, userEmail } = body;
  if (!userId || !userEmail) {
    return { statusCode: 400, body: JSON.stringify({ error: "userId and userEmail are required" }) };
  }

  const supabase = getSupabaseAdmin();

  // Verify the user exists in Supabase auth before provisioning
  const { data: { user }, error: authErr } = await supabase.auth.admin.getUserById(userId);
  if (authErr || !user) {
    return { statusCode: 403, body: JSON.stringify({ error: "User not found" }) };
  }

  // Only provision if the user doesn't already have a paid tier
  const { data: existing } = await supabase
    .from("memberships")
    .select("tier")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing && existing.tier !== "free") {
    return { statusCode: 200, body: JSON.stringify({ alreadyProvisioned: true }) };
  }

  const { error } = await supabase.from("memberships").upsert({
    user_id:       userId,
    tier:          "free",
    credits_limit: 3,
    credits_used:  existing?.credits_used ?? 0,
    sites_limit:   0,
    sites_used:    existing?.sites_used ?? 0,
    status:        "active",
    hosting_until: null,
  }, { onConflict: "user_id" });

  if (error) {
    console.error("provisionFreeTier error:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
}
