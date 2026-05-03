import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { randomBytes } from "crypto";

// ── Credits / downloads / deploys per unit purchased ─────────────────────────
// 1 unit = 3 credits + 1 download + 1 deploy  (Graduate plan)
const CREDITS_PER_UNIT   = 3;
const DOWNLOADS_PER_UNIT = 1;
const DEPLOYS_PER_UNIT   = 1;

function monthsFromNow(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString();
}

function stackMonths(existingIso, n) {
  if (!n || n <= 0) return undefined;
  const base = existingIso
    ? new Date(Math.max(new Date(existingIso).getTime(), Date.now()))
    : new Date();
  base.setMonth(base.getMonth() + n);
  return base.toISOString();
}

function hostingAddonMonths(cartJson) {
  try {
    const cart = JSON.parse(cartJson || "[]");
    const item = cart.find(i => i.tier === "hosting");
    return item ? Math.max(0, parseInt(item.qty || "0", 10)) : 0;
  } catch { return 0; }
}

function supportAddonMonths(cartJson) {
  try {
    const cart = JSON.parse(cartJson || "[]");
    const item = cart.find(i => i.tier === "care");
    return item ? Math.max(0, parseInt(item.qty || "0", 10)) : 0;
  } catch { return 0; }
}

// ── Gift tiers ───────────────────────────────────────────────────────────────
const GIFT_TIERS      = new Set(["starter_care", "premium_care"]);
const PLAN_GIFT_TIERS = new Set(["graduate", "prime"]);
const GIFT_TIER_NAMES = { starter_care: "Starter", premium_care: "Premium", graduate: "Graduate", prime: "Prime" };

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
    from: "Irene's Webworks <gifts@email.irenes-ventures.com>",
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

async function handlePlanGiftPurchase(obj, tierKey, qty) {
  const recipientEmail = obj.metadata?.gift_recipient_email || null;
  const recipientName  = obj.metadata?.gift_recipient_name  || "";
  const giftMessage    = obj.metadata?.gift_message         || "";
  const buyerEmail     = obj.customer_details?.email || obj.customer_email || null;
  const sessionId      = obj.id;

  console.log(`[handlePlanGiftPurchase] tier=${tierKey} qty=${qty} sessionId=${sessionId} buyerEmail=${buyerEmail} recipientEmail=${recipientEmail}`);

  if (!buyerEmail) { console.error("[handlePlanGiftPurchase] FAIL: missing buyer email — customer_details.email and customer_email both null"); return; }

  const code    = generateGiftCode();
  console.log(`[handlePlanGiftPurchase] generated code=${code}`);

  const supabase = getSupabaseAdmin();

  const sAddon = supportAddonMonths(obj.metadata?.cart);
  const { error: dbErr } = await supabase.from("gift_codes").insert({
    code,
    tier:              tierKey,
    quantity:          qty,
    ...(sAddon > 0 && { support_months: sAddon }),
    stripe_session_id: sessionId,
    buyer_email:       buyerEmail,
    recipient_email:   recipientEmail,
    recipient_name:    recipientName || null,
    gift_message:      giftMessage   || null,
  });
  if (dbErr) { console.error(`[handlePlanGiftPurchase] FAIL: DB insert error: ${dbErr.message} (code=${dbErr.code})`); return; }
  console.log(`[handlePlanGiftPurchase] DB insert OK for sessionId=${sessionId}`);

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) { console.error("[handlePlanGiftPurchase] FAIL: RESEND_API_KEY not set — code stored but email not sent"); return; }

  const resend   = new Resend(resendKey);
  const tierName = GIFT_TIER_NAMES[tierKey] || tierKey;
  const toEmail  = recipientEmail || buyerEmail;

  if (!toEmail) { console.error("[handlePlanGiftPurchase] FAIL: no email address to send to"); return; }

  const { error: emailErr } = await resend.emails.send({
    from:    "Irene's Webworks <gifts@email.irenes-ventures.com>",
    to:      toEmail,
    subject: `🎁 You've received a ${tierName} plan gift — Irene's Webworks`,
    html:    buildPlanGiftEmail(code, tierName, qty, tierKey, recipientName, giftMessage),
  });

  if (emailErr) console.error(`[handlePlanGiftPurchase] email FAIL: ${emailErr.message}`);
  else          console.log(`[handlePlanGiftPurchase] email OK: code=${code} (${tierKey} ×${qty}) sent to ${toEmail}`);
}

