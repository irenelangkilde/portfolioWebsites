var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// stripeWebhook.mjs
var stripeWebhook_exports = {};
__export(stripeWebhook_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(stripeWebhook_exports);
var import_stripe = __toESM(require("stripe"), 1);
var import_supabase_js = require("@supabase/supabase-js");
var CREDITS_PER_UNIT = 5;
var DOWNLOADS_PER_UNIT = 1;
var DEPLOYS_PER_UNIT = 1;
var TIER_LIMITS = {
  basic: { tier: "basic", credits_limit: 5, downloads_limit: 1, deploys_limit: 1 },
  // premium tiers: limits are computed dynamically from quantity (see checkout handler)
  // premium_annual is the exception — unlimited
  premium_annual: { tier: "premium", credits_limit: 120, downloads_limit: -1, deploys_limit: -1 }
};
function getSupabaseAdmin() {
  return (0, import_supabase_js.createClient)(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}
async function upgradeMembership(userId, tierKey, extraFields = {}) {
  const limits = TIER_LIMITS[tierKey];
  if (!limits) {
    console.error("Unknown tierKey:", tierKey);
    return;
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("memberships").update({
    ...limits,
    status: "active",
    ...extraFields
  }).eq("user_id", userId);
  if (error) console.error("Supabase update error:", error.message);
  else console.log(`Upgraded user ${userId} to ${limits.tier} (${tierKey})`);
}
async function upgradePremiumMonthly(userId, quantity, extraFields = {}) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("memberships").update({
    tier: "premium",
    status: "active",
    credits_limit: quantity * CREDITS_PER_UNIT,
    downloads_limit: quantity * DOWNLOADS_PER_UNIT,
    deploys_limit: quantity * DEPLOYS_PER_UNIT,
    ...extraFields
  }).eq("user_id", userId);
  if (error) console.error("Supabase update error:", error.message);
  else console.log(`Upgraded user ${userId} to premium (${quantity} units)`);
}
async function cancelMembership(userId) {
  const supabase = getSupabaseAdmin();
  await supabase.from("memberships").update({ status: "cancelled" }).eq("user_id", userId);
  console.log(`Cancelled membership for user ${userId}`);
}
async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return { statusCode: 500, body: "Stripe not configured" };
  }
  const stripe = new import_stripe.default(stripeKey, { apiVersion: "2024-12-18.acacia" });
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
      const userId = obj.metadata?.user_id;
      const tierKey = obj.metadata?.tier_key;
      const qty = parseInt(obj.metadata?.quantity || "1", 10);
      if (!userId || !tierKey) break;
      const extra = {};
      if (obj.customer) extra.stripe_customer_id = obj.customer;
      if (obj.subscription) extra.stripe_subscription_id = obj.subscription;
      if (obj.payment_intent) extra.stripe_payment_intent = obj.payment_intent;
      if (obj.subscription) {
        try {
          const sub = await stripe.subscriptions.retrieve(obj.subscription);
          extra.current_period_end = new Date(sub.current_period_end * 1e3).toISOString();
          if (tierKey === "premium_monthly_new") {
            await stripe.subscriptions.update(obj.subscription, { cancel_at_period_end: true });
          }
        } catch {
        }
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
        const sub = await stripe.subscriptions.retrieve(subId);
        const userId = sub.metadata?.user_id;
        const tierKey = sub.metadata?.tier_key;
        const qty = parseInt(sub.metadata?.quantity || "1", 10);
        if (!userId) break;
        const supabase = getSupabaseAdmin();
        if (tierKey === "premium_monthly_sub") {
          await supabase.from("memberships").update({
            status: "active",
            credits_used: 0,
            downloads_used: 0,
            deploys_used: 0,
            credits_limit: qty * CREDITS_PER_UNIT,
            downloads_limit: qty * DOWNLOADS_PER_UNIT,
            deploys_limit: qty * DEPLOYS_PER_UNIT,
            current_period_end: new Date(sub.current_period_end * 1e3).toISOString()
          }).eq("user_id", userId);
        } else if (tierKey === "premium_annual") {
          await supabase.from("memberships").update({
            status: "active",
            credits_used: 0,
            downloads_used: 0,
            deploys_used: 0,
            current_period_end: new Date(sub.current_period_end * 1e3).toISOString()
          }).eq("user_id", userId);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=stripeWebhook.js.map
