/**
 * POST /.netlify/functions/validateReferralCode
 * Body: { code, userId? }
 * →     { valid, message, discountLabel?, selfReferred?, discount? }
 *
 * Lets the pricing page confirm a code before the buyer commits, which is the whole
 * point of owning the input rather than using Stripe's promo field: the wording is ours
 * and a self-referral can be named as such up front.
 *
 * Never returns the Stripe promotion-code id — the client has no use for it, and
 * createCheckoutSession re-resolves the code server-side anyway, so a tampered client
 * cannot apply a discount it was not granted.
 */

import { resolveReferralCode, referralMessage, fetchStripeDiscount } from "./referralCodes.mjs";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const result = await resolveReferralCode(body.code, body.userId || null);

  // The arithmetic the page needs to show a discounted total, read from Stripe rather than
  // parsed out of discount_label. Only fetched for a code that resolved, so a mistyped code
  // costs no Stripe call. Null is fine — the page then names the discount without restating
  // the total, which is honest rather than wrong.
  const discount = result.ok ? await fetchStripeDiscount(result.promotionCodeId) : null;

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      valid:         result.ok,
      message:       referralMessage(result),
      code:          result.code,
      discountLabel: result.ok ? result.discountLabel : null,
      selfReferred:  !!result.selfReferred,
      discount,
    }),
  };
}
