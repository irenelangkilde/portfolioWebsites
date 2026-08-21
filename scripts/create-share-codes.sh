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
#   COUPON=<coupon_id> ./scripts/create-share-codes.sh          # live mode
#   COUPON=<coupon_id> MODE= ./scripts/create-share-codes.sh    # test mode
#
# This CLI has --live but no --test: test is the DEFAULT and --live opts in. So test mode is
# an EMPTY MODE, not a flag. Worth stating because it inverts the usual expectation that the
# safe mode is the one you ask for.
#
# The coupon id is the SHORT one (e.g. 7G8YYLdI), not a promo_… — that is what this
# creates. Find it under Product catalogue → Coupons.

set -euo pipefail

: "${COUPON:?Set COUPON to the Stripe coupon id, e.g. COUPON=7G8YYLdI $0}"
# 50 redemptions each and an end date. Both bound the exposure of a code that anyone may
# share: without them a leak to a coupon site is an open-ended 15% offer.
MAX_REDEMPTIONS="${MAX_REDEMPTIONS:-50}"
# 23:59:59 on 30 Sep 2026, Mountain Time. Stripe wants a Unix timestamp and treats it as an
# absolute instant, so the timezone has to be decided here rather than left to whoever reads
# the date — set as UTC it would cut off at 6pm local on the 30th.
EXPIRES_AT="${EXPIRES_AT:-1790834399}"
# No --project-name by default. The profile is stored in config.toml as ["irene's ventures"]
# — quoted because of the apostrophe and space — and the CLI cannot match that name back when
# it is passed as a flag, failing with "no config for that project was found". The [default]
# profile now points at the live account anyway, so naming one buys nothing and costs that.
# Set PROJECT to force a specific profile if the default ever changes.
PROJECT="${PROJECT:-}"
MODE="${MODE:---live}"

# Read the account from config.toml rather than `stripe config --list`, whose output format
# changed shape mid-session — the file is what the CLI itself reads. Checked before writing
# anything, because ten codes in the wrong account stay silent until a customer cannot
# redeem one.
EXPECTED_ACCOUNT="acct_1SNmvrBgBMKG03Ip"
CONFIG="${HOME}/.config/stripe/config.toml"
SECTION="${PROJECT:-default}"
actual=$(awk -v want="${SECTION}" '
  /^\[/ { name=$0; gsub(/^\[\"?|\"?\]$/,"",name); inwant=(name==want); next }
  inwant && /account_id/ { gsub(/.*= *.|.$/,""); print; exit }
' "${CONFIG}" 2>/dev/null)

if [ "${actual}" != "${EXPECTED_ACCOUNT}" ]; then
  echo "Refusing to run: profile \"${SECTION}\" resolves to \"${actual:-nothing}\", expected ${EXPECTED_ACCOUNT}." >&2
  echo "Check: grep -A1 '^\[' ${CONFIG}" >&2
  exit 1
fi
echo "Account: ${actual} (profile \"${SECTION}\", ${MODE:-test mode})"

# Five-character suffixes from an alphabet with the confusable characters removed:
# no I/1/L/O/0, and no U, S/5 or B/8 — the pairs that survive a screen font but not
# handwriting or a photo of a printed card.
SUFFIXES=(TFHTJ CAP3Y CRQKQ J2PR3 M6Q9A 2AFGK DQAD2 K4KQM JP96W GJ6X6)

echo "Creating ${#SUFFIXES[@]} promotion codes on coupon ${COUPON}"
echo "  redemptions: ${MAX_REDEMPTIONS:-unlimited} each"
echo "  expires:     $(date -r "${EXPIRES_AT}" 2>/dev/null || echo "${EXPIRES_AT}")"
echo "  first purchase only: yes"
echo

rows=()
for s in "${SUFFIXES[@]}"; do
  code="SHAREME${s}"
  # Parameter names come from `stripe help promotion_codes create`, not from the API docs:
  # the CLI exposes --promotion.coupon (with a required --promotion.type) rather than the
  # --coupon the REST body uses, and dashed --restrictions.first-time-transaction rather
  # than the restrictions[first_time_transaction] bracket form.
  # -c skips the per-command confirmation prompt, which would otherwise ask ten times.
  # max_redemptions is only sent when set: Stripe reads an absent value as unlimited and
  # rejects an empty one.
  args=( promotion_codes create ${MODE} -c )
  [ -n "${PROJECT}" ] && args+=( --project-name="${PROJECT}" )
  args+=(
         --promotion.type=coupon
         --promotion.coupon="${COUPON}"
         --code="${code}"
         --restrictions.first-time-transaction=true )
  [ -n "${MAX_REDEMPTIONS}" ] && args+=( --max-redemptions="${MAX_REDEMPTIONS}" )
  [ -n "${EXPIRES_AT}" ]      && args+=( --expires-at="${EXPIRES_AT}" )

  out=$(stripe "${args[@]}" 2>&1) || { echo "FAILED ${code}: ${out}" >&2; continue; }

  id=$(printf '%s' "${out}" | sed -n 's/.*"id": *"\(promo_[^"]*\)".*/\1/p' | head -1)
  if [ -z "${id}" ]; then
    echo "FAILED ${code}: could not read an id from the response" >&2
    continue
  fi
  echo "  ${code}  ->  ${id}"
  rows+=("  ('${code}', '${id}', 'discount', true)")
done

if [ ${#rows[@]} -eq 0 ]; then
  echo
  echo "No codes were created — nothing to register." >&2
  exit 1
fi

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
