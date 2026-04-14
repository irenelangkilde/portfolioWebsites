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

// createCheckoutSession.mjs
var createCheckoutSession_exports = {};
__export(createCheckoutSession_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(createCheckoutSession_exports);
var import_stripe = __toESM(require("stripe"), 1);
var PRICE_IDS = {
  basic: process.env.STRIPE_PRICE_BASIC,
  // $7 flat, 1 unit
  premium_monthly_new: process.env.STRIPE_PRICE_PREMIUM_NEW,
  // graduated $19/11/7/5/4/2.95 per unit; subscription, cancel_at_period_end
  premium_monthly_sub: process.env.STRIPE_PRICE_PREMIUM_SUB,
  // graduated 50% off per unit; auto-renewing subscription (month 2+)
  premium_annual: process.env.STRIPE_PRICE_PREMIUM_ANNUAL
  // $99/year; unlimited credits & downloads
};
var SUBSCRIPTION_TIERS = /* @__PURE__ */ new Set(["premium_monthly_new", "premium_monthly_sub", "premium_annual"]);
async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }
  const { tier, userId, userEmail, returnUrl, quantity = 1 } = body;
  if (!tier || !userId || !userEmail) {
    return { statusCode: 400, body: JSON.stringify({ error: "tier, userId, and userEmail are required" }) };
  }
  const priceId = PRICE_IDS[tier];
  if (!priceId) {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown tier: ${tier}` }) };
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "Stripe not configured" }) };
  }
  const stripe = new import_stripe.default(stripeKey, { apiVersion: "2024-12-18.acacia" });
  const isSubscription = SUBSCRIPTION_TIERS.has(tier);
  const origin = returnUrl || "https://yoursite.netlify.app";
  try {
    const session = await stripe.checkout.sessions.create({
      mode: isSubscription ? "subscription" : "payment",
      customer_email: userEmail,
      line_items: [{ price: priceId, quantity }],
      success_url: `${origin}?checkout=success&tier=${tier}`,
      cancel_url: `${origin}?checkout=cancelled`,
      metadata: {
        user_id: userId,
        tier_key: tier,
        quantity: String(quantity)
      },
      ...isSubscription ? {
        subscription_data: { metadata: { user_id: userId, tier_key: tier, quantity: String(quantity) } }
      } : {
        payment_intent_data: { metadata: { user_id: userId, tier_key: tier, quantity: String(quantity) } }
      }
    });
    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=createCheckoutSession.js.map
