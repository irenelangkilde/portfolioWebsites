/**
 * POST /.netlify/functions/ensureReferralCode
 * Headers: authorization: Bearer <supabase access token>
 * →        { code, shareUrl }  |  { code: null }
 *
 * The signed-in member's own referral code, minted on first request and returned unchanged
 * thereafter. Called when the pricing page loads for a signed-in user.
 *
 * IDEMPOTENT BY LOOKUP FIRST, THEN BY CONSTRAINT. It selects before it creates, so the
 * normal path costs one query and no Stripe call. The database also carries a partial
 * unique index on (owner_user_id) where kind = 'personal', because two tabs loading at once
 * would both miss the select — and a member with two codes has two sets of earnings that
 * neither the UI nor the payout query would add together.
 *
 * The identity comes from the token, never from a body field. Minting against a claimed
 * user id would let anyone create codes owned by someone else, and codes now earn credits.
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { verifyBuyerFromAuthHeader } from "./referralCodes.mjs";
import { getEnv } from "./localEnv.mjs";

// 15% off, duration "once", no redeem_by, no max_redemptions. Personal codes hang off this
// rather than off the SHAREME coupon (3oqx0N2l), whose redeem_by of 30 Sep 2026 would
// silently kill every member's code that day — a promotion code cannot outlive its coupon.
const MEMBER_REFERRAL_COUPON = getEnv("STRIPE_COUPON_MEMBER_REFERRAL") || "vFYrawXv";

// No I, L, O, U, S or B, and no 0, 1, 5 or 8 — the characters that survive a screen font but
// not handwriting, a phone call, or a photo of a printed card. Matches the alphabet the ten
// hand-minted SHAREME codes used, so every code in circulation reads the same way.
const ALPHABET = "ACDEFGHJKMNPQRTVWXYZ234679";
const SUFFIX_LEN = 5;

function randomSuffix() {
  const bytes = new Uint8Array(SUFFIX_LEN);
  globalThis.crypto.getRandomValues(bytes);
  // Modulo bias across 26 symbols in 256 values is negligible here and the codes are not
  // secrets — they are meant to be shared. Uniqueness is enforced by the database.
  return Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
}

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

const SHARE_ORIGIN = "https://resumeto.website";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const userId = await verifyBuyerFromAuthHeader(
    event.headers?.authorization || event.headers?.Authorization
  );
  if (!userId) {
    return { statusCode: 401, body: JSON.stringify({ error: "Sign in required" }) };
  }

  const ok = (code) => ({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      shareUrl: code ? `${SHARE_ORIGIN}/src/pricing?ref=${encodeURIComponent(code)}` : null,
    }),
  });

  // A member without a code is a missing feature, not a broken page. Every failure below
  // returns { code: null } and the panel simply shows nothing, rather than an error beside
  // their plan details.
  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch { return ok(null); }

  try {
    const { data: existing } = await supabase
      .from("affiliate_codes")
      .select("code")
      .eq("owner_user_id", userId)
      .eq("kind", "personal")
      .maybeSingle();

    if (existing?.code) return ok(existing.code);

    const stripeKey = getEnv("STRIPE_SECRET_KEY");
    if (!stripeKey) return ok(null);
    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    // Three attempts, because a collision is possible (26^5 ≈ 11.9M, so it is rare rather
    // than impossible) and because the losing side of a two-tab race lands here too. On the
    // race, the re-select below finds the winner's code and returns that.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = `SHAREME${randomSuffix()}`;

      let promo;
      try {
        promo = await stripe.promotionCodes.create({
          coupon: MEMBER_REFERRAL_COUPON,
          code,
          // Uncapped on purpose: this limits how many LEADS may use the code, so a cap here
          // would cap the member's sharing, which is the opposite of the incentive. The
          // per-buyer limits live elsewhere — first_time_transaction below, and the app's
          // one-discount-per-account rule.
          restrictions: { first_time_transaction: true },
        });
      } catch (err) {
        // A duplicate code string is the retryable case; anything else will not improve.
        if (/already exists|code.*taken/i.test(err?.message || "")) continue;
        console.error("[referral] Stripe promotion code create failed:", err?.message);
        return ok(null);
      }

      const { data: inserted, error: insErr } = await supabase
        .from("affiliate_codes")
        .insert({
          code,
          owner_user_id:            userId,
          stripe_promotion_code_id: promo.id,
          discount_label:           "15% off",
          kind:                     "personal",
          active:                   true,
        })
        .select("code")
        .maybeSingle();

      if (!insErr && inserted?.code) return ok(inserted.code);

      // 23505 is a unique violation: either the code string collided, or this member already
      // has a personal code because another request won the race. Re-select settles which.
      if (insErr?.code === "23505") {
        const { data: raced } = await supabase
          .from("affiliate_codes")
          .select("code")
          .eq("owner_user_id", userId)
          .eq("kind", "personal")
          .maybeSingle();
        if (raced?.code) return ok(raced.code);
        continue;   // the code string collided, not the owner — try another
      }

      console.error("[referral] could not record personal code:", insErr?.message);
      return ok(null);
    }

    return ok(null);
  } catch (err) {
    console.error("[referral] ensureReferralCode failed:", err?.message);
    return ok(null);
  }
}
