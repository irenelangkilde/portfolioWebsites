import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// ── Credits / downloads per unit purchased ────────────────────────────────────
// 1 unit = 5 credits + 1 download/deploy  (applies to all premium tiers)
const CREDITS_PER_UNIT   = 5;
const DOWNLOADS_PER_UNIT = 1;

// ── Static limits for tiers with a fixed unit count ──────────────────────────
const TIER_LIMITS = {
  basic: { tier: "basic", credits_limit: 5, downloads_limit: 1 },
  // premium tiers: limits are computed dynamically from quantity (see checkout handler)
  // premium_annual is the exception — unlimited
  premium_annual: { tier: "premium", credits_limit: 120, downloads_limit: -1 },
};

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

async function upgradeMembership(userId, tierKey, extraFields = {}) {
  const limits = TIER_LIMITS[tierKey];
  if (!limits) { console.error("Unknown tierKey:", tierKey); return; }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("memberships")
    .update({
      ...limits,
      status: "active",
      ...extraFields
    })
    .eq("user_id", userId);

  if (error) console.error("Supabase update error:", error.message);
  else       console.log(`Upgraded user ${userId} to ${limits.tier} (${tierKey})`);
}

async function upgradePremiumMonthly(userId, quantity, extraFields = {}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("memberships")
    .update({
      tier:            "premium",
      status:          "active",
      credits_limit:   quantity * CREDITS_PER_UNIT,
      downloads_limit: quantity * DOWNLOADS_PER_UNIT,
      ...extraFields
    })
    .eq("user_id", userId);

  if (error) console.error("Supabase update error:", error.message);
  else       console.log(`Upgraded user ${userId} to premium (${quantity} units)`);
}

async function cancelMembership(userId) {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("memberships")
    .update({ status: "cancelled" })
    .eq("user_id", userId);
  console.log(`Cancelled membership for user ${userId}`);
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const stripeKey        = process.env.STRIPE_SECRET_KEY;
  const webhookSecret    = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return { statusCode: 500, body: "Stripe not configured" };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers["stripe-signature"],
      webhookSecret
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return { statusCode: 400, body: `Webhook error: ${err.message}` };
  }

  const obj = stripeEvent.data.object;

  switch (stripeEvent.type) {

    // ── One-time purchase or first subscription payment completed ─────────
    case "checkout.session.completed": {
      const userId  = obj.metadata?.user_id;
      const tierKey = obj.metadata?.tier_key;
      const qty     = parseInt(obj.metadata?.quantity || "1", 10);
      if (!userId || !tierKey) break;

      const extra = {};
      if (obj.customer)       extra.stripe_customer_id    = obj.customer;
      if (obj.subscription)   extra.stripe_subscription_id = obj.subscription;
      if (obj.payment_intent) extra.stripe_payment_intent  = obj.payment_intent;

      if (obj.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(obj.subscription);
          extra.current_period_end = new Date(sub.current_period_end * 1000).toISOString();

          // premium_monthly_new: user opted out of auto-renewal — cancel at period end
          if (tierKey === "premium_monthly_new") {
            await stripe.subscriptions.update(obj.subscription, { cancel_at_period_end: true });
          }
        } catch {}
      }

      if (tierKey === "basic" || tierKey === "premium_annual") {
        await upgradeMembership(userId, tierKey, extra);
      } else if (tierKey === "premium_monthly_new" || tierKey === "premium_monthly_sub") {
        await upgradePremiumMonthly(userId, qty, extra);
      }
      break;
    }

    // ── Auto-renewing subscription renewed ────────────────────────────────
    case "invoice.payment_succeeded": {
      const subId = obj.subscription;
      if (!subId) break;
      try {
        const sub     = await stripe.subscriptions.retrieve(subId);
        const userId  = sub.metadata?.user_id;
        const tierKey = sub.metadata?.tier_key;
        const qty     = parseInt(sub.metadata?.quantity || "1", 10);
        if (!userId) break;

        const supabase = getSupabaseAdmin();

        if (tierKey === "premium_monthly_sub") {
          // Reset usage and extend period; re-apply graduated limits for the renewed quantity
          await supabase
            .from("memberships")
            .update({
              status:          "active",
              credits_used:    0,
              downloads_used:  0,
              credits_limit:   qty * CREDITS_PER_UNIT,
              downloads_limit: qty * DOWNLOADS_PER_UNIT,
              current_period_end: new Date(sub.current_period_end * 1000).toISOString()
            })
            .eq("user_id", userId);
        } else if (tierKey === "premium_annual") {
          await supabase
            .from("memberships")
            .update({
              status:         "active",
              credits_used:   0,
              downloads_used: 0,
              current_period_end: new Date(sub.current_period_end * 1000).toISOString()
            })
            .eq("user_id", userId);
        }
        console.log(`Renewed subscription for user ${userId} (${tierKey})`);
      } catch (err) {
        console.error("Renewal error:", err.message);
      }
      break;
    }

    // ── Subscription cancelled ─────────────────────────────────────────────
    case "customer.subscription.deleted": {
      const userId = obj.metadata?.user_id;
      if (userId) await cancelMembership(userId);
      break;
    }

    default:
      break;
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
}
