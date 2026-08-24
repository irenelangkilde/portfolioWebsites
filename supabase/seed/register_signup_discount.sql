-- Register BOOSTPAY10, the postcard-mailer discount.
--
-- Runs ALONGSIDE BOOSTSALARY, which stays live for the signup banner. Two codes on two
-- coupons, distributed through different channels: purchase_sources records which code a
-- sale came through, so a postcard run can be measured against the banner rather than the
-- two being indistinguishable in the takings.
--
-- Both are 10% off, duration ONCE, uncapped, no expiry, first purchase only:
--
--   BOOSTSALARY (coupon dJwd0ado, promo_1U7xJQBgBMKG03Ipks8nsV0q) — signup banner
--   BOOSTPAY10  (coupon m9I3l6hX, promo_1U7xJbBgBMKG03IpsZE1IMJL) — postcard mailer
--
-- Identical terms on purpose. They differ only by where they were handed out, which is the
-- only way a postcard run can be compared against the banner rather than the two blurring
-- together in the takings.
--
-- A coupon's duration cannot be edited after creation — Stripe allows only name, metadata and
-- currency_options — which is why the FOREVER original had to be replaced rather than amended.
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

-- ── BOOSTSALARY, REPOINTED ───────────────────────────────────────────────────
--
-- The original BOOSTSALARY (promo_1U4sYx…, coupon IOtu9Pkk) was duration FOREVER and is now
-- deactivated in Stripe. It was replaced by a new promotion code of the same name on coupon
-- dJwd0ado — 10% off, duration ONCE, uncapped, no expiry, first purchase only, matching
-- BOOSTPAY10 exactly. The two codes now mean the same thing and differ only by channel,
-- which is what makes comparing a postcard run against the banner meaningful.
--
-- THIS UPDATE IS NOT OPTIONAL. The row still carries the OLD promo id, which Stripe now
-- refuses. Without it a buyer types BOOSTSALARY, this table validates it and promises 10%
-- off, and Stripe then rejects the session — after they have committed to a total. Pointing
-- the row at the live id is what closes that gap.
update public.affiliate_codes
   set stripe_promotion_code_id = 'promo_1U7xJQBgBMKG03Ipks8nsV0q',
       discount_label           = '10% off',
       active                   = true,
       kind                     = 'house'
 where code = 'BOOSTSALARY';

-- ── VERIFY ───────────────────────────────────────────────────────────────────

select code, stripe_promotion_code_id, discount_label, active, kind
from public.affiliate_codes
where code in ('BOOSTPAY10', 'BOOSTSALARY');
