-- What each affiliate earned, for a payout run.
--
-- Reads public.affiliate_conversions, which already applies the eligibility rule: the sale
-- was attributed to a code, that code has an owner, and the buyer was not the owner. So
-- nothing here re-checks those — if a sale is missing from this report, the reason is in
-- purchase_sources, not in this query.
--
-- RUN AS THE SERVICE ROLE. The view is security_invoker and anon/authenticated have no
-- grant, deliberately — it exposes buyer ids and amounts. The Supabase SQL editor runs with
-- sufficient privilege; a client using the anon key will get nothing back and no error worth
-- reading. See 2026-08-15_fix_affiliate_view_security.sql for why.
--
-- ── COMMISSION RATE IS NOT SET ───────────────────────────────────────────────
--
-- v_rate below is a placeholder, not a decision. Nothing in the app or the database encodes
-- what an affiliate earns, so this reports gross attributed revenue and multiplies by a rate
-- you supply here. Set it to whatever you have actually agreed with affiliates before paying
-- from this.
--
-- Note it is applied to amount_total, which is what STRIPE CHARGED — i.e. after the 15%
-- discount the buyer received, and inclusive of any tax Stripe added. If you mean to pay
-- commission on the undiscounted price, or to exclude tax, this is the line to change and
-- the distinction is worth settling before the first payout rather than after.

-- ── PER AFFILIATE ────────────────────────────────────────────────────────────

with params as (select 0.20::numeric as v_rate)   -- ← 20% placeholder. Set your real rate.
select u.email                                     as affiliate,
       count(*)                                    as sales,
       sum(ac.amount_total) / 100.0                as gross_usd,
       round(sum(ac.amount_total) * p.v_rate / 100.0, 2) as commission_usd,
       min(ac.created_at)                          as first_sale,
       max(ac.created_at)                          as latest_sale
from public.affiliate_conversions ac
cross join params p
join auth.users u on u.id = ac.owner_user_id
-- Uncomment to bound a payout period. Without it this is all-time, which will double-pay
-- anyone you have already settled with.
-- where ac.created_at >= '2026-09-01' and ac.created_at < '2026-10-01'
group by u.email, p.v_rate
order by commission_usd desc;

-- ── PER CODE ─────────────────────────────────────────────────────────────────
--
-- Which of the ten SHAREME handles actually converted. This is the question the ten separate
-- codes exist to answer — one code would have discounted the same sales and told you
-- nothing about whose sharing produced them.

select ac.code,
       u.email       as owner,
       count(*)      as sales,
       sum(ac.amount_total) / 100.0 as gross_usd
from public.affiliate_conversions ac
join auth.users u on u.id = ac.owner_user_id
group by ac.code, u.email
order by sales desc, ac.code;

-- ── SALES THAT EARNED NOTHING, AND WHY ───────────────────────────────────────
--
-- Deliberately separate from the report above, because a missing commission is a support
-- question and "it is not in the payout list" is not an answer. Covers the three ways an
-- attributed sale drops out: no owner on the code, the buyer was the owner, or the code
-- string was recorded but never matched a row in affiliate_codes.

select ps.created_at,
       ps.ref_code,
       ps.tier,
       ps.amount_total / 100.0 as usd,
       case
         when ps.affiliate_code_id is null then 'code not registered in affiliate_codes'
         when ps.self_referred            then 'buyer owns the code — self-referral'
         when ac.owner_user_id is null    then 'house code — no owner to pay'
       end as why_no_commission
from public.purchase_sources ps
left join public.affiliate_codes ac on ac.id = ps.affiliate_code_id
where ps.ref_code is not null
  and (ps.affiliate_code_id is null or ps.self_referred or ac.owner_user_id is null)
order by ps.created_at desc;
