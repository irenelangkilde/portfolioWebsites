import Stripe from "stripe";

// ── Tier → Stripe Price ID mapping ───────────────────────────────────────────
// After creating products in Stripe dashboard, paste the Price IDs here.
// Stripe dashboard → Products → Add product → copy the "Price ID" (price_xxx)
//
// 1 unit = 5 credits + 1 download/deploy.
// premium_monthly_new / premium_monthly_sub use Stripe graduated pricing;
// the caller passes `quantity` = number of units the user wants to purchase.
const PRICE_IDS = {
  basic:               process.env.STRIPE_PRICE_BASIC,          // $7 flat, 1 unit
  premium_monthly_new: process.env.STRIPE_PRICE_PREMIUM_NEW,    // graduated $19/11/7/5/4/2.95 per unit; subscription, cancel_at_period_end
  premium_monthly_sub: process.env.STRIPE_PRICE_PREMIUM_SUB,    // graduated 50% off per unit; auto-renewing subscription (month 2+)
  premium_annual:      process.env.STRIPE_PRICE_PREMIUM_ANNUAL, // $99/year; unlimited credits & downloads
};

const SUBSCRIPTION_TIERS = new Set(["premium_monthly_new", "premium_monthly_sub", "premium_annual"]);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { tier, userId, userEmail, returnUrl, quantity = 1 } = body;

  if (!tier || !userId || !userEmail) {
    return { statusCode: 400, body: JSON.stringify({ error: "tier, userId, and userEmail are required" }) };
  }

  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown tier: ${tier}` }) };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Stripe not configured" }) };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

  const isSubscription = SUBSCRIPTION_TIERS.has(tier);
  const origin = returnUrl || "https://yoursite.netlify.app"; // fallback

  try {
    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? "subscription" : "payment",
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity }],
      success_url: `${origin}?checkout=success&tier=${tier}`,
      cancel_url:  `${origin}?checkout=cancelled`,
      metadata: {
        user_id:    userId,
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
