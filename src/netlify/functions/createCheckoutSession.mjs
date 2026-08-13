import Stripe from "stripe";
import { PLAN_PRICING, planTotalCents, ADDON_PRICING } from "../../planPricing.mjs";
import { readFileSync } from "fs";
import { resolve } from "path";
import { resolveReferralCode } from "./referralCodes.mjs";

// Plan tiers drive the subscription interval and go in line_items as recurring prices.
// Add-ons are always rendered as one-time price_data charges so they never conflict
// with the plan's billing interval (e.g. Prime is 4-month, Hosting is monthly).
const PLAN_TIERS  = new Set(["graduate", "prime"]);
const GUEST_TIERS = new Set(["starter_care", "premium_care"]);

// Add-on prices come from the shared table; this alias keeps the call sites below
// readable. unit_amount mirrors ADDON_PRICING[...].cents — one number, one place.
const ADDON_PRICE_DATA = Object.fromEntries(
  Object.entries(ADDON_PRICING).map(([tier, a]) => [tier, { name: a.name, unit_amount: a.cents }])
);

let localEnvCache = null;

function loadLocalEnv() {
  if (localEnvCache) return localEnvCache;
  localEnvCache = {};
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../.env")
  ];
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

function getEnv(name) {
  return process.env[name] || loadLocalEnv()[name] || "";
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { items, tier, userId, userEmail, returnUrl, quantity = 1, autoRenew = false, isGift = false, giftDetails = null,
          referralCode = "", attribution = null } = body;

  // Normalise to items array — backwards-compatible with single-tier callers (form.js, gift pages)
  const cartItems = Array.isArray(items)
    ? items.map(i => ({ tier: String(i.tier), qty: Math.max(1, Number(i.qty) || 1) }))
    : [{ tier: String(tier || ""), qty: Math.max(1, Number(quantity) || 1) }];

  const firstTier = cartItems[0]?.tier;
  const isGuest   = cartItems.every(i => GUEST_TIERS.has(i.tier));

  if (!cartItems.length || cartItems.some(i => !i.tier)) {
    return { statusCode: 400, body: JSON.stringify({ error: "items array with tier required" }) };
  }
  if (!isGuest && (!userId || !userEmail)) {
    return { statusCode: 400, body: JSON.stringify({ error: "userId and userEmail are required" }) };
  }

  // Dashboard price IDs. Plans and add-ons no longer appear here — both are priced from
  // planPricing.mjs — so in practice only starter_care and premium_care are read. The
  // rest are kept because gift and legacy callers still pass those tiers.
  const PRICE_IDS = {
    graduate:      getEnv("STRIPE_PRICE_GRADUATE"),
    prime:         getEnv("STRIPE_PRICE_PRIME"),
    care:          getEnv("STRIPE_PRICE_SUPPORT"),
    hosting:       getEnv("STRIPE_PRICE_HOSTING_ADDON"),
    extra_credits: getEnv("STRIPE_PRICE_EXTRA_CREDITS"),
    starter_care:  getEnv("STRIPE_PRICE_STARTER"),
    premium_care:  getEnv("STRIPE_PRICE_PREMIUM"),
  };


  // The buyer's choice decides the Stripe mode, which is why autoRenew has to be read
  // here — it was previously accepted from the client and then ignored, so the checkbox
  // on the pricing page had no effect and every plan purchase became a subscription.
  const wantsRecurring = !!autoRenew;
  const hasPlan = cartItems.some(i => PLAN_TIERS.has(i.tier));
  const mode = (hasPlan && wantsRecurring) ? "subscription" : "payment";


  // There is deliberately no minimum purchase length. A three-month floor on the
  // one-time Graduate path was tried and removed: it only ever applied to one of the two
  // checkout modes, which meant the same plan had different rules depending on a checkbox,
  // and it had to be enforced in two places that could disagree. Any month count is valid.
  // To reintroduce one, it belongs here — the server is the only authoritative check.

  for (const item of cartItems) {
    // Add-ons and plans are both billed from inline price_data now, so neither needs a
    // dashboard price ID. Only the guest gift tiers still resolve to one.
    //
    // This check used to demand a price ID for plans too. Left as it was, it would have
    // rejected every plan purchase the moment STRIPE_PRICE_GRADUATE_ONCE was unset —
    // a guard outliving the thing it guarded, which is how three ReferenceErrors got
    // into this file.
    if (ADDON_PRICE_DATA[item.tier]) continue;
    if (PLAN_PRICING[item.tier])     continue;
    if (!PRICE_IDS[item.tier]) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `No price configured for tier: ${item.tier}` })
      };
    }
  }

  const stripeKey = getEnv("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Stripe not configured (missing STRIPE_SECRET_KEY)" }) };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

  // Product IDs for add-ons — when set, Stripe uses the product's name/images from the dashboard
  const ADDON_PRODUCT_IDS = {
    hosting:       getEnv("STRIPE_PRODUCT_HOSTING"),
    extra_credits: getEnv("STRIPE_PRODUCT_EXTRA_CREDITS"),
    care:          getEnv("STRIPE_PRODUCT_CARE"),
  };

  const billableItems = cartItems;
  const lineItems = billableItems.map(i => {
    if (ADDON_PRICE_DATA[i.tier]) {
      const pd        = ADDON_PRICE_DATA[i.tier];
      const productId = ADDON_PRODUCT_IDS[i.tier];
      const productSpec = productId
        ? { product: productId }
        : { product_data: { name: pd.name } };
      return {
        price_data: { currency: "usd", ...productSpec, unit_amount: pd.unit_amount },
        quantity: i.qty,
      };
    }
    // Plans are priced HERE, from planPricing.mjs, rather than by a Stripe price ID
    // multiplied by quantity.
    //
    // A dashboard price is a single per-unit number, so Stripe can only ever compute
    // months × rate. That makes a volume discount impossible to charge: the page could
    // show a tiered total while the card was charged the flat one, which is exactly the
    // drift that has already produced three separate wrong-price bugs here. Computing the
    // total from the same table the page reads is what makes the discount real.
    //
    // quantity stays 1 because the amount already covers every month bought — passing
    // months as quantity as well would multiply twice.
    const plan = PLAN_PRICING[i.tier];
    if (plan) {
      const isRecurringPlan = wantsRecurring;
      const months          = isRecurringPlan ? 1 : i.qty;
      const amount          = planTotalCents(i.tier, months);

      return {
        price_data: {
          currency:     "usd",
          product_data: { name: months > 1 ? `${plan.name} — ${months} months` : plan.name },
          unit_amount:  amount,
          // Auto-renew currently repeats a single month. Renewing the whole prepaid block
          // instead is step 3 of this work and lands here as interval_count: months.
          ...(isRecurringPlan ? { recurring: { interval: "month", interval_count: 1 } } : {}),
        },
        quantity: 1,
      };
    }

    // Guest gift tiers (starter_care, premium_care) are still dashboard prices. They are
    // not months of anything, so the tier ladder does not apply and there is nothing to
    // gain from pricing them here.
    return { price: PRICE_IDS[i.tier], quantity: i.qty };
  });

  const origin = returnUrl || "https://yoursite.netlify.app";

  // `quantity` must be the number of months PAID FOR, not the number the buyer typed.
  //
  // Those differ on the recurring path. A subscription line item is quantity 1 — one
  // interval per invoice — so ticking auto-renew with 3 months in the box charges for one
  // month. The raw 3 used to travel in metadata anyway, and both consumers of this field
  // (the webhook and provisionFromSession) read it as months to grant, so the buyer paid
  // for one month and received three, then renewed monthly. That is the mirror of the
  // overcharge bug on the same field: `quantity` meant two different things depending on
  // which side of the checkout you stood on.
  //
  // Normalising here rather than in each consumer is deliberate — there are two of them
  // and they would have to agree forever.
  const firstItem  = cartItems[0];
  const paidMonths = (firstItem && PLAN_TIERS.has(firstItem.tier) && wantsRecurring)
    ? 1
    : (firstItem?.qty || 1);

  const sessionMeta = {
    user_id:    userId || "guest",
    cart:       JSON.stringify(cartItems),
    tier_key:   firstTier,               // legacy field for webhook
    quantity:   String(paidMonths),
    auto_renew: wantsRecurring ? "true" : "false",
    is_gift:    isGift ? "true" : "false",
  };

  if (isGift && giftDetails) {
    if (giftDetails.recipientEmail) sessionMeta.gift_recipient_email = String(giftDetails.recipientEmail).slice(0, 256);
    if (giftDetails.recipientName)  sessionMeta.gift_recipient_name  = String(giftDetails.recipientName).slice(0, 128);
    if (giftDetails.message)        sessionMeta.gift_message         = String(giftDetails.message).slice(0, 500);
  }

  // Attribution travels as metadata so the webhook can record where the sale came from.
  // Values are capped because Stripe allows 500 chars per metadata value and 50 keys,
  // and `cart` already consumes one of them with JSON.
  if (attribution && typeof attribution === "object") {
    const put = (key, value) => {
      const v = String(value ?? "").trim();
      if (v) sessionMeta[key] = v.slice(0, 200);
    };
    put("utm_source",    attribution.utm_source);
    put("utm_medium",    attribution.utm_medium);
    put("utm_campaign",  attribution.utm_campaign);
    put("landing_path",  attribution.landing_path);
    put("referrer_host", attribution.referrer_host);
  }

  // The referral code is re-resolved HERE rather than trusting anything the client sent.
  // validateReferralCode is a convenience for the buyer, not an authorisation step — a
  // tampered request must not be able to apply a discount it was not granted.
  let referral = null;
  if (referralCode) {
    referral = await resolveReferralCode(referralCode, userId || null);
    if (referral.ok) {
      sessionMeta.ref_code          = referral.code;
      sessionMeta.affiliate_code_id = referral.affiliateCodeId;
      sessionMeta.self_referred     = referral.selfReferred ? "true" : "false";
    } else {
      // Record the attempt so a code that never works shows up in the data rather than
      // vanishing. The purchase proceeds at full price.
      sessionMeta.ref_code_rejected = `${referral.code}:${referral.reason}`.slice(0, 200);
      console.log(`[checkout] referral code not applied: ${referral.code} (${referral.reason})`);
    }
  }

  const sessionParams = {
    mode,
    ...(userEmail ? { customer_email: userEmail } : {}),
    line_items: lineItems,
    success_url: `${origin}?checkout=success&tier=${firstTier}&cart=${encodeURIComponent(JSON.stringify(cartItems))}&session_id={CHECKOUT_SESSION_ID}${isGift ? "&is_gift=true" : ""}`,
    cancel_url:  `${origin}?checkout=cancelled`,
    metadata:    sessionMeta,
  };

  // Pre-apply the discount rather than showing Stripe's "Add promotion code" field.
  // Stripe REJECTS a session that sets both `discounts` and `allow_promotion_codes`, so
  // this is an either/or: owning the input is what lets the page explain the code and
  // name a self-referral before payment.
  if (referral?.ok && referral.promotionCodeId) {
    sessionParams.discounts = [{ promotion_code: referral.promotionCodeId }];
  }

  // Keyed off `mode` rather than a separate flag. It was `hasSubscription`, which this
  // still referenced after that variable became `hasPlan` — and the two are no longer
  // the same question: a cart CAN contain a plan and still be a one-time payment when
  // auto-renew is unchecked. Stripe rejects subscription_data on a payment-mode session,
  // so this must follow the mode exactly.
  if (mode === "subscription") {
    sessionParams.subscription_data = { metadata: sessionMeta };
  } else {
    // receipt_email makes Stripe send the payment receipt for this charge regardless of
    // the dashboard's "Successful payments" setting — Stripe documents that this parameter
    // overrides it. Setting it here means receipts do not hinge on a dashboard toggle that
    // is easy to miss and is stored separately for test and live mode.
    //
    // Payment mode only: subscription charges are invoice-driven and take their receipts
    // from Billing settings, where this field has no effect.
    sessionParams.payment_intent_data = {
      metadata: sessionMeta,
      ...(userEmail ? { receipt_email: userEmail } : {}),
    };
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
