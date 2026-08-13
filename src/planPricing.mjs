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

export const ADDON_PRICING = {
  extra_credits: { name: "Extra Credits",             cents: 100  },
  care:          { name: "Human Support (per month)", cents: 4900 },
};

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

/** Total for any cart line, plan or add-on. */
export function lineTotalCents(tier, qty) {
  if (PLAN_PRICING[tier]) return planTotalCents(tier, qty);
  return addonUnitCents(tier) * Math.max(0, Math.floor(Number(qty) || 0));
}

/** "$21.00" — one formatter so rounding is identical everywhere. */
export function formatCents(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export const PLAN_TIER_KEYS = Object.keys(PLAN_PRICING);
