/**
 * The price of everything, in cents, defined once.
 *
 * WHY CENTS, AND WHY HERE
 *
 * Prices previously lived in three places that had to agree by discipline: display
 * constants in Pricing.html, ADDON_PRICE_DATA in createCheckoutSession.mjs, and Stripe
 * price IDs in the dashboard. They drifted three separate times — credits charged $1 while
 * the summary said $5, Prime shown at $12 against a $99 constant, and a confirm dialog
 * running its own second calculation. Every one of those was a page promising one number
 * and a card being charged another.
 *
 * Cents because that is what Stripe takes, and because 0.1 + 0.2 is not 0.3.
 *
 * TIERED MONTHS
 *
 * `tiers` is the per-month price by index: tiers[0] is the first month, tiers[1] the
 * second, and any month past the end of the array costs `extra`. Flat pricing is the
 * degenerate case where every entry equals `extra`, which is where this starts.
 *
 * To offer a volume discount — the reason this file exists — lower `extra` below the
 * early tiers. For example:
 *
 *     graduate: { tiers: [700, 700, 700], extra: 500 }
 *
 * gives the first three months at $7 and every month after at $5. Because both the page
 * and createCheckoutSession compute from this table, the displayed total and the amount
 * charged cannot disagree.
 *
 * CHANGING A PRICE
 *
 * Change it here and nowhere else. Plans are billed with inline price_data computed from
 * this table, so there is no Stripe price ID to keep in step — STRIPE_PRICE_GRADUATE and
 * friends are no longer consulted for plan line items.
 */

export const PLAN_PRICING = {
  graduate: { name: "Graduate", tiers: [700],  extra: 700  },
  prime:    { name: "Prime",    tiers: [1200], extra: 1200 },
};

/**
 * What a plan grants, before any add-on.
 *
 * Lives here rather than in the webhook because it is the same kind of fact as the price —
 * part of the definition of the plan — and it was previously duplicated as GRADUATE_CREDITS
 * in two functions plus TIER_LIMITS in a third.
 */
export const PLAN_ENTITLEMENTS = {
  graduate: { credits: 3,  sites: 1, storageGb: 10  },
  prime:    { credits: 10, sites: 5, storageGb: 100 },
};

/**
 * Storage allowance, in GB.
 *
 * ADVERTISED, NOT ENFORCED. Nothing counts bytes per user, and nothing refuses an upload
 * for exceeding this. It is honest only because it cannot realistically be reached:
 * individual assets are capped at 5 MB, so 10 GB is about two thousand uploads against a
 * plan that permits one site.
 *
 * If a customer ever does approach it, this becomes a promise with no mechanism behind it.
 * Enforcing it would mean a bytes-per-user tally maintained on upload and delete, a
 * backfill for existing sites, and checks in the upload and deploy paths — none of which
 * exists. Do not quietly start relying on this number as a limit.
 */
export function planStorageGb(tier) {
  return PLAN_ENTITLEMENTS[tier]?.storageGb ?? 0;
}

/**
 * Extra credits granted for each month bought beyond the first, all available immediately.
 *
 * This is the volume incentive, and it is deliberately credits rather than a discount. At
 * $7 a month there is not enough absolute money in a two or three month purchase for a
 * percentage off to feel like anything — three months at a 25c-per-month ladder saves 75
 * cents. A credit costs about a dollar to grant and is the scarce resource in the product,
 * so it reads as worth more than the same money off.
 *
 * Granted UP FRONT rather than accruing monthly: the point is to reward committing now,
 * and a benefit you have to wait for does not influence the decision being made today.
 */
export const BONUS_CREDITS_PER_EXTRA_MONTH = 1;

/** Credits a purchase of `months` grants, before extra_credits add-ons. */
export function planCredits(tier, months) {
  const base = PLAN_ENTITLEMENTS[tier]?.credits;
  if (base === undefined) return 0;
  const n = Math.max(1, Math.floor(Number(months) || 1));
  return base + BONUS_CREDITS_PER_EXTRA_MONTH * (n - 1);
}

/** Sites a plan grants. Does not scale with months — one plan, one allowance. */
export function planSites(tier) {
  return PLAN_ENTITLEMENTS[tier]?.sites ?? 0;
}

/** Bonus credits alone, for saying "plus 2 extra credits" without recomputing. */
export function planBonusCredits(tier, months) {
  return planCredits(tier, months) - (PLAN_ENTITLEMENTS[tier]?.credits ?? 0);
}

export const ADDON_PRICING = {
  extra_credits: { name: "Extra Credits",             cents: 100  },
  care:          { name: "Human Support (per month)", cents: 4900 },
};

/**
 * Guest gift packages. Bought without an account, so they are not months of anything and
 * the tier ladder does not apply.
 *
 * These figures were previously split: landing_gift.html displayed $149 and $299 while the
 * charge came from STRIPE_PRICE_STARTER and STRIPE_PRICE_PREMIUM, with nothing keeping the
 * two in step. VERIFY THESE MATCH STRIPE before trusting them — if the dashboard prices
 * had already drifted from the page, whichever was wrong is now baked in here.
 */
export const GIFT_PRICING = {
  starter_care: { name: "Starter Gift", cents: 14900 },
  premium_care: { name: "Premium Gift", cents: 29900 },
};

/** Flat per-unit price for anything that is not a month-laddered plan. */
export function unitCents(tier) {
  return ADDON_PRICING[tier]?.cents ?? GIFT_PRICING[tier]?.cents ?? 0;
}

/** Display name for any tier, plan or otherwise. */
export function tierName(tier) {
  return PLAN_PRICING[tier]?.name ?? ADDON_PRICING[tier]?.name ?? GIFT_PRICING[tier]?.name ?? tier;
}

/** Price of a single month, by zero-based month index. */
export function planUnitCents(tier, monthIndex) {
  const plan = PLAN_PRICING[tier];
  if (!plan) return 0;
  return monthIndex < plan.tiers.length ? plan.tiers[monthIndex] : plan.extra;
}

/** Total for `months` months of `tier`, applying the tier ladder. */
export function planTotalCents(tier, months) {
  const n = Math.max(0, Math.floor(Number(months) || 0));
  let total = 0;
  for (let i = 0; i < n; i++) total += planUnitCents(tier, i);
  return total;
}

/**
 * What the buyer saves versus paying the first-month rate every month.
 *
 * Zero while pricing is flat. Exposed so the page can say "save $6" without recomputing
 * the comparison and getting it subtly different.
 */
export function planSavingsCents(tier, months) {
  const n = Math.max(0, Math.floor(Number(months) || 0));
  return Math.max(0, planUnitCents(tier, 0) * n - planTotalCents(tier, n));
}

/** Cost of one add-on unit. */
export function addonUnitCents(tier) {
  return ADDON_PRICING[tier]?.cents ?? 0;
}

/** Total for any cart line — plan, add-on or gift package. */
export function lineTotalCents(tier, qty) {
  if (PLAN_PRICING[tier]) return planTotalCents(tier, qty);
  return unitCents(tier) * Math.max(0, Math.floor(Number(qty) || 0));
}

/** True if this tier is priced here at all. Anything false is unsellable. */
export function isPriced(tier) {
  return !!(PLAN_PRICING[tier] || ADDON_PRICING[tier] || GIFT_PRICING[tier]);
}

/** "$21.00" — one formatter so rounding is identical everywhere. */
export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export const PLAN_TIER_KEYS = Object.keys(PLAN_PRICING);
