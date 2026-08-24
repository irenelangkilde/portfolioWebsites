-- Register BOOSTPAY10, the postcard-mailer discount.
--
-- Runs ALONGSIDE BOOSTSALARY, which stays live for the signup banner. Two codes on two
-- coupons, distributed through different channels: purchase_sources records which code a
-- sale came through, so a postcard run can be measured against the banner rather than the
-- two being indistinguishable in the takings.
--
-- THE TWO ARE NOT EQUIVALENT, despite both reading "10% off":
--
--   BOOSTSALARY (coupon IOtu9Pkk) — duration FOREVER. 10% off EVERY renewal, for the life of
--                                   the subscription.
--   BOOSTPAY10  (coupon m9I3l6hX) — duration ONCE. 10% off the first payment only.
--
-- A coupon's duration cannot be edited after creation — Stripe allows only name, metadata and
-- currency_options — so making them match would mean deactivating one code and reissuing it
-- against the other's coupon. Left as-is deliberately; see the note further down.
--
--   coupon m9I3l6hX — 10% off, duration ONCE, no redeem_by
--   promo  promo_1U7xJbBgBMKG03IpsZE1IMJL — uncapped, no expiry, first purchase only
--
-- WHY THIS ROW EXISTS AT ALL. claimSignupDiscount issues the code through Stripe directly and
-- never consults this table. But the pricing page's promo box resolves everything through
-- affiliate_codes — so without a row here, a member who typed the code they were given at
-- signup would be told "That code was not recognised" while the banner above showed it to
-- them. BOOSTSALARY was registered for the same reason.
--
-- owner_user_id stays null: this is a house code and pays nobody.

insert into public.affiliate_codes (code, stripe_promotion_code_id, discount_label, active, kind)
values
  ('BOOSTPAY10', 'promo_1U7xJbBgBMKG03IpsZE1IMJL', '10% off', true, 'house')
on conflict (code) do update
  set stripe_promotion_code_id = excluded.stripe_promotion_code_id,
      discount_label           = excluded.discount_label,
      active                   = excluded.active,
      kind                     = excluded.kind;

-- BOOSTSALARY is deliberately left ACTIVE and untouched: it is still the banner code, and
-- STRIPE_PROMO_SIGNUP10 still points at it. Nothing about the banner changes.
--
-- NOTE ON ITS DURATION. BOOSTSALARY discounts EVERY renewal, permanently, while BOOSTPAY10
-- discounts only the first payment. Two codes advertised as "10% off" that mean different
-- things is a difference worth making on purpose rather than by accident — see the header.

-- ── VERIFY ───────────────────────────────────────────────────────────────────

select code, stripe_promotion_code_id, discount_label, active, kind
from public.affiliate_codes
where code in ('BOOSTPAY10', 'BOOSTSALARY');
