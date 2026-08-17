/**
 * The dates a membership carries, defined once.
 *
 * stackMonths existed as three byte-identical copies (stripeWebhook,
 * provisionFromSession, redeemGiftCode) and monthsFromNow as two. Nothing had gone wrong
 * yet, but they are the arithmetic behind how long a customer keeps what they paid for,
 * and three copies means the next correction lands in one or two of them. The hosting
 * double-grant was a version of that: two places doing the same work without knowing it.
 *
 * WHAT EACH DATE MEANS
 *
 *   current_period_end  Stripe's. When the current billing period ends. Stripe advances
 *                       it on renewal, and it is null for a one-time purchase with no
 *                       subscription — so it is never a safe basis for our own policy.
 *
 *   hosting_until       Ours. The site is publicly visible until this moment.
 *
 *   deletion date       Derived, deliberately not stored — see deletionDate() below.
 */

/**
 * Months after which a site whose hosting has lapsed may be deleted.
 *
 * Eighteen months is long enough that a graduate who lands a job, stops paying, and comes
 * back when they next job-hunt still finds their site recoverable. That return visit is
 * worth more than the storage.
 */
export const DELETION_GRACE_MONTHS = 18;

/** Absolute date n months from now. */
export function monthsFromNow(n) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toISOString();
}

/**
 * Extend an existing expiry by n months, or start from now if there is none.
 *
 * Takes the later of (existing, now) as the base, so a lapsed membership restarts from
 * today rather than extending a date already in the past — otherwise someone returning
 * after a year would buy a month and receive nothing.
 *
 * Returns undefined for n <= 0, which callers spread into an update object so the column
 * is left untouched rather than nulled.
 */
export function stackMonths(existingIso, n) {
  if (!n || n <= 0) return undefined;
  const base = existingIso
    ? new Date(Math.max(new Date(existingIso).getTime(), Date.now()))
    : new Date();
  base.setMonth(base.getMonth() + n);
  return base.toISOString();
}

/**
 * When a site may be deleted: hosting_until plus the grace period.
 *
 * DERIVED, NOT STORED. A stored copy would be a third date that has to agree with
 * hosting_until forever, and this codebase has already paid for that mistake twice — one
 * value in two places is how the plan and hosting dates came to disagree. Anything that
 * needs this can compute it, and it stays correct automatically when hosting is extended.
 *
 * Returns null when hosting was never set, meaning there is nothing to delete.
 */
export function deletionDate(hostingUntilIso) {
  if (!hostingUntilIso) return null;
  const d = new Date(hostingUntilIso);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + DELETION_GRACE_MONTHS);
  return d.toISOString();
}

/** True if the site should still be served. Nothing enforces this yet — see README note. */
export function isHostingActive(hostingUntilIso, now = Date.now()) {
  if (!hostingUntilIso) return false;
  const t = new Date(hostingUntilIso).getTime();
  return !Number.isNaN(t) && t > now;
}

/** True if the retention window has also passed and the data may be deleted. */
export function isDeletable(hostingUntilIso, now = Date.now()) {
  const a = deletionDate(hostingUntilIso);
  if (!a) return false;
  return new Date(a).getTime() <= now;
}
