/**
 * Delete an uploaded asset and give the customer their storage back.
 *
 * Enforcing a storage limit without offering a way below it leaves upgrading as the only
 * escape, which makes the limit feel like a sales tactic rather than a constraint. This is
 * the other half.
 *
 * OWNERSHIP IS STRUCTURAL, NOT CHECKED
 *
 * Keys are `${user.id}/${assetName}`, so the key is rebuilt from the authenticated user's
 * id and the asset name — the caller never supplies an owner. A request naming somebody
 * else's asset simply builds a key inside its own namespace and finds nothing. There is no
 * comparison to get wrong.
 *
 * THE SIZE COMES FROM THE STORED BYTES
 *
 * The counter must be decremented by exactly what was added. Rather than trusting the
 * size_bytes metadata written at upload, the stored base64 is decoded and measured — the
 * same computation the upload path used. Metadata could be absent on anything uploaded
 * before it was recorded, and the local blob shim does not implement getMetadata at all.
 */

import { createClient } from "@supabase/supabase-js";
import { getPortfolioAssetsStore, explainBlobStoreError } from "./blobStore.mjs";

const json = (statusCode, payload) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const supabase = getSupabaseAdmin();
  if (!supabase) return json(500, { error: "Supabase admin environment is not configured." });

  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!accessToken) return json(401, { error: "Missing bearer token." });

  const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
  const user = authData?.user;
  if (authError || !user) return json(401, { error: "Invalid or expired session." });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body." }); }

  // Only the leaf name is accepted. A name containing a slash could otherwise climb out of
  // the user's namespace and address another account's asset.
  const assetName = String(body.asset || "").trim();
  if (!assetName || assetName.includes("/") || assetName.includes("..")) {
    return json(400, { error: "A valid asset name is required." });
  }

  const { store, configError } = getPortfolioAssetsStore();
  if (!store) return json(500, { error: configError });

  const key = `${user.id}/${assetName}`;

  let freedBytes = 0;
  try {
    const stored = await store.get(key);
    if (!stored) return json(404, { error: "That file no longer exists." });
    freedBytes = Buffer.from(stored, "base64").length;
  } catch (err) {
    return json(500, { error: explainBlobStoreError(err) });
  }

  try {
    await store.delete(key);
  } catch (err) {
    return json(500, { error: explainBlobStoreError(err) });
  }

  // Decremented only after the blob is actually gone, and floored at zero: a counter that
  // can go negative would hand out storage nobody paid for, and any drift should err
  // toward charging the customer for space they are using rather than the reverse.
  try {
    const { data } = await supabase
      .from("memberships")
      .select("storage_bytes")
      .eq("user_id", user.id)
      .maybeSingle();
    const next = Math.max(0, (Number(data?.storage_bytes) || 0) - freedBytes);
    await supabase.from("memberships").update({ storage_bytes: next }).eq("user_id", user.id);
    console.log(`[asset] deleted ${key}, freed ${freedBytes} bytes, total now ${next}`);
  } catch (err) {
    // The file is gone either way. A miscounted byte is not worth reporting a failure for
    // an operation that succeeded.
    console.warn("[asset] could not update storage total:", err?.message);
  }

  return json(200, { ok: true, freedBytes });
}
