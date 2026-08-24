-- Register BOOSTPAY10, the signup-banner discount.
--
-- Replaces BOOSTSALARY, which sat on a coupon with duration FOREVER — 10% off every renewal
-- for the life of the subscription, rather than a one-time welcome discount. Nobody had
-- redeemed it, so the swap cost nothing. A coupon's duration cannot be edited after creation
-- (Stripe allows only name, metadata and currency_options), which is why this is a new
-- coupon and a new code rather than an amendment.
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

-- Retire the old one HERE, but only after STRIPE_PROMO_SIGNUP10 points at the new promo id
-- and that deploy is live. Until then the banner still hands out BOOSTSALARY, and refusing it
-- in this table would tell those people their code is invalid.
update public.affiliate_codes set active = false where code = 'BOOSTSALARY';

-- ── VERIFY ───────────────────────────────────────────────────────────────────

select code, stripe_promotion_code_id, discount_label, active, kind
from public.affiliate_codes
where code in ('BOOSTPAY10', 'BOOSTSALARY');
