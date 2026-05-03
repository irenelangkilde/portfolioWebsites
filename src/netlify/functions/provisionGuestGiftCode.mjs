import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { Resend } from "resend";

const GIFT_TIERS      = new Set(["starter_care", "premium_care"]);
const GIFT_TIER_NAMES = { starter_care: "Starter", premium_care: "Premium" };

function getEnv(n) { return process.env[n] || ""; }

function getSupabaseAdmin() {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

function generateGiftCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return "GIFT-" + Array.from(randomBytes(8)).map(b => chars[b % chars.length]).join("");
}

function buildGiftEmail(code, tierName) {
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
        <h1 style="margin:12px 0 0;font-size:26px;font-weight:900;line-height:1.1;letter-spacing:-.03em;">Your ${tierName} Gift Code is ready.</h1>
        <p style="margin:14px 0 0;font-size:15px;color:rgba(234,240,255,.78);line-height:1.75;max-width:48ch;margin-left:auto;margin-right:auto;">Pass this code along to the lucky person in your life.</p>
      </td></tr>
      <tr><td style="background:rgba(0,0,0,.35);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;text-align:center;">
        <p style="margin:0 0 10px;font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(234,240,255,.5);">Gift Code</p>
        <p style="margin:0;font-size:34px;font-weight:900;letter-spacing:.12em;color:#fff;font-family:ui-monospace,monospace;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:14px 22px;display:inline-block;">${code}</p>
        <p style="margin:14px 0 0;font-size:13px;color:rgba(234,240,255,.5);">Valid for 12 months from today</p>
      </td></tr>
      <tr><td style="background:rgba(255,255,255,.04);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;">
        <p style="margin:0 0 16px;font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:rgba(234,240,255,.55);">How to redeem</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr><td style="padding:0 0 12px;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;"><strong style="color:#fff;">1.</strong> Visit <a href="https://irenes-ventures.com" style="color:#8DE0FF;">irenes-ventures.com</a> and click <strong style="color:#fff;">Redeem a gift code</strong>.</td></tr>
          <tr><td style="padding:0 0 12px;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;"><strong style="color:#fff;">2.</strong> Enter the code above when prompted. Create a free account to get started.</td></tr>
          <tr><td style="padding:0;font-size:14px;color:rgba(234,240,255,.82);line-height:1.7;"><strong style="color:#fff;">3.</strong> Upload a résumé, describe your goals, pick a style — Irene handles the rest.</td></tr>
        </table>
      </td></tr>
      <tr><td style="background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.14);border-top:none;border-radius:0 0 14px 14px;padding:20px 28px;">
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

  const { sessionId } = body;
  if (!sessionId) return { statusCode: 400, body: JSON.stringify({ error: "sessionId required" }) };

  const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2024-12-18.acacia" });
  let session;
  try { session = await stripe.checkout.sessions.retrieve(sessionId); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid session ID" }) }; }

  if (session.payment_status !== "paid") {
    return { statusCode: 400, body: JSON.stringify({ error: "Payment not complete" }) };
  }

  const tierKey = session.metadata?.tier_key;
  if (!GIFT_TIERS.has(tierKey)) {
    return { statusCode: 400, body: JSON.stringify({ error: "Not a guest gift tier" }) };
  }

  const supabase = getSupabaseAdmin();

  // Return existing code if webhook already stored one (idempotency)
  const { data: existing } = await supabase
    .from("gift_codes")
    .select("code, tier")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();

  if (existing?.code) {
    console.log(`provisionGuestGiftCode: code already exists for session ${sessionId}`);
    return { statusCode: 200, body: JSON.stringify({ code: existing.code, tier: existing.tier }) };
  }

  const code       = generateGiftCode();
  const buyerEmail = session.customer_details?.email || session.customer_email || null;

  console.log(`provisionGuestGiftCode: generating code=${code} tier=${tierKey} sessionId=${sessionId}`);

  const { error: insertErr } = await supabase.from("gift_codes").insert({
    code,
    tier:              tierKey,
    stripe_session_id: sessionId,
    buyer_email:       buyerEmail || "",
  });

  if (insertErr) {
    console.error("provisionGuestGiftCode insert error:", insertErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: insertErr.message }) };
  }

  const resendKey = getEnv("RESEND_API_KEY");
  if (resendKey && buyerEmail) {
    const tierName = GIFT_TIER_NAMES[tierKey] || tierKey;
    try {
      const { error: emailErr } = await new Resend(resendKey).emails.send({
        from:    "Irene's Webworks <gifts@email.irenes-ventures.com>",
        to:      buyerEmail,
        subject: `🎁 Your ${tierName} Gift Code is here — Irene's Webworks`,
        html:    buildGiftEmail(code, tierName),
      });
      if (emailErr) console.error("provisionGuestGiftCode email error:", emailErr.message);
      else console.log(`provisionGuestGiftCode: email sent to ${buyerEmail}`);
    } catch (e) { console.error("provisionGuestGiftCode email exception:", e.message); }
  }

  return { statusCode: 200, body: JSON.stringify({ code, tier: tierKey }) };
}
