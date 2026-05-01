import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const token = (event.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: "Authorization required" }) };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Stripe not configured" }) };
  }

  const supabase = getSupabaseAdmin();

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid or expired token" }) };
  }

  const { data: membership, error: dbErr } = await supabase
    .from("memberships")
    .select("stripe_subscription_id, tier, status")
    .eq("user_id", user.id)
    .single();

  if (dbErr || !membership) {
    return { statusCode: 404, body: JSON.stringify({ error: "No membership found" }) };
  }

  if (!membership.stripe_subscription_id) {
    return { statusCode: 400, body: JSON.stringify({ error: "No active subscription to cancel" }) };
  }

  if (membership.status === "cancelled" || membership.status === "cancelling") {
    return { statusCode: 400, body: JSON.stringify({ error: "Subscription is already cancelled or pending cancellation" }) };
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

  try {
    const sub = await stripe.subscriptions.update(membership.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    await supabase
      .from("memberships")
      .update({ status: "cancelling" })
      .eq("user_id", user.id);

    const endsAt = new Date(sub.current_period_end * 1000).toISOString();
    console.log(`Scheduled cancellation for user ${user.id} (${membership.tier}), ends ${endsAt}`);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, ends_at: endsAt }),
    };
  } catch (err) {
    console.error("Cancel subscription error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
