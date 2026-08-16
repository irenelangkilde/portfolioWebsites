/**
 * Warn customers before their hosting lapses.
 *
 * This is the piece that turns a lapse back into a purchase. Everything else in the
 * lifecycle happens TO the customer — the site goes dark, the credits expire — and by the
 * time they notice, the moment to sell them anything has passed. A week's notice is the
 * only point at which renewing is still a decision rather than a recovery.
 *
 * WHO IS SKIPPED, AND WHY
 *
 *   auto-renewing subscribers  Stripe already emails "upcoming renewal", and that setting
 *                              is on. A second warning about a charge that will happen by
 *                              itself reads as a problem where none exists.
 *   no hosting_until           Free accounts cannot deploy, so there is nothing to lapse.
 *   already reminded           renewal_reminder_for matches the current hosting_until.
 *
 * The marker records WHICH expiry was warned about, so renewing moves hosting_until and
 * re-arms the reminder for the next cycle without any cleanup.
 */

import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { getEnv } from "./localEnv.mjs";
import { archiveDate, ARCHIVE_GRACE_MONTHS } from "./membershipDates.mjs";
import { PLAN_PRICING, planTotalCents, planCredits, planBonusCredits, formatCents } from "../../planPricing.mjs";

// A week: long enough to act on, close enough to still feel real. Sent earlier it gets
// filed and forgotten; later it becomes an apology rather than an offer.
const REMIND_DAYS_BEFORE = 7;

