import Stripe from "stripe";
import { readFileSync } from "fs";
import { resolve } from "path";

// Plan tiers drive the subscription interval and go in line_items as recurring prices.
// Add-ons are always rendered as one-time price_data charges so they never conflict
// with the plan's billing interval (e.g. Prime is 4-month, Hosting is monthly).
const PLAN_TIERS  = new Set(["graduate", "prime"]);
const GUEST_TIERS = new Set(["starter_care", "premium_care"]);

const ADDON_PRICE_DATA = {
  hosting:       { name: "Hosting (per month)",  unit_amount: 900  },
  extra_credits: { name: "Extra Credits",         unit_amount: 500  },
  care:          { name: "Support (per month)",   unit_amount: 4900 },
};

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

  const { items, tier, userId, userEmail, returnUrl, quantity = 1, autoRenew = false, isGift = false, giftDetails = null } = body;

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

  const PRICE_IDS = {
    free:          getEnv("STRIPE_PRICE_BASIC"),
    graduate:      getEnv("STRIPE_PRICE_GRADUATE"),
    prime:         getEnv("STRIPE_PRICE_PRIME"),
    care:          getEnv("STRIPE_PRICE_CARE_PKG"),
    hosting:       getEnv("STRIPE_PRICE_HOSTING_ADDON"),
    extra_credits: getEnv("STRIPE_PRICE_EXTRA_CREDITS"),
    starter_care:  getEnv("STRIPE_PRICE_STARTER"),
    premium_care:      getEnv("STRIPE_PRICE_PREMIUM"),
  };

  // Plan tiers → subscription mode, recurring price IDs in line_items.
  // Add-ons → inline price_data (one-time) so they never conflict with the plan interval.
  // No plan → payment mode; standalone add-ons still use one-time inline price_data.
  const hasSubscription = cartItems.some(i => PLAN_TIERS.has(i.tier));
  const mode = hasSubscription ? "subscription" : "payment";

  for (const item of cartItems) {
    // Add-on tiers are billed via inline price_data — no dashboard price ID required.
    if (ADDON_PRICE_DATA[item.tier]) continue;
    if (!PRICE_IDS[item.tier]) {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown or unconfigured tier: ${item.tier}` }) };
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
    return { price: PRICE_IDS[i.tier], quantity: i.qty };
  });

  const origin = returnUrl || "https://yoursite.netlify.app";
  const sessionMeta = {
    user_id:  userId || "guest",
    cart:     JSON.stringify(cartItems),
    tier_key: firstTier,               // legacy field for webhook
    quantity: String(cartItems[0]?.qty || 1),
    is_gift:  isGift ? "true" : "false",
  };

  if (isGift && giftDetails) {
    if (giftDetails.recipientEmail) sessionMeta.gift_recipient_email = String(giftDetails.recipientEmail).slice(0, 256);
    if (giftDetails.recipientName)  sessionMeta.gift_recipient_name  = String(giftDetails.recipientName).slice(0, 128);
    if (giftDetails.message)        sessionMeta.gift_message         = String(giftDetails.message).slice(0, 500);
  }

  const sessionParams = {
    mode,
    ...(userEmail ? { customer_email: userEmail } : {}),
    line_items: lineItems,
    success_url: `${origin}?checkout=success&tier=${firstTier}&cart=${encodeURIComponent(JSON.stringify(cartItems))}&session_id={CHECKOUT_SESSION_ID}${isGift ? "&is_gift=true" : ""}`,
    cancel_url:  `${origin}?checkout=cancelled`,
    metadata:    sessionMeta,
  };

  if (hasSubscription) {
    sessionParams.subscription_data = { metadata: sessionMeta };
  } else {
    sessionParams.payment_intent_data = { metadata: sessionMeta };
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
