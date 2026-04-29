import Stripe from "stripe";
import { readFileSync } from "fs";
import { resolve } from "path";

// Subscription tiers → recurring Stripe prices; one-time tiers → payment mode or add_invoice_items
const SUBSCRIPTION_TIERS = new Set(["premium_monthly_new", "premium_monthly_sub", "premium_annual", "care", "hosting"]);
const GUEST_TIERS        = new Set(["starter_gift", "pro_gift"]);

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

  const { items, tier, userId, userEmail, returnUrl, quantity = 1 } = body;

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
    basic:               getEnv("STRIPE_PRICE_BASIC"),
    premium_monthly_new: getEnv("STRIPE_PRICE_PREMIUM_NEW"),
    premium_monthly_sub: getEnv("STRIPE_PRICE_PREMIUM_SUB"),
    premium_annual:      getEnv("STRIPE_PRICE_PREMIUM_ANNUAL"),
    care:                getEnv("STRIPE_PRICE_CARE_PKG"),
    hosting:             getEnv("STRIPE_PRICE_HOSTING"),
    extra_credits:       getEnv("STRIPE_PRICE_EXTRA_CREDITS"),
    starter_gift:        getEnv("STRIPE_PRICE_STARTER_GIFT"),
    pro_gift:            getEnv("STRIPE_PRICE_PRO_GIFT"),
  };

  for (const item of cartItems) {
    if (!PRICE_IDS[item.tier]) {
      return { statusCode: 400, body: JSON.stringify({ error: `Unknown or unconfigured tier: ${item.tier}` }) };
    }
  }

  const stripeKey = getEnv("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Stripe not configured (missing STRIPE_SECRET_KEY)" }) };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

  // When the cart has any subscription, use subscription mode.
  // Recurring items → line_items; one-time items → subscription_data.add_invoice_items.
  // When all items are one-time, use payment mode.
  const hasSubscription = cartItems.some(i => SUBSCRIPTION_TIERS.has(i.tier));
  const mode = hasSubscription ? "subscription" : "payment";

  const subItems  = cartItems.filter(i =>  SUBSCRIPTION_TIERS.has(i.tier));
  const onetItems = cartItems.filter(i => !SUBSCRIPTION_TIERS.has(i.tier) && !GUEST_TIERS.has(i.tier));
  const lineItems = (hasSubscription ? subItems : cartItems)
    .map(i => ({ price: PRICE_IDS[i.tier], quantity: i.qty }));

  const origin = returnUrl || "https://yoursite.netlify.app";
  const sessionMeta = {
    user_id:  userId || "guest",
    cart:     JSON.stringify(cartItems),
    tier_key: firstTier,               // legacy field for webhook
    quantity: String(cartItems[0]?.qty || 1),
  };

  const sessionParams = {
    mode,
    ...(userEmail ? { customer_email: userEmail } : {}),
    line_items: lineItems,
    success_url: `${origin}?checkout=success&tier=${firstTier}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${origin}?checkout=cancelled`,
    metadata:    sessionMeta,
  };

  if (hasSubscription) {
    sessionParams.subscription_data = {
      metadata: sessionMeta,
      ...(onetItems.length ? {
        add_invoice_items: onetItems.map(i => ({ price: PRICE_IDS[i.tier], quantity: i.qty }))
      } : {})
    };
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
