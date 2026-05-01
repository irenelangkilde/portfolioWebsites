import Stripe from "stripe";
import { readFileSync } from "fs";
import { resolve } from "path";

// Subscription tiers → recurring Stripe prices; one-time tiers → payment mode or add_invoice_items
const SUBSCRIPTION_TIERS = new Set(["graduate", "prime", "care", "hosting"]);
const GUEST_TIERS        = new Set(["starter_care", "premium_care"]);

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

  const { items, tier, userId, userEmail, returnUrl, quantity = 1, autoRenew = false } = body;

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
  // Both recurring and one-time items go in line_items; Stripe bills one-time items on the first invoice.
  // When all items are one-time, use payment mode.
  const hasSubscription = cartItems.some(i => SUBSCRIPTION_TIERS.has(i.tier));
  const mode = hasSubscription ? "subscription" : "payment";

  const billableItems = cartItems.filter(i => !GUEST_TIERS.has(i.tier));
  const lineItems = billableItems.map(i => ({ price: PRICE_IDS[i.tier], quantity: i.qty }));

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
