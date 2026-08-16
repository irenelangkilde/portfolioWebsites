/**
 * Trade an email and phone number for the signup discount code.
 *
 * Public and unauthenticated by necessity — the whole point is to reach people who have
 * not signed up. That shapes the defences: the unique index on lower(email) means one
 * person cannot farm codes by resubmitting, and a repeat submission returns the SAME code
 * rather than issuing another. There is no per-IP limit; if this is ever abused at volume,
 * that is where to add one.
 *
 * The code itself is a single shared Stripe promotion code, identified by
 * STRIPE_PROMO_SIGNUP10. Its human-readable string is read from Stripe rather than
 * configured separately, so the email cannot advertise a code that differs from the one
 * Stripe will accept — the failure mode that has already cost this project three
 * wrong-price bugs.
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { getEnv } from "./localEnv.mjs";

function getSupabaseAdmin() {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

/** Deliberately permissive. Rejecting unusual but valid addresses loses real leads. */
function looksLikeEmail(v) {
  return typeof v === "string" && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v.trim()) && v.length <= 254;
}

/** Digits only, 7–15, which covers international without demanding a format. */
function normalisePhone(v) {
  const digits = String(v || "").replace(/[^\d+]/g, "");
  const bare   = digits.replace(/\D/g, "");
  return (bare.length >= 7 && bare.length <= 15) ? digits.slice(0, 20) : null;
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

  const email = String(body.email || "").trim().toLowerCase();
  const phone = normalisePhone(body.phone);
  const smsConsent = body.smsConsent === true;
  const attribution = (body.attribution && typeof body.attribution === "object") ? body.attribution : {};

  if (!looksLikeEmail(email)) return json(400, { error: "Please enter a valid email address." });
  if (!phone)                 return json(400, { error: "Please enter a valid phone number." });

  const promoId = getEnv("STRIPE_PROMO_SIGNUP10");
  if (!promoId) {
    console.error("[signup] STRIPE_PROMO_SIGNUP10 is not set — cannot issue a code");
    return json(500, { error: "The discount is not available right now. Please try again later." });
  }

  const supabase = getSupabaseAdmin();

  // Already claimed? Return the same code. Re-sending beats minting a second one, and
  // people genuinely do lose the email.
  const { data: existing } = await supabase
    .from("signup_leads")
    .select("code")
    .eq("email", email)
    .maybeSingle();

  // Resolve the code string from Stripe. Doing this per request rather than caching keeps
  // it correct if the promotion code is ever swapped for another.
  let code = existing?.code || null;
  if (!code) {
    try {
      const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2024-12-18.acacia" });
      const promo  = await stripe.promotionCodes.retrieve(promoId);
      code = promo?.code || null;
      if (!promo?.active) {
        console.warn(`[signup] promotion code ${promoId} is inactive`);
      }
    } catch (err) {
      console.error("[signup] could not resolve promotion code:", err?.message);
      return json(500, { error: "The discount is not available right now. Please try again later." });
    }
  }
  if (!code) return json(500, { error: "The discount is not available right now. Please try again later." });

  // Record the lead. onConflict keeps the first claim authoritative, so a resubmission
  // updates the phone and consent without resetting created_at or the issued code.
  const { error: upsertErr } = await supabase
    .from("signup_leads")
    .upsert({
      email,
      phone,
      sms_consent:    smsConsent,
      sms_consent_at: smsConsent ? new Date().toISOString() : null,
      code,
      stripe_promotion_code_id: promoId,
      utm_source:    String(attribution.utm_source    || "").slice(0, 120) || null,
      utm_medium:    String(attribution.utm_medium    || "").slice(0, 120) || null,
      utm_campaign:  String(attribution.utm_campaign  || "").slice(0, 120) || null,
      landing_path:  String(attribution.landing_path  || "").slice(0, 200) || null,
      referrer_host: String(attribution.referrer_host || "").slice(0, 120) || null,
    }, { onConflict: "email" });

  if (upsertErr) {
    console.error("[signup] could not record lead:", upsertErr.message);
    // Do not fail the request. They gave their details; withholding the code because our
    // bookkeeping failed punishes them for our problem.
  }

  // Register the code so checkout accepts it. Idempotent, and it means the discount works
  // even if this row was never seeded by hand.
  const { error: codeErr } = await supabase
    .from("affiliate_codes")
    .upsert({
      code,
      stripe_promotion_code_id: promoId,
      discount_label: "10% off",
      active: true,
    }, { onConflict: "code" });
  if (codeErr) console.error("[signup] could not register code:", codeErr.message);

  await sendCodeEmail(email, code);

  return json(200, { ok: true, code });
}

async function sendCodeEmail(to, code) {
  try {
    const key = getEnv("RESEND_API_KEY");
    if (!key) { console.warn("[signup] RESEND_API_KEY not set"); return; }

    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from:    "Irene's Webworks <gifts@email.irenes-ventures.com>",
      to,
      subject: `Your 10% discount code: ${code}`,
      html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0b1220;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eaf0ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 16px;">
    <tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:14px 14px 0 0;padding:24px 28px;">
        <p style="margin:0;font-size:20px;font-weight:900;">Irene's Webworks</p>
        <p style="margin:4px 0 0;color:rgba(234,240,255,.65);font-size:13px;">Professional portfolio websites</p>
      </td></tr>
      <tr><td style="background:rgba(78,112,241,.14);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:32px 28px;text-align:center;">
        <h1 style="margin:0;font-size:24px;font-weight:900;line-height:1.15;">Here's your 10% off.</h1>
        <p style="margin:12px 0 0;font-size:15px;color:rgba(234,240,255,.82);line-height:1.75;">Enter this at checkout:</p>
        <p style="margin:18px 0 0;font-size:30px;font-weight:900;letter-spacing:.12em;color:#fff;font-family:ui-monospace,monospace;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:14px 22px;display:inline-block;">${code}</p>
      </td></tr>
      <tr><td style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-top:0;border-radius:0 0 14px 14px;padding:24px 28px;text-align:center;">
        <a href="https://resumeto.website/src/pricing.html"
           style="display:inline-block;padding:12px 22px;border-radius:11px;background:#4E70F1;color:#fff;font-weight:800;font-size:14px;text-decoration:none;">
          Build my portfolio →
        </a>
        <p style="margin:16px 0 0;font-size:12px;color:rgba(234,240,255,.42);line-height:1.7;">
          You're receiving this because you asked for a discount code at resumeto.website.
          Questions? <a href="mailto:irene@irenes-ventures.com" style="color:#8DE0FF;">irene@irenes-ventures.com</a>
        </p>
      </td></tr>
    </table></td></tr>
  </table>
</body></html>`,
    });
    if (error) console.error("[signup] send failed:", error.message);
    else console.log(`[signup] code ${code} sent to ${to}`);
  } catch (err) {
    console.error("[signup] unexpected send failure:", err?.message);
  }
}
