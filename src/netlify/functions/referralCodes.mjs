/**
 * Referral-code lookup, shared by validateReferralCode (what the buyer sees before
 * paying) and createCheckoutSession (what actually gets applied).
 *
 * Both must agree. If validation said "10% off" and checkout silently dropped the code,
 * the buyer is charged more than the page promised — so the rule lives here once rather
 * than being written twice.
 */

import { createClient } from "@supabase/supabase-js";

// Self-referral policy. A buyer using their own code gets the discount but earns no
// commission: `self_referred` is recorded on the purchase and the affiliate_conversions
// view excludes it. Flip to true to refuse the code outright at checkout instead — the
// discount would then never apply, at the cost of telling a customer their own code is
// no good.
export const REJECT_SELF_REFERRAL = false;

/**
 * How many discounted purchases one account may make, counting ALL referral codes.
 *
 * Deliberately across every code rather than per code. A per-code limit does nothing
 * against the obvious attack: codes issued as a readable series (LAUNCHME01, LAUNCHME02,
 * …) are trivially enumerable, so a buyer who is refused a second use of one code just
 * guesses the next. Counting per account is what makes the series safe to hand out.
 *
 * This is not a substitute for Stripe's own restrictions — max_redemptions per promotion
 * code and first_time_transaction still matter, and neither of those can be checked here.
 * It closes the case they miss: the same signed-in account reusing discounts.
 *
 * It cannot bind someone who registers a fresh account per purchase. Nothing at this
 * layer can; that needs a per-customer Stripe restriction or payment-instrument checks.
 * Set to 0 to disable the limit entirely.
 */
export const MAX_DISCOUNTED_PURCHASES_PER_USER = 1;

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export function normalizeReferralCode(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * How many completed purchases this account has already made with a referral code.
 *
 * Counts purchase_sources, which the webhook writes on checkout.session.completed — so
 * only paid orders count. An abandoned checkout does not burn the buyer's one discount,
 * which it would if this counted intent instead.
 *
 * Returns null if the count could not be established. Callers treat that as "allow": a
 * database problem must not charge a buyer more than the page just promised them. The
 * validate step tells them "15% off applied" before they commit, and silently dropping
 * the discount at checkout is the one failure this module exists to prevent. The cost of
 * being wrong in this direction is one extra discount; the other direction is a customer
 * charged more than they agreed to.
 */
async function countDiscountedPurchases(supabase, buyerUserId) {
  try {
    const { count, error } = await supabase
      .from("purchase_sources")
      .select("id", { count: "exact", head: true })
      .eq("user_id", buyerUserId)
      .not("ref_code", "is", null);

    if (error) {
      console.error("[referral] redemption count failed:", error.message);
      return null;
    }
    return count ?? 0;
  } catch (err) {
    console.error("[referral] redemption count threw:", err?.message);
    return null;
  }
}

/**
 * Resolve a referral code for a given buyer.
 *
 * Returns a plain object rather than throwing, because every caller wants to degrade
 * gracefully: a bad code must never block a purchase, it just means no discount.
 *
 *   { ok, reason, code, promotionCodeId, discountLabel, affiliateCodeId, selfReferred }
 */
export async function resolveReferralCode(rawCode, buyerUserId = null) {
  const code = normalizeReferralCode(rawCode);
  if (!code) return { ok: false, reason: "empty", code: "" };

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return { ok: false, reason: "unavailable", code };
  }

  const { data, error } = await supabase
    .from("affiliate_codes")
    .select("id, code, owner_user_id, stripe_promotion_code_id, discount_label, active, expires_at")
    .ilike("code", code)
    .maybeSingle();

  if (error) {
    console.error("[referral] lookup failed:", error.message);
    // Treat a database problem as "no discount" rather than failing the sale.
    return { ok: false, reason: "unavailable", code };
  }
  if (!data)          return { ok: false, reason: "not_found", code };
  if (!data.active)   return { ok: false, reason: "inactive",  code };
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { ok: false, reason: "expired", code };
  }

  const selfReferred = !!(buyerUserId && data.owner_user_id && data.owner_user_id === buyerUserId);

  if (selfReferred && REJECT_SELF_REFERRAL) {
    return { ok: false, reason: "self_referral", code, selfReferred: true };
  }

  if (buyerUserId && MAX_DISCOUNTED_PURCHASES_PER_USER > 0) {
    const used = await countDiscountedPurchases(supabase, buyerUserId);
    // null means the check itself failed — see countDiscountedPurchases for why that
    // allows the discount through rather than refusing it.
    if (used !== null && used >= MAX_DISCOUNTED_PURCHASES_PER_USER) {
      return { ok: false, reason: "already_redeemed", code, selfReferred };
    }
  }

  return {
    ok: true,
    reason: "ok",
    code: data.code,
    promotionCodeId: data.stripe_promotion_code_id,
    discountLabel:   data.discount_label || "discount applied",
    affiliateCodeId: data.id,
    selfReferred,
  };
}

/** Buyer-facing wording. Deliberately vague about why a code failed. */
export function referralMessage(result) {
  if (result.ok) {
    return result.selfReferred
      ? `${result.discountLabel} — this is your own code, so it earns no referral credit.`
      : `${result.discountLabel} applied.`;
  }
  switch (result.reason) {
    case "empty":         return "";
    case "expired":       return "That code has expired.";
    case "inactive":      return "That code is no longer active.";
    case "self_referral": return "That is your own referral code — share it with a friend instead.";
    case "already_redeemed":
      return "You've already used a discount code on a previous order, so this one won't apply.";
    case "unavailable":   return "Could not check that code right now — you can still complete your purchase.";
    default:              return "That code was not recognised.";
  }
}
