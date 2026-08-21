#!/usr/bin/env bash
#
# Create the SHAREME promotion codes in Stripe and print the SQL to register them.
#
# Each code is one Stripe promotion code attached to an existing coupon. The coupon
# defines the discount; the promotion code is the redeemable string. Ten codes on one
# coupon means one discount with ten separate handles — which is what lets each be capped,
# expired or traced independently.
#
# MAX_REDEMPTIONS=1 by default. That is the point of having ten rather than one: a code
# that works once is genuinely personal, and a leaked one costs a single discount instead
# of the whole campaign. Raise it if you want them shareable.
#
# Usage:
#   COUPON=<coupon_id> ./scripts/create-share-codes.sh          # live mode
#   COUPON=<coupon_id> STRIPE_FLAGS=--live ./scripts/create-share-codes.sh
#
# The coupon id is the SHORT one (e.g. 7G8YYLdI), not a promo_… — that is what this
# creates. Find it under Product catalogue → Coupons.

set -euo pipefail

: "${COUPON:?Set COUPON to the Stripe coupon id, e.g. COUPON=7G8YYLdI $0}"
MAX_REDEMPTIONS="${MAX_REDEMPTIONS:-1}"
STRIPE_FLAGS="${STRIPE_FLAGS:-}"

# Five-character suffixes from an alphabet with the confusable characters removed:
# no I/1/L/O/0, and no U, S/5 or B/8 — the pairs that survive a screen font but not
# handwriting or a photo of a printed card.
SUFFIXES=(TFHTJ CAP3Y CRQKQ J2PR3 M6Q9A 2AFGK DQAD2 K4KQM JP96W GJ6X6)

echo "Creating ${#SUFFIXES[@]} promotion codes on coupon ${COUPON} (max_redemptions=${MAX_REDEMPTIONS})"
echo

rows=()
for s in "${SUFFIXES[@]}"; do
  code="SHAREME${s}"
  # -r gives raw JSON; the id is what affiliate_codes needs, the code is what a buyer types.
  out=$(stripe promotion_codes create ${STRIPE_FLAGS} \
          --coupon="${COUPON}" \
          --code="${code}" \
          --max-redemptions="${MAX_REDEMPTIONS}" \
          2>&1) || { echo "FAILED ${code}: ${out}" >&2; continue; }

  id=$(printf '%s' "${out}" | sed -n 's/.*"id": *"\(promo_[^"]*\)".*/\1/p' | head -1)
  if [ -z "${id}" ]; then
    echo "FAILED ${code}: could not read an id from the response" >&2
    continue
  fi
  echo "  ${code}  ->  ${id}"
  rows+=("  ('${code}', '${id}', 'discount', true)")
done

echo
echo "── Paste into Supabase ──────────────────────────────────────────────────────"
echo "-- Replace 'discount' with the label buyers should see, e.g. '15% off'."
echo "insert into public.affiliate_codes (code, stripe_promotion_code_id, discount_label, active)"
echo "values"
printf '%s,\n' "${rows[@]::${#rows[@]}-1}"
printf '%s\n' "${rows[${#rows[@]}-1]}"
echo "on conflict (code) do update"
echo "  set stripe_promotion_code_id = excluded.stripe_promotion_code_id,"
echo "      discount_label           = excluded.discount_label,"
echo "      active                   = excluded.active;"
