/**
 * Storage allowance enforcement.
 *
 * The plan cards have promised 10 GB (Graduate) and 100 GB (Prime) for a while with
 * nothing behind them. This is what makes the number true.
 *
 * FAILS OPEN, like the rest of the quota code. If the membership cannot be read, or the
 * column does not exist yet, the upload proceeds. Refusing a paying customer's image
 * because our bookkeeping is unavailable is a worse outcome than one oversized account,
 * and the limits are generous enough that the difference is theoretical.
 *
 * Counts UPLOADED ASSETS only — images, video, PDFs. Published HTML lives in a different
 * store and is kilobytes against a gigabyte allowance; counting it would add a second
 * accounting path for a rounding error.
 */

import { planStorageGb } from "../../planPricing.mjs";

const BYTES_PER_GB = 1024 * 1024 * 1024;

// Tiers with no entry in PLAN_ENTITLEMENTS — free, and anything added later — get this
// rather than zero. planStorageGb returns 0 for an unknown tier, and enforcing that
// literally would refuse a free user's first upload, which is not a limit but a wall.
const DEFAULT_GB = 1;

export function storageLimitBytes(tier) {
  return (planStorageGb(tier) || DEFAULT_GB) * BYTES_PER_GB;
}

export function formatBytes(bytes) {
  if (bytes >= BYTES_PER_GB) return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024)  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * May this user add `incomingBytes`?
 *
 * Returns { allowed, used, limit, tier, reason }. `allowed` is true when the check cannot
 * be performed — see the note above about failing open.
 */
export async function checkStorage(supabase, userId, incomingBytes) {
  if (!supabase || !userId) return { allowed: true };

  let m;
  try {
    const { data, error } = await supabase
      .from("memberships")
      .select("tier, storage_bytes")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    m = data;
  } catch (err) {
    console.warn("[storage] could not read membership:", err?.message);
    return { allowed: true };
  }
  if (!m) return { allowed: true };

  const tier  = m.tier || "free";
  const used  = Number(m.storage_bytes) || 0;
  const limit = storageLimitBytes(tier);

  if (used + incomingBytes <= limit) {
    return { allowed: true, used, limit, tier };
  }

  return {
    allowed: false,
    used,
    limit,
    tier,
    // Does NOT say "delete something": there is no way for a customer to delete an asset,
    // and telling someone to take an action the product does not offer turns a clear limit
    // into a confusing one. Upgrading is the only route back under the line, so that is
    // the only route named.
    reason: `That upload would put you over your ${formatBytes(limit)} storage allowance `
          + `(${formatBytes(used)} already used). A larger plan raises the limit — `
          + `or email irene@irenes-ventures.com and we'll sort it out.`,
  };
}

/** Add newly stored bytes to the running total. Never throws. */
export async function addStorage(supabase, userId, bytes) {
  if (!supabase || !userId || !bytes) return;
  try {
    const { data } = await supabase
      .from("memberships")
      .select("storage_bytes")
      .eq("user_id", userId)
      .maybeSingle();
    const next = (Number(data?.storage_bytes) || 0) + bytes;
    await supabase.from("memberships").update({ storage_bytes: next }).eq("user_id", userId);
  } catch (err) {
    // A miscounted byte is not worth failing an upload that already succeeded.
    console.warn("[storage] could not update total:", err?.message);
  }
}
