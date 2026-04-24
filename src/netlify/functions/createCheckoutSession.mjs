import Stripe from "stripe";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Tier → Stripe Price ID mapping ───────────────────────────────────────────
// After creating products in Stripe dashboard, paste the Price IDs here.
// Stripe dashboard → Products → Add product → copy the "Price ID" (price_xxx)
//
// 1 unit = 5 credits + 1 download/deploy.
// premium_monthly_new / premium_monthly_sub use Stripe graduated pricing;
// the caller passes `quantity` = number of units the user wants to purchase.
const SUBSCRIPTION_TIERS = new Set(["premium_monthly_new", "premium_monthly_sub", "premium_annual", "care"]);
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

  const { tier, userId, userEmail, returnUrl, quantity = 1 } = body;

  const isGuest = GUEST_TIERS.has(tier);
  if (!tier || (!isGuest && (!userId || !userEmail))) {
    return { statusCode: 400, body: JSON.stringify({ error: isGuest ? "tier is required" : "tier, userId, and userEmail are required" }) };
  }

  const PRICE_IDS = {
    basic:               getEnv("STRIPE_PRICE_BASIC"),          // $7 flat, 1 unit
    premium_monthly_new: getEnv("STRIPE_PRICE_PREMIUM_NEW"),    // graduated $19/11/7/5/4/2.95 per unit; subscription, cancel_at_period_end
    premium_monthly_sub: getEnv("STRIPE_PRICE_PREMIUM_SUB"),    // graduated 50% off per unit; auto-renewing subscription (month 2+)
    premium_annual:      getEnv("STRIPE_PRICE_PREMIUM_ANNUAL"), // $99/year; unlimited credits & downloads
    care:                getEnv("STRIPE_PRICE_CARE_PKG"),       // $49/month; support subscription
    starter_gift:        getEnv("STRIPE_PRICE_STARTER_GIFT"),   // $149 one-time; gift purchase, no account required
    pro_gift:            getEnv("STRIPE_PRICE_PRO_GIFT"),       // $299 one-time; gift purchase, no account required
  };

  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown tier: ${tier}` }) };
  }

  const stripeKey = getEnv("STRIPE_SECRET_KEY");
  if (!stripeKey) {
    const required = ["STRIPE_SECRET_KEY", `STRIPE_PRICE_${tier === "basic" ? "BASIC" : tier === "premium_monthly_new" ? "PREMIUM_NEW" : tier === "premium_monthly_sub" ? "PREMIUM_SUB" : "PREMIUM_ANNUAL"}`];
    const missing = required.filter(name => !getEnv(name));
    return { statusCode: 500, body: JSON.stringify({ error: `Stripe not configured (${missing.join(", ") || "missing env"})` }) };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

  const isSubscription = SUBSCRIPTION_TIERS.has(tier);
  const origin = returnUrl || "https://yoursite.netlify.app"; // fallback

  try {
    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? "subscription" : "payment",
      ...(userEmail ? { customer_email: userEmail } : {}),
      line_items: [{ price: priceId, quantity }],
      success_url: `${origin}?checkout=success&tier=${tier}`,
      cancel_url:  `${origin}?checkout=cancelled`,
      metadata: {
        user_id:    userId || "guest",
        tier_key:   tier,
        quantity:   String(quantity),
      },
      ...(isSubscription ? {
        subscription_data: { metadata: { user_id: userId, tier_key: tier, quantity: String(quantity) } }
      } : {
        payment_intent_data: { metadata: { user_id: userId, tier_key: tier, quantity: String(quantity) } }
      })
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
