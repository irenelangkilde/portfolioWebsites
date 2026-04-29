import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// What each gift tier grants when redeemed.
const GIFT_GRANTS = {
  starter_gift: { tier: "basic",   credits_limit: 10, downloads_limit: 1, deploys_limit: 1 },
  pro_gift:     { tier: "premium", credits_limit: 25, downloads_limit: 5, deploys_limit: 5 },
};

const GIFT_TIER_NAMES = {
  starter_gift: "Starter",
  pro_gift:     "Pro",
};

function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

function buildRedemptionEmail(tierName, grants) {
  const cStr = grants.credits_limit  === -1 ? "∞" : grants.credits_limit;
  const dStr = grants.downloads_limit === -1 ? "∞" : grants.downloads_limit;

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
        <tr><td style="background:rgba(118,176,34,.1);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:32px 28px;text-align:center;">
          <p style="margin:0;font-size:36px;">✓</p>
          <h1 style="margin:12px 0 0;font-size:26px;font-weight:900;line-height:1.1;letter-spacing:-.03em;">Your ${tierName} gift has been redeemed!</h1>
          <p style="margin:14px 0 0;font-size:15px;color:rgba(234,240,255,.78);line-height:1.75;max-width:48ch;margin-left:auto;margin-right:auto;">
            Your account has been upgraded. Everything you need to build your portfolio website is ready to go.
          </p>
        </td></tr>

        <!-- What's included -->
        <tr><td style="background:rgba(255,255,255,.04);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;">
          <p style="margin:0 0 16px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(234,240,255,.45);">What's now available in your account</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:10px 14px;background:rgba(255,255,255,.05);border-radius:8px 8px 0 0;border:1px solid rgba(255,255,255,.08);font-size:14px;color:rgba(234,240,255,.8);">
                🎨 &nbsp;<strong>${cStr} AI generation credits</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 14px;background:rgba(255,255,255,.05);border-top:none;border:1px solid rgba(255,255,255,.08);font-size:14px;color:rgba(234,240,255,.8);">
                ⬇️ &nbsp;<strong>${dStr} website download${grants.downloads_limit !== 1 ? "s" : ""}</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 14px;background:rgba(255,255,255,.05);border-top:none;border:1px solid rgba(255,255,255,.08);border-radius:0 0 8px 8px;font-size:14px;color:rgba(234,240,255,.8);">
                🚀 &nbsp;<strong>${dStr} Netlify deploy${grants.deploys_limit !== 1 ? "s" : ""}</strong>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="background:rgba(255,255,255,.04);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:28px;text-align:center;">
          <p style="margin:0 0 20px;font-size:15px;color:rgba(234,240,255,.78);line-height:1.75;">
            Head to the intake form to start building your portfolio — it only takes a few minutes.
          </p>
          <a href="https://irenes-ventures.com/src/overview.html"
             style="display:inline-block;padding:14px 28px;background:rgba(78,112,241,.55);border:1px solid rgba(78,112,241,.7);border-radius:12px;color:#eaf0ff;font-weight:900;font-size:15px;text-decoration:none;letter-spacing:.02em;">
            Start the Intake Form →
          </a>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.14);border-top:none;border-radius:0 0 14px 14px;padding:20px 28px;text-align:center;">
          <p style="margin:0;font-size:12px;color:rgba(234,240,255,.35);line-height:1.7;">
            Questions? Reply to this email or contact
            <a href="mailto:irene@irenes-ventures.com" style="color:rgba(141,224,255,.6);">irene@irenes-ventures.com</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { code, userId } = body;
  if (!code || !userId) {
    return { statusCode: 400, body: JSON.stringify({ error: "code and userId are required" }) };
  }

  const supabase = getSupabaseAdmin();
  const normalizedCode = code.trim().toUpperCase();

  const { data: gift, error: fetchErr } = await supabase
    .from("gift_codes")
    .select("*")
    .eq("code", normalizedCode)
    .single();

  if (fetchErr || !gift) {
    return { statusCode: 404, body: JSON.stringify({ error: "Gift code not found." }) };
  }
  if (gift.redeemed_at) {
    return { statusCode: 409, body: JSON.stringify({ error: "This gift code has already been redeemed." }) };
  }
  if (new Date(gift.expires_at) < new Date()) {
    return { statusCode: 410, body: JSON.stringify({ error: "This gift code has expired." }) };
  }

  const { error: redeemErr } = await supabase
    .from("gift_codes")
    .update({ redeemed_by: userId, redeemed_at: new Date().toISOString() })
    .eq("id", gift.id);

  if (redeemErr) {
    console.error("Failed to mark gift code redeemed:", redeemErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to redeem gift code." }) };
  }

  const grants = GIFT_GRANTS[gift.tier];
  if (!grants) {
    return { statusCode: 500, body: JSON.stringify({ error: `Unknown gift tier: ${gift.tier}` }) };
  }

  const { error: membershipErr } = await supabase
    .from("memberships")
    .upsert({ user_id: userId, ...grants, status: "active" }, { onConflict: "user_id" });

  if (membershipErr) {
    console.error("Failed to upgrade membership:", membershipErr.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Code redeemed but membership upgrade failed — contact support." }) };
  }

  // Send confirmation email to the recipient
  try {
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const recipientEmail = userData?.user?.email;
    if (recipientEmail && process.env.RESEND_API_KEY) {
      const resend   = new Resend(process.env.RESEND_API_KEY);
      const tierName = GIFT_TIER_NAMES[gift.tier] || gift.tier;
      await resend.emails.send({
        from:    "Irene's Webworks <gifts@emails.irenes-ventures.com>",
        to:      recipientEmail,
        subject: `🎉 Your ${tierName} gift has been redeemed — Irene's Webworks`,
        html:    buildRedemptionEmail(tierName, grants),
      });
      console.log(`Redemption confirmation sent to ${recipientEmail}`);
    }
  } catch (emailErr) {
    // Non-fatal — redemption already succeeded
    console.error("Failed to send redemption confirmation email:", emailErr.message);
  }

  console.log(`Gift code ${normalizedCode} (${gift.tier}) redeemed by user ${userId}`);
  return { statusCode: 200, body: JSON.stringify({ success: true, tier: gift.tier }) };
}
