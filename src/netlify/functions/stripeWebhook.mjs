import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { randomBytes } from "crypto";

// ── Credits / downloads / deploys per unit purchased ─────────────────────────
// 1 unit = 5 credits + 1 download + 1 deploy  (applies to all premium tiers)
const CREDITS_PER_UNIT   = 5;
const DOWNLOADS_PER_UNIT = 1;
const DEPLOYS_PER_UNIT   = 1;

// ── Gift tiers ───────────────────────────────────────────────────────────────
const GIFT_TIERS = new Set(["starter_gift", "pro_gift"]);
const GIFT_TIER_NAMES = { starter_gift: "Starter", pro_gift: "Pro" };

function generateGiftCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars (I/1/O/0)
  const bytes = randomBytes(8);
  return "GIFT-" + Array.from(bytes).map(b => chars[b % chars.length]).join("");
}

async function handleGiftPurchase(obj) {
  const tierKey   = obj.metadata?.tier_key;
  const buyerEmail = obj.customer_details?.email;
  const sessionId  = obj.id;

  if (!buyerEmail) { console.error("Gift purchase missing buyer email"); return; }

  const code = generateGiftCode();
  const supabase = getSupabaseAdmin();

  const { error: dbErr } = await supabase.from("gift_codes").insert({
    code,
    tier: tierKey,
    stripe_session_id: sessionId,
    buyer_email: buyerEmail,
  });
  if (dbErr) { console.error("Failed to store gift code:", dbErr.message); return; }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { console.error("RESEND_API_KEY not set"); return; }

  const resend = new Resend(resendKey);
  const tierName = GIFT_TIER_NAMES[tierKey];

  const { error: emailErr } = await resend.emails.send({
    from: "Irene's Webworks <gifts@emails.irenes-ventures.com>",
    to:   buyerEmail,
    subject: `🎁 Your ${tierName} Gift Code is here — Irene's Webworks`,
    html: buildGiftEmail(code, tierName),
  });

  if (emailErr) console.error("Failed to send gift email:", emailErr.message);
  else console.log(`Gift code ${code} (${tierKey}) emailed to ${buyerEmail}`);
}

function buildGiftEmail(code, tierName) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0b1220;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eaf0ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:14px 14px 0 0;padding:24px 28px;">
          <p style="margin:0;font-size:20px;font-weight:900;letter-spacing:.2px;">Irene's Webworks</p>
          <p style="margin:4px 0 0;color:rgba(234,240,255,.65);font-size:13px;">Professional portfolio websites</p>
        </td></tr>

        <!-- Hero -->
        <tr><td style="background:rgba(78,112,241,.14);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:32px 28px;text-align:center;">
          <p style="margin:0;font-size:36px;">🎁</p>
          <h1 style="margin:12px 0 0;font-size:26px;font-weight:900;line-height:1.1;letter-spacing:-.03em;">Your ${tierName} Gift Code is ready.</h1>
          <p style="margin:14px 0 0;font-size:15px;color:rgba(234,240,255,.78);line-height:1.75;max-width:48ch;margin-left:auto;margin-right:auto;">
            Pass this code along to the lucky person in your life. When they're ready,
            they'll redeem it to get their professionally built portfolio website.
          </p>
        </td></tr>

        <!-- Code block -->
        <tr><td style="background:rgba(0,0,0,.35);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;text-align:center;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(234,240,255,.5);">Gift Code</p>
          <p style="margin:0;font-size:34px;font-weight:900;letter-spacing:.12em;color:#fff;font-family:ui-monospace,monospace;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:14px 22px;display:inline-block;">${code}</p>
          <p style="margin:14px 0 0;font-size:13px;color:rgba(234,240,255,.5);">Valid for 12 months from today</p>
        </td></tr>

        <!-- How to redeem -->
        <tr><td style="background:rgba(255,255,255,.04);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;">
          <p style="margin:0 0 16px;font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:rgba(234,240,255,.55);">How to redeem</p>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="padding:0 0 12px;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;">
                <strong style="color:#fff;">1.</strong> Visit <a href="https://irenes-ventures.com" style="color:#8DE0FF;">irenes-ventures.com</a> and click <strong style="color:#fff;">Redeem a gift code</strong>.
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 12px;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;">
                <strong style="color:#fff;">2.</strong> Enter the code above when prompted. Create a free account to get started.
              </td>
            </tr>
            <tr>
              <td style="padding:0;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;">
                <strong style="color:#fff;">3.</strong> Upload a résumé, describe your goals, pick a style — Irene handles the rest.
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);border-top:none;border-radius:0 0 14px 14px;padding:20px 28px;">
          <p style="margin:0;font-size:13px;color:rgba(234,240,255,.42);line-height:1.7;">
            Questions? Reply to this email or contact
            <a href="mailto:irene@irenes-ventures.com" style="color:#8DE0FF;">irene@irenes-ventures.com</a>.
            Your purchase is covered by our satisfaction guarantee —
            <a href="https://irenes-ventures.com/src/refund_policy.html" style="color:#8DE0FF;">read our refund policy</a>.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Static limits for tiers with a fixed unit count ──────────────────────────
const TIER_LIMITS = {
  basic: { tier: "basic", credits_limit: 5, downloads_limit: 1, deploys_limit: 1 },
  // premium tiers: limits are computed dynamically from quantity (see checkout handler)
  // premium_annual is the exception — unlimited
  premium_annual: { tier: "premium", credits_limit: 120, downloads_limit: -1, deploys_limit: -1 },
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
      deploys_limit:   quantity * DEPLOYS_PER_UNIT,
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

      if (GIFT_TIERS.has(tierKey)) {
        await handleGiftPurchase(obj);
      } else if (tierKey === "basic" || tierKey === "premium_annual") {
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
              deploys_used:    0,
              credits_limit:   qty * CREDITS_PER_UNIT,
              downloads_limit: qty * DOWNLOADS_PER_UNIT,
              deploys_limit:   qty * DEPLOYS_PER_UNIT,
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
              deploys_used:   0,
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
