#!/usr/bin/env bash
#
# Create the SHAREME promotion codes in Stripe and print the SQL to register them.
#
# Each code is one Stripe promotion code attached to an existing coupon. The coupon
# defines the discount; the promotion code is the redeemable string. Ten codes on one
# coupon means one discount with ten separate handles — which is what lets each be capped,
# expired or traced independently.
#
# UNLIMITED REDEMPTIONS, FIRST PURCHASE ONLY.
#
# Ten codes that anyone may redeem are ten trackable sharing links rather than ten personal
# ones: purchase_sources records which code a sale came through, so you can tell whose
# sharing worked. Set MAX_REDEMPTIONS to cap one.
#
# first_time_transaction restricts each to customers with no prior successful payment, so
# the discount buys new customers rather than discounting people who would have paid
# anyway. Note what it actually checks: a Stripe CUSTOMER with no prior payment. A returning
# buyer who checks out under a different email is a new customer to Stripe and passes.
# Combined with the app-level one-discount-per-account limit that is enough friction for an
# acquisition offer, and it is not a fraud control.
#
# The exposure of unlimited codes is that a leak to a coupon site means unlimited discounted
# new customers. Bounded by expires_at, or by max_redemptions if you would rather cap.
#
# ACCOUNT IS EXPLICIT, NOT INHERITED. The CLI's [default] profile on this machine is the
# SANDBOX (acct_1SNmvwB1BQB7HGHe), not the live account (acct_1SNmvrBgBMKG03Ip). Codes
# created there are invisible to the live site and fail at checkout with "No such
# promotion code" — the same confusion that produced "the platform that controls this
# account has disabled this action".
#
# Usage:
#   COUPON=<coupon_id> ./scripts/create-share-codes.sh              # live account, live mode
#   COUPON=<coupon_id> MODE=--test ./scripts/create-share-codes.sh  # live account, test mode
#
# The coupon id is the SHORT one (e.g. 7G8YYLdI), not a promo_… — that is what this
# creates. Find it under Product catalogue → Coupons.

set -euo pipefail

: "${COUPON:?Set COUPON to the Stripe coupon id, e.g. COUPON=7G8YYLdI $0}"
MAX_REDEMPTIONS="${MAX_REDEMPTIONS:-}"   # empty = unlimited
# Assigned in two steps on purpose. Written inline as "${PROJECT:-irene's ventures}" the
# apostrophe opens a single-quoted string — the word part of ${VAR:-word} is quote-processed
# even inside double quotes — which swallows the rest of the file and reports a syntax error
# a dozen lines further down, nowhere near the cause.
DEFAULT_PROJECT="irene's ventures"
PROJECT="${PROJECT:-$DEFAULT_PROJECT}"
MODE="${MODE:---live}"

# Say out loud which account is about to be written to, and stop if it is not the one
# expected. Ten codes in the wrong account is silent until a customer cannot redeem one.
EXPECTED_ACCOUNT="acct_1SNmvrBgBMKG03Ip"
actual=$(stripe config --list 2>/dev/null | awk -v p="[\"${PROJECT}\"]" '$0==p{f=1;next} f&&/account_id/{gsub(/.*= .|.$/,"");print;exit}')
if [ "${actual}" != "${EXPECTED_ACCOUNT}" ]; then
  echo "Refusing to run: profile \"${PROJECT}\" resolves to \"${actual:-nothing}\", expected ${EXPECTED_ACCOUNT}." >&2
  echo "Check: stripe config --list" >&2
  exit 1
fi
echo "Account: ${actual} (profile \"${PROJECT}\", ${MODE})"

# Five-character suffixes from an alphabet with the confusable characters removed:
# no I/1/L/O/0, and no U, S/5 or B/8 — the pairs that survive a screen font but not
# handwriting or a photo of a printed card.
SUFFIXES=(TFHTJ CAP3Y CRQKQ J2PR3 M6Q9A 2AFGK DQAD2 K4KQM JP96W GJ6X6)

echo "Creating ${#SUFFIXES[@]} promotion codes on coupon ${COUPON}"
echo "  redemptions: ${MAX_REDEMPTIONS:-unlimited}    first purchase only: yes"
echo

rows=()
for s in "${SUFFIXES[@]}"; do
  code="SHAREME${s}"
  # -r gives raw JSON; the id is what affiliate_codes needs, the code is what a buyer types.
  # -d for the nested restriction: the CLI maps -d key=value straight onto API params,
  # which is the reliable way to reach restrictions[...]. max_redemptions is only sent when
  # set, because Stripe treats an absent value as unlimited and rejects an empty one.
  args=( promotion_codes create ${MODE} --project-name="${PROJECT}"
         --coupon="${COUPON}" --code="${code}"
         -d "restrictions[first_time_transaction]=true" )
  [ -n "${MAX_REDEMPTIONS}" ] && args+=( --max-redemptions="${MAX_REDEMPTIONS}" )

  out=$(stripe "${args[@]}" 2>&1) || { echo "FAILED ${code}: ${out}" >&2; continue; }

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