function buildPlanGiftEmail(code, tierName, qty, tierKey, recipientName, giftMessage) {
  const creditsTotal   = tierKey === "graduate" ? qty * CREDITS_PER_UNIT   : 10;
  const downloadsTotal = tierKey === "graduate" ? qty * DOWNLOADS_PER_UNIT : 5;
  const hostingMonths  = tierKey === "graduate" ? qty : 4;

  const greeting     = recipientName ? `Hi ${recipientName},` : "You've received a gift!";
  const messageBlock = giftMessage
    ? `<tr><td style="padding:20px 28px;background:rgba(78,112,241,.07);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);border-bottom:1px solid rgba(255,255,255,.08);">
        <p style="margin:0;font-size:15px;color:rgba(234,240,255,.82);line-height:1.8;font-style:italic;">"${giftMessage}"</p>
       </td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0b1220;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eaf0ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:14px 14px 0 0;padding:24px 28px;">
          <p style="margin:0;font-size:20px;font-weight:900;letter-spacing:.2px;">Irene's Webworks</p>
          <p style="margin:4px 0 0;color:rgba(234,240,255,.65);font-size:13px;">Professional portfolio websites</p>
        </td></tr>
        <tr><td style="background:rgba(78,112,241,.14);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:32px 28px;text-align:center;">
          <p style="margin:0;font-size:36px;">🎁</p>
          <h1 style="margin:12px 0 0;font-size:26px;font-weight:900;line-height:1.1;letter-spacing:-.03em;">${greeting}</h1>
          <p style="margin:10px 0 0;font-size:17px;font-weight:800;color:#fff;">You've been gifted a ${tierName} plan.</p>
          <p style="margin:10px 0 0;font-size:15px;color:rgba(234,240,255,.78);line-height:1.75;max-width:48ch;margin-left:auto;margin-right:auto;">
            Redeem the code below to get your professionally built portfolio website.
          </p>
        </td></tr>
        ${messageBlock}
        <tr><td style="background:rgba(0,0,0,.35);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;text-align:center;">
          <p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(234,240,255,.5);">Your Gift Code</p>
          <p style="margin:0;font-size:34px;font-weight:900;letter-spacing:.12em;color:#fff;font-family:ui-monospace,monospace;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:14px 22px;display:inline-block;">${code}</p>
          <p style="margin:14px 0 0;font-size:13px;color:rgba(234,240,255,.5);">Valid for 12 months from today</p>
        </td></tr>
        <tr><td style="background:rgba(255,255,255,.04);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;">
          <p style="margin:0 0 16px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(234,240,255,.45);">What's included</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:10px 14px;background:rgba(255,255,255,.05);border-radius:8px 8px 0 0;border:1px solid rgba(255,255,255,.08);font-size:14px;color:rgba(234,240,255,.8);">
              🎨 &nbsp;<strong>${creditsTotal} AI generation credits</strong>
            </td></tr>
            <tr><td style="padding:10px 14px;background:rgba(255,255,255,.05);border-top:none;border:1px solid rgba(255,255,255,.08);font-size:14px;color:rgba(234,240,255,.8);">
              🌐 &nbsp;<strong>${downloadsTotal} portfolio site${downloadsTotal !== 1 ? "s" : ""}</strong>
            </td></tr>
            <tr><td style="padding:10px 14px;background:rgba(255,255,255,.05);border-top:none;border-radius:0 0 8px 8px;border:1px solid rgba(255,255,255,.08);font-size:14px;color:rgba(234,240,255,.8);">
              🗓 &nbsp;<strong>${hostingMonths} month${hostingMonths !== 1 ? "s" : ""} of hosting</strong>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background:rgba(255,255,255,.04);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;">
          <p style="margin:0 0 16px;font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:rgba(234,240,255,.55);">How to redeem</p>
          <table cellpadding="0" cellspacing="0" width="100%">
            <tr><td style="padding:0 0 12px;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;">
              <strong style="color:#fff;">1.</strong> Visit <a href="https://irenes-ventures.com" style="color:#8DE0FF;">irenes-ventures.com</a> and click <strong style="color:#fff;">Redeem a gift code</strong>.
            </td></tr>
            <tr><td style="padding:0 0 12px;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;">
              <strong style="color:#fff;">2.</strong> Enter the code above when prompted. Create a free account if you don't have one yet.
            </td></tr>
            <tr><td style="padding:0;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;">
              <strong style="color:#fff;">3.</strong> Upload a résumé, describe your goals, pick a style — Irene handles the rest.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="background:rgba(255,255,255,.04);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;text-align:center;">
          <a href="https://irenes-ventures.com/src/overview.html"
             style="display:inline-block;padding:14px 28px;background:rgba(78,112,241,.55);border:1px solid rgba(78,112,241,.7);border-radius:12px;color:#eaf0ff;font-weight:900;font-size:15px;text-decoration:none;letter-spacing:.02em;">
            Get Started →
          </a>
        </td></tr>
        <tr><td style="background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);border-top:none;border-radius:0 0 14px 14px;padding:20px 28px;text-align:center;">
          <p style="margin:0;font-size:13px;color:rgba(234,240,255,.42);line-height:1.7;">
            Questions? Reply to this email or contact <a href="mailto:irene@irenes-ventures.com" style="color:#8DE0FF;">irene@irenes-ventures.com</a>.
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
  free:    { tier: "free",    credits_limit: 3,  downloads_limit: 0 },
  // graduate: limits computed dynamically from quantity (see upgradeGraduate)
  // prime: 4-month hosting, 10 credits, 5 sites
  prime: { tier: "prime", credits_limit: 10, downloads_limit: 5 },
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
    .upsert({
      user_id:        userId,
      ...limits,
      status:         "active",
      credits_used:   0,
      downloads_used: 0,
      ...extraFields
    }, { onConflict: "user_id" });

  if (error) console.error("Supabase upsert error:", error.message);
  else       console.log(`Upgraded user ${userId} to ${limits.tier} (${tierKey})`);
}

async function upgradeGraduate(userId, quantity, extraFields = {}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("memberships")
    .upsert({
      user_id:        userId,
      tier:           "graduate",
      status:         "active",
      credits_used:   0,
      downloads_used: 0,
      credits_limit:  quantity * CREDITS_PER_UNIT,
      downloads_limit: quantity * DOWNLOADS_PER_UNIT,
      ...extraFields
    }, { onConflict: "user_id" });

  if (error) console.error("Supabase upsert error:", error.message);
  else       console.log(`Upgraded user ${userId} to graduate (${quantity} units)`);
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
        } catch {}
      }

      const hAddon = hostingAddonMonths(obj.metadata?.cart);
      const sAddon = supportAddonMonths(obj.metadata?.cart);

      if (GIFT_TIERS.has(tierKey)) {
        await handleGiftPurchase(obj);
      } else if (obj.metadata?.is_gift === "true" && PLAN_GIFT_TIERS.has(tierKey)) {
        await handlePlanGiftPurchase(obj, tierKey, qty);
      } else {
        // Read existing membership so hosting/support stack rather than reset
        const supabase = getSupabaseAdmin();
        const { data: existing } = await supabase
          .from("memberships")
          .select("hosting_until, support_until")
          .eq("user_id", userId)
          .maybeSingle();

        if (sAddon > 0) extra.support_until = stackMonths(existing?.support_until, sAddon);

        if (tierKey === "free" || tierKey === "prime") {
          if (tierKey === "prime") extra.hosting_until = stackMonths(existing?.hosting_until, 4 + hAddon);
          await upgradeMembership(userId, tierKey, extra);
        } else if (tierKey === "graduate") {
          extra.hosting_until = stackMonths(existing?.hosting_until, qty + hAddon);
          await upgradeGraduate(userId, qty, extra);
        }
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
        const { data: existing } = await supabase
          .from("memberships")
          .select("hosting_until")
          .eq("user_id", userId)
          .maybeSingle();

        if (tierKey === "graduate") {
          await supabase
            .from("memberships")
            .update({
              status:             "active",
              credits_used:       0,
              downloads_used:     0,
              credits_limit:      qty * CREDITS_PER_UNIT,
              downloads_limit:    qty * DOWNLOADS_PER_UNIT,
              hosting_until:      stackMonths(existing?.hosting_until, qty),
              current_period_end: new Date(sub.current_period_end * 1000).toISOString()
            })
            .eq("user_id", userId);
        } else if (tierKey === "prime") {
          await supabase
            .from("memberships")
            .update({
              status:             "active",
              credits_used:       0,
              downloads_used:     0,
              hosting_until:      stackMonths(existing?.hosting_until, 4),
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
