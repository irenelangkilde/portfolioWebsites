-- Register a referral/affiliate code.
--
-- Run this once per code you mint in Stripe. It links the string a buyer types on the
-- Pricing page to the Stripe promotion code that actually applies the discount.
--
-- Registered so far:
--   LAUNCHME → promo_1U3nGmBgBMKG03Ip8DEI7fzm  (15% off, public, 15 redemptions)
--   TESTING  → promo_1U3na3BgBMKG03IpMxpQ3zwr  (15% off, internal — deactivate when done)
--
-- ── THE TWO VALUES EACH CODE NEEDS ───────────────────────────────────────────
--
--   code         The string buyers type, e.g. 'LAUNCHME'. Case-insensitive on lookup
--                (there is a unique index on upper(code)), so pick one and stay with it.
--
--   promo_id     The Stripe PROMOTION CODE id — starts with "promo_".
--
--                NOT the coupon id, which looks like a short random string or whatever
--                you named it. A coupon defines the discount; a promotion code is the
--                redeemable handle attached to it, and it is the promotion code that
--                createCheckoutSession passes to Stripe. Supplying a coupon id here
--                produces a checkout that fails at the Stripe call, after the buyer has
--                already committed — the worst place to discover a typo.
--
--                To find it: Stripe Dashboard → Product catalogue → Coupons → open your
--                15% coupon → the "Promotion codes" list at the bottom → click the code.
--                The id is shown on that page and appears in the URL.
--
-- Why this table exists rather than just enabling Stripe's own promo-code box: the two
-- are mutually exclusive. Stripe rejects a session that sets both `discounts` and
-- `allow_promotion_codes`, and owning the input is what lets the page validate the code,
-- explain what it gives, and detect a self-referral before payment.

insert into public.affiliate_codes (code, stripe_promotion_code_id, discount_label, active)
values
  -- Public launch discount. Capped at 15 redemptions in Stripe; the app additionally
  -- allows one discounted purchase per account, so that is 15 distinct customers.
  ('LAUNCHME', 'promo_1U3nGmBgBMKG03Ip8DEI7fzm', '15% off', true),

  -- Internal, for exercising the referral path end to end. Named the most guessable
  -- thing possible, so it should not outlive the testing: set active = false when done,
  -- or give the Stripe promotion code an expires_at. Flipping active here is enough —
  -- resolveReferralCode refuses an inactive code before Stripe is ever consulted.
  ('TESTING',  'promo_1U3na3BgBMKG03IpMxpQ3zwr', '15% off (test)', true)

on conflict (code) do update
  set stripe_promotion_code_id = excluded.stripe_promotion_code_id,
      discount_label           = excluded.discount_label,
      active                   = excluded.active;

-- owner_user_id is left null on purpose: this is a general launch code, not one issued to
-- a specific affiliate. Set it only for a code owned by a person, which is what makes
-- self-referral detection meaningful — resolveReferralCode compares the buyer's id to it
-- and flags a match rather than silently letting someone discount their own purchase.
--
-- expires_at is null, so the code runs until active is set to false. Stripe can also
-- expire the promotion code independently; if the two disagree, Stripe wins at checkout
-- and the buyer sees a Stripe error rather than this app's friendlier message. Keeping
-- the deactivation in both places avoids that.

-- Verify:
select code, stripe_promotion_code_id, discount_label, active, expires_at
from public.affiliate_codes
order by created_at desc;
