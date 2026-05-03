import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { Resend } from "resend";

const CREDITS_PER_UNIT  = 3;
const DOWNLOADS_PER_UNIT = 1;

function getEnv(n) { return process.env[n] || ""; }

function getSupabaseAdmin() {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

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

const GIFT_TIER_NAMES = { graduate: "Graduate", prime: "Prime" };

function buildPlanGiftEmail(code, tierName, qty, tierKey, recipientName, giftMessage) {
  const creditsTotal   = tierKey === "graduate" ? qty * CREDITS_PER_UNIT   : 10;
  const downloadsTotal = tierKey === "graduate" ? qty * DOWNLOADS_PER_UNIT : 5;
  const hostingMonths  = tierKey === "graduate" ? qty : 4;
  const greeting       = recipientName ? `Hi ${recipientName},` : "You've received a gift!";
  const messageBlock   = giftMessage
    ? `<tr><td style="padding:20px 28px;background:rgba(78,112,241,.07);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);border-bottom:1px solid rgba(255,255,255,.08);">
        <p style="margin:0;font-size:15px;color:rgba(234,240,255,.82);line-height:1.8;font-style:italic;">"${giftMessage}"</p>
       </td></tr>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0b1220;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eaf0ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 16px;">
    <tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:14px 14px 0 0;padding:24px 28px;">
        <p style="margin:0;font-size:20px;font-weight:900;">Irene's Webworks</p>
        <p style="margin:4px 0 0;color:rgba(234,240,255,.65);font-size:13px;">Professional portfolio websites</p>
      </td></tr>
      <tr><td style="background:rgba(78,112,241,.14);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:32px 28px;text-align:center;">
        <p style="margin:0;font-size:36px;">🎁</p>
        <h1 style="margin:12px 0 0;font-size:26px;font-weight:900;line-height:1.1;letter-spacing:-.03em;">${greeting}</h1>
        <p style="margin:10px 0 0;font-size:17px;font-weight:800;color:#fff;">You've been gifted a ${tierName} plan.</p>
        <p style="margin:10px 0 0;font-size:15px;color:rgba(234,240,255,.78);line-height:1.75;max-width:48ch;margin-left:auto;margin-right:auto;">Redeem the code below to get your professionally built portfolio website.</p>
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
          <tr><td style="padding:10px 14px;background:rgba(255,255,255,.05);border-radius:8px 8px 0 0;border:1px solid rgba(255,255,255,.08);font-size:14px;color:rgba(234,240,255,.8);">🎨 &nbsp;<strong>${creditsTotal} AI generation credits</strong></td></tr>
          <tr><td style="padding:10px 14px;background:rgba(255,255,255,.05);border-top:none;border:1px solid rgba(255,255,255,.08);font-size:14px;color:rgba(234,240,255,.8);">🌐 &nbsp;<strong>${downloadsTotal} portfolio site${downloadsTotal !== 1 ? "s" : ""}</strong></td></tr>
          <tr><td style="padding:10px 14px;background:rgba(255,255,255,.05);border-top:none;border-radius:0 0 8px 8px;border:1px solid rgba(255,255,255,.08);font-size:14px;color:rgba(234,240,255,.8);">🗓 &nbsp;<strong>${hostingMonths} month${hostingMonths !== 1 ? "s" : ""} of hosting</strong></td></tr>
        </table>
      </td></tr>
      <tr><td style="background:rgba(255,255,255,.04);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;text-align:center;">
        <a href="https://irenes-ventures.com/src/overview.html" style="display:inline-block;padding:14px 28px;background:rgba(78,112,241,.55);border:1px solid rgba(78,112,241,.7);border-radius:12px;color:#eaf0ff;font-weight:900;font-size:15px;text-decoration:none;">Get Started →</a>
      </td></tr>
      <tr><td style="background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);border-top:none;border-radius:0 0 14px 14px;padding:20px 28px;text-align:center;">
        <p style="margin:0;font-size:13px;color:rgba(234,240,255,.42);line-height:1.7;">Questions? <a href="mailto:irene@irenes-ventures.com" style="color:#8DE0FF;">irene@irenes-ventures.com</a></p>
      </td></tr>
    </table></td></tr>
  </table>
</body></html>`;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { sessionId, authToken } = body;
  if (!sessionId || !authToken) {
    return { statusCode: 400, body: JSON.stringify({ error: "sessionId and authToken required" }) };
  }

  // Verify the caller's Supabase session
  const supabase = getSupabaseAdmin();
  const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken);
  if (authErr || !user) {
    return { statusCode: 403, body: JSON.stringify({ error: "Invalid auth token" }) };
  }

  // Fetch the Stripe session
  const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2024-12-18.acacia" });
  let session;
  try { session = await stripe.checkout.sessions.retrieve(sessionId); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid session ID" }) }; }

  // Confirm this session belongs to the authenticated user
  if (session.metadata?.user_id !== user.id) {
    return { statusCode: 403, body: JSON.stringify({ error: "Session does not belong to this user" }) };
  }

  if (session.payment_status !== "paid") {
    return { statusCode: 400, body: JSON.stringify({ error: "Payment not complete" }) };
  }

  const tierKey = session.metadata?.tier_key;
  const qty     = Math.max(1, parseInt(session.metadata?.quantity || "1", 10));

  if (!tierKey || tierKey === "free") {
    return { statusCode: 400, body: JSON.stringify({ error: "No paid tier in session" }) };
  }

  if (session.metadata?.is_gift === "true") {
    const giftTierKey = session.metadata?.tier_key;
    const giftQty     = Math.max(1, parseInt(session.metadata?.quantity || "1", 10));

    if (giftTierKey !== "graduate" && giftTierKey !== "prime") {
      return { statusCode: 200, body: JSON.stringify({ ok: true, isGift: true, skipped: "non-plan gift" }) };
    }

    // Return the code if the webhook already stored it
    const { data: existing } = await supabase
      .from("gift_codes")
      .select("code")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();

    if (existing?.code) {
      console.log(`provisionFromSession: gift code already exists for session ${sessionId}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, isGift: true, giftCode: existing.code }) };
    }

    // Webhook hasn't fired yet — generate the code here as a fallback
    const chars    = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code     = "GIFT-" + Array.from(randomBytes(8)).map(b => chars[b % chars.length]).join("");
    const buyerEmail = session.customer_details?.email || session.customer_email || user.email || null;

    console.log(`provisionFromSession: generating fallback gift code ${code} for ${giftTierKey} session ${sessionId}`);

    const { error: insertErr } = await supabase.from("gift_codes").insert({
      code,
      tier:              giftTierKey,
      quantity:          giftQty,
      stripe_session_id: sessionId,
      buyer_email:       buyerEmail || "",
      recipient_email:   session.metadata?.gift_recipient_email || null,
      recipient_name:    session.metadata?.gift_recipient_name  || null,
      gift_message:      session.metadata?.gift_message         || null,
    });

    if (insertErr) {
      console.error("provisionFromSession: gift code insert error:", insertErr.message);
      return { statusCode: 500, body: JSON.stringify({ error: insertErr.message }) };
    }

    const resendKey = getEnv("RESEND_API_KEY");
    if (resendKey) {
      const recipientEmail = session.metadata?.gift_recipient_email || null;
      const recipientName  = session.metadata?.gift_recipient_name  || "";
      const giftMessage    = session.metadata?.gift_message         || "";
      const toEmail        = recipientEmail || buyerEmail;
      const tierName       = GIFT_TIER_NAMES[giftTierKey] || giftTierKey;
      if (toEmail) {
        try {
          const { error: emailErr } = await new Resend(resendKey).emails.send({
            from:    "Irene's Webworks <gifts@email.irenes-ventures.com>",
            to:      toEmail,
            subject: `🎁 You've received a ${tierName} plan gift — Irene's Webworks`,
            html:    buildPlanGiftEmail(code, tierName, giftQty, giftTierKey, recipientName, giftMessage),
          });
          if (emailErr) console.error("provisionFromSession: gift email error:", emailErr.message);
          else console.log(`provisionFromSession: gift email sent to ${toEmail}`);
        } catch (e) { console.error("provisionFromSession: gift email exception:", e.message); }
      }
    } else {
      console.warn("provisionFromSession: RESEND_API_KEY not set — gift code stored but email not sent");
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, isGift: true, giftCode: code }) };
  }

  // Check whether the webhook already handled this session (idempotency)
  const { data: existing } = await supabase
    .from("memberships")
    .select("tier, status, stripe_payment_intent, stripe_subscription_id, hosting_until, support_until")
    .eq("user_id", user.id)
    .maybeSingle();

  const alreadyPaid = existing?.tier && existing.tier !== "free" && existing.status === "active";
  if (alreadyPaid) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, alreadyProvisioned: true, tier: existing.tier }) };
  }

  // Provision based on tier
  const extra = {};
  if (session.customer)       extra.stripe_customer_id       = session.customer;
  if (session.subscription)   extra.stripe_subscription_id   = session.subscription;
  if (session.payment_intent) extra.stripe_payment_intent    = session.payment_intent;

  const hAddon = hostingAddonMonths(session.metadata?.cart);
  const sAddon = supportAddonMonths(session.metadata?.cart);
  if (sAddon > 0) extra.support_until = stackMonths(existing?.support_until, sAddon);

  let upsertData;
  if (tierKey === "graduate") {
    upsertData = {
      user_id:         user.id,
      tier:            "graduate",
      status:          "active",
      credits_used:    0,
      downloads_used:  0,
      credits_limit:   qty * CREDITS_PER_UNIT,
      downloads_limit: qty * DOWNLOADS_PER_UNIT,
      hosting_until:   stackMonths(existing?.hosting_until, qty + hAddon),
      ...extra,
    };
  } else if (tierKey === "prime") {
    upsertData = {
      user_id:         user.id,
      tier:            "prime",
      status:          "active",
      credits_used:    0,
      downloads_used:  0,
      credits_limit:   10,
      downloads_limit: 5,
      hosting_until:   stackMonths(existing?.hosting_until, 4 + hAddon),
      ...extra,
    };
  } else {
    return { statusCode: 400, body: JSON.stringify({ error: `Unhandled tier: ${tierKey}` }) };
  }

  const { error: dbErr } = await supabase
    .from("memberships")
    .upsert(upsertData, { onConflict: "user_id" });

  if (dbErr) {
    console.error("provisionFromSession upsert error:", dbErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: dbErr.message }) };
  }

  console.log(`provisionFromSession: provisioned ${tierKey} for user ${user.id}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, tier: tierKey }) };
}