function getSupabaseAdmin() {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

const fmtDate = iso =>
  new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

export async function handler() {
  const report = { candidates: 0, sent: 0, skippedSubscribed: 0, skippedAlreadySent: 0, noEmail: 0, errors: 0 };

  let supabase;
  try { supabase = getSupabaseAdmin(); }
  catch (err) {
    console.error("[reminder] could not start:", err?.message);
    return { statusCode: 500, body: JSON.stringify({ error: err?.message }) };
  }

  const now     = Date.now();
  const horizon = new Date(now + REMIND_DAYS_BEFORE * 86400000).toISOString();
  const nowIso  = new Date(now).toISOString();

  // Everything expiring within the window and not already past it. Past-due accounts are
  // deliberately excluded: reconcileHosting has already delisted them, and "your site goes
  // offline soon" would be false.
  const { data: rows, error } = await supabase
    .from("memberships")
    .select("user_id, tier, status, hosting_until, credits_limit, credits_used, stripe_subscription_id, renewal_reminder_for")
    .not("hosting_until", "is", null)
    .gt("hosting_until", nowIso)
    .lte("hosting_until", horizon);

  if (error) {
    console.error("[reminder] query failed:", error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  report.candidates = rows?.length || 0;

  for (const m of rows || []) {
    if (m.stripe_subscription_id && m.status === "active") { report.skippedSubscribed++; continue; }
    if (m.renewal_reminder_for && m.renewal_reminder_for === m.hosting_until) { report.skippedAlreadySent++; continue; }

    let email = null;
    try {
      const { data } = await supabase.auth.admin.getUserById(m.user_id);
      email = data?.user?.email || null;
    } catch (err) {
      console.warn(`[reminder] could not read user ${m.user_id}:`, err?.message);
    }
    if (!email) { report.noEmail++; continue; }

    try {
      await sendReminder(email, m);
      // Marked only after a successful send. Marking first would lose the reminder
      // entirely if the mail failed, and a duplicate is a far smaller harm than silence.
      await supabase
        .from("memberships")
        .update({ renewal_reminder_for: m.hosting_until })
        .eq("user_id", m.user_id);
      report.sent++;
    } catch (err) {
      console.error(`[reminder] send failed for ${m.user_id}:`, err?.message);
      report.errors++;
    }
  }

  console.log("[reminder] done:", JSON.stringify(report));
  return { statusCode: 200, body: JSON.stringify(report) };
}

async function sendReminder(to, m) {
  const key = getEnv("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not set");

  const tier      = PLAN_PRICING[m.tier] ? m.tier : "graduate";
  const planName  = PLAN_PRICING[tier].name;
  const endsOn    = fmtDate(m.hosting_until);
  const creditsGo = fmtDate(archiveDate(m.hosting_until));

  // Three concrete options rather than one button. Someone who does not want to renew at
  // the same size will not click "renew" — but they might click "one month".
  const oneMonth   = planTotalCents(tier, 1);
  const sixMonths  = planTotalCents(tier, 6);
  const sixBonus   = planBonusCredits(tier, 6);
  const sixCredits = planCredits(tier, 6);

  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: "Irene's Webworks <gifts@email.irenes-ventures.com>",
    to,
    subject: `Your portfolio goes offline on ${endsOn}`,
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0b1220;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#eaf0ff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 16px;">
    <tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <tr><td style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:14px 14px 0 0;padding:24px 28px;">
        <p style="margin:0;font-size:20px;font-weight:900;">Irene's Webworks</p>
        <p style="margin:4px 0 0;color:rgba(234,240,255,.65);font-size:13px;">Professional portfolio websites</p>
      </td></tr>

      <tr><td style="background:rgba(255,176,32,.13);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:30px 28px;">
        <h1 style="margin:0;font-size:23px;font-weight:900;line-height:1.2;">Your portfolio goes offline on ${endsOn}.</h1>
        <p style="margin:12px 0 0;font-size:15px;color:rgba(234,240,255,.85);line-height:1.75;">
          That's about a week away. Nothing is deleted — your site and your work stay exactly
          as they are, they just stop being visible to anyone you've sent the link to.
        </p>
      </td></tr>

      <tr><td style="background:rgba(255,255,255,.05);border-left:1px solid rgba(255,255,255,.14);border-right:1px solid rgba(255,255,255,.14);padding:26px 28px;">
        <p style="margin:0 0 14px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(234,240,255,.45);">Your options</p>

        <p style="margin:0 0 6px;font-size:15px;color:#fff;font-weight:800;">Keep it simple — one more month</p>
        <p style="margin:0 0 16px;font-size:14px;color:rgba(234,240,255,.72);line-height:1.7;">
          ${formatCents(oneMonth)}. Stays online, nothing recurring.
        </p>

        <p style="margin:0 0 6px;font-size:15px;color:#fff;font-weight:800;">Buy ahead and get more credits</p>
        <p style="margin:0 0 16px;font-size:14px;color:rgba(234,240,255,.72);line-height:1.7;">
          Six months is ${formatCents(sixMonths)} and includes <strong style="color:#FFD79A;">${sixBonus} bonus credits</strong>
          — ${sixCredits} in total, available immediately. Useful if you expect to keep tailoring
          your site for different roles.
        </p>

        <p style="margin:0 0 6px;font-size:15px;color:#fff;font-weight:800;">Do nothing</p>
        <p style="margin:0;font-size:14px;color:rgba(234,240,255,.72);line-height:1.7;">
          Your site goes offline on ${endsOn} and your credits remain usable until
          ${creditsGo}, ${ARCHIVE_GRACE_MONTHS} months later. You can come back any time before
          then and pick up where you left off.
        </p>
      </td></tr>

      <tr><td style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-top:0;border-radius:0 0 14px 14px;padding:24px 28px;text-align:center;">
        <a href="https://resumeto.website/src/pricing.html"
           style="display:inline-block;padding:13px 26px;border-radius:11px;background:#4E70F1;color:#fff;font-weight:800;font-size:15px;text-decoration:none;">
          Keep my portfolio online →
        </a>
        <p style="margin:16px 0 0;font-size:12px;color:rgba(234,240,255,.42);line-height:1.7;">
          You're getting this because your ${planName} hosting ends soon. It's the only
          reminder we'll send about this date.<br>
          Questions? <a href="mailto:irene@irenes-ventures.com" style="color:#8DE0FF;">irene@irenes-ventures.com</a>
        </p>
      </td></tr>

    </table></td></tr>
  </table>
</body></html>`,
  });

  if (error) throw new Error(error.message);
  console.log(`[reminder] sent to ${to} — hosting ends ${m.hosting_until}`);
}
