/**
 * Change how many months an auto-renewing plan buys each cycle.
 *
 * A subscription's block length lives in its price: `recurring.interval_count`. Changing
 * it means putting a different price on the subscription item, computed from the same
 * table checkout uses, so the new cadence and the new amount stay consistent with each
 * other and with what the pricing page displays.
 *
 * PRORATION IS OFF, DELIBERATELY
 *
 * proration_behavior: "none" means the customer is not charged or credited today. They
 * keep everything they already paid for, and the new block length takes effect at the next
 * renewal. Prorating would produce a surprise charge from a screen the customer thinks of
 * as a settings change — the sort of thing that becomes a chargeback rather than a support
 * email.
 *
 * The membership row is NOT updated here. Months are granted when money moves, by the
 * invoice.payment_succeeded handler reading interval_count off the price. Granting on a
 * settings change would hand out months nobody paid for.
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./localEnv.mjs";
import { PLAN_PRICING, planTotalCents } from "../../planPricing.mjs";

// Stripe will not bill a recurring price at more than a yearly interval.
const MAX_RECURRING_MONTHS = 12;

function getSupabaseAdmin() {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const token  = body.authToken;
  const months = Math.floor(Number(body.months));

  if (!token) return json(400, { error: "authToken required" });
  if (!Number.isFinite(months) || months < 1 || months > MAX_RECURRING_MONTHS) {
    return json(400, {
      error: `Choose between 1 and ${MAX_RECURRING_MONTHS} months.`
    });
  }

  const supabase = getSupabaseAdmin();
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return json(403, { error: "Invalid auth token" });

  const { data: membership } = await supabase
    .from("memberships")
    .select("stripe_subscription_id, tier, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership?.stripe_subscription_id) {
    return json(400, {
      error: "You don't have an auto-renewing plan. Buy months up front from the pricing page instead."
    });
  }
  if (!PLAN_PRICING[membership.tier]) {
    return json(400, { error: `Plan ${membership.tier} cannot be changed this way.` });
  }

  const amount = planTotalCents(membership.tier, months);

  try {
    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2024-12-18.acacia" });

    const sub  = await stripe.subscriptions.retrieve(membership.stripe_subscription_id);
    const item = sub.items?.data?.[0];
    if (!item) return json(400, { error: "That subscription has no billable item." });

    const current = item.price?.recurring?.interval === "month"
      ? item.price.recurring.interval_count
      : null;

    if (current === months) {
      return json(200, {
        ok: true, unchanged: true, months,
        message: `Your plan already renews every ${months} month${months !== 1 ? "s" : ""}.`
      });
    }

    // subscriptions.update accepts price_data.product (an id) but NOT product_data — that
    // shorthand exists only on Checkout Sessions, which is why the identical shape works
    // at purchase and fails here with "Did you mean product?".
    //
    // Reusing the subscription's existing product is the first choice: it keeps the
    // customer on what they originally bought and needs no configuration. But Stripe
    // refuses new prices on an ARCHIVED product, and checkout creates a throwaway product
    // per purchase — those get archived over time, at which point reuse fails with
    // "product … is marked as inactive". So the product is verified before use and a
    // replacement is created only when the original cannot serve.
    const plan = PLAN_PRICING[membership.tier];
    let productId = typeof item.price?.product === "string"
      ? item.price.product
      : item.price?.product?.id;

    if (productId) {
      try {
        const product = await stripe.products.retrieve(productId);
        if (!product?.active) {
          console.log(`[modify] product ${productId} is archived — creating a replacement`);
          productId = null;
        }
      } catch (err) {
        console.warn(`[modify] could not read product ${productId}:`, err?.message);
        productId = null;
      }
    }

    if (!productId) {
      const created = await stripe.products.create({
        name: plan.name,
        metadata: { tier: membership.tier, created_by: "modifySubscription" },
      });
      productId = created.id;
    }

    const updated = await stripe.subscriptions.update(membership.stripe_subscription_id, {
      items: [{
        id: item.id,
        price_data: {
          currency:    "usd",
          product:     productId,
          unit_amount: amount,
          recurring:   { interval: "month", interval_count: months },
        },
      }],
      // No charge or credit today. See the note at the top.
      proration_behavior: "none",
      metadata: { ...(sub.metadata || {}), quantity: String(months) },
    });

    const nextRenewal = updated.current_period_end
      ? new Date(updated.current_period_end * 1000).toISOString()
      : null;

    // Keep the displayed period end honest even though no months are granted here.
    if (nextRenewal) {
      await supabase
        .from("memberships")
        .update({ current_period_end: nextRenewal })
        .eq("user_id", user.id);
    }

    console.log(`[modify] ${user.id} ${membership.tier}: ${current ?? "?"} -> ${months} months`);

    return json(200, {
      ok: true,
      months,
      amountCents: amount,
      nextRenewal,
      message: `From your next renewal you'll be billed ${(amount / 100).toFixed(2)} `
             + `every ${months} month${months !== 1 ? "s" : ""}.`
    });
  } catch (err) {
    console.error("[modify] failed:", err?.message);
    return json(500, { error: err?.message || "Could not change your plan. Please try again." });
  }
}
