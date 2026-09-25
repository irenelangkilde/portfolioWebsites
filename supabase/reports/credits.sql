-- Who has credits left — for answering "can this person still generate?" and for seeing
-- how much of what people bought they have actually used.
--
-- There is no remaining-credits column. The pair that exists is:
--
--   * credits_limit — what the account is ALLOTTED. Set by the tier at provisioning and
--     raised later by referral rewards (see 2026-08-22_member_referrals.sql, which is
--     careful to raise the limit rather than discount credits_used).
--   * credits_used  — a counter incremented once per generation by
--     checkAndConsumeCredit() in usageQuota.mjs. It is never decremented.
--
-- Remaining is the difference, with the three corrections below applied. Computing it any
-- other way will eventually produce a number that does not match what the app enforces.
--
-- RUN AS THE SERVICE ROLE. memberships has RLS with a "users read own membership" policy,
-- so an ordinary authenticated key returns exactly one row — that user's own — and the
-- anon key returns none. Neither errors; both just quietly under-report. The Supabase SQL
-- editor runs with sufficient privilege.
--
-- ── THE THREE CORRECTIONS ─────────────────────────────────────────────────────
--
-- 1. credits_limit = -1 MEANS UNLIMITED, not minus one. premium_annual sets it (as do
--    downloads_limit and deploys_limit, where 0 means none and -1 means unlimited). A bare
--    credits_limit - credits_used reports a large negative remainder for the best
--    customers on the system. Every query below returns null for them instead, which keeps
--    sum() and avg() honest — those skip nulls — but not ORDER BY, hence `nulls last`.
--
-- 2. THE DIFFERENCE CAN GO NEGATIVE. credits_used is never decremented and a downgrade can
--    lower credits_limit beneath it, so greatest(…, 0) is load-bearing, not cosmetic.
--
-- 3. REMAINING IS NOT THE ONLY GATE. Credits expire 18 months after hosting lapsed — the
--    same moment the published site becomes deletable, so hosting_until stays the single
--    date the system reasons about (usageQuota.mjs, DELETION_GRACE_MONTHS in
--    membershipDates.mjs). An account can show 4 remaining and still be refused. A null
--    hosting_until expires nothing: free-tier accounts and anything predating that column
--    have none, and reading absent as expired would lock out every one of them.


-- ── 1. CREDITS PER ACCOUNT ────────────────────────────────────────────────────
--
-- The left join is deliberately a left join. handle_new_user() should give every user in
-- auth.users a membership row, so a null tier here means the trigger did not fire for that
-- account — an inner join would hide the one case worth finding.
--
-- Ordered by what is left, so the accounts about to hit the wall come first.

select u.email,
       m.tier,
       m.status,
       m.credits_limit                                  as credits_allotted,
       m.credits_used,
       case when m.credits_limit = -1 then null          -- unlimited: no finite remainder
            else greatest(m.credits_limit - m.credits_used, 0)
       end                                              as credits_remaining,
       m.hosting_until is not null
         and m.hosting_until + interval '18 months' <= now() as credits_expired
from auth.users u
left join public.memberships m on m.user_id = u.id
order by credits_remaining asc nulls last, u.email;


-- ── 2. THE SAME THING PER TIER ────────────────────────────────────────────────
--
-- Reads memberships directly rather than through auth.users: this is about what each tier
-- consumes, and an account with no membership row belongs to no tier. Use query 1 to find
-- those.
--
-- `exhausted` counts accounts the credit check would refuse today on the count alone. It
-- deliberately ignores expiry — expired accounts are counted separately below, because the
-- two have different remedies: one needs an upgrade, the other needs any purchase at all.

select m.tier,
       count(*)                                                   as accounts,
       sum(m.credits_used)                                        as credits_used,
       sum(case when m.credits_limit = -1 then null
                else greatest(m.credits_limit - m.credits_used, 0) end) as credits_remaining,
       count(*) filter (where m.credits_limit = -1)                as unlimited_accounts,
       count(*) filter (where m.credits_limit <> -1
                          and m.credits_used >= m.credits_limit)   as exhausted,
       count(*) filter (where m.hosting_until is not null
                          and m.hosting_until + interval '18 months' <= now()) as expired
from public.memberships m
group by m.tier
order by m.tier;


-- ── 3. ACCOUNTS THE CREDIT CHECK WOULD REFUSE RIGHT NOW ───────────────────────
--
-- The operational version of the two queries above: everyone who would be turned away if
-- they clicked Generate today, and which of the two reasons applies. Both reasons are
-- recoverable by a purchase, so this is the list worth emailing.
--
-- Mirrors the order of checks in checkAndConsumeCredit(): expiry is tested before the
-- count, so an account that is both expired and out of credits reports as expired.

select u.email,
       m.tier,
       m.credits_used,
       m.credits_limit as credits_allotted,
       m.hosting_until,
       case when m.hosting_until is not null
                 and m.hosting_until + interval '18 months' <= now()
            then 'expired'
            else 'out of credits'
       end as refusal_reason
from public.memberships m
join auth.users u on u.id = m.user_id
where (m.hosting_until is not null and m.hosting_until + interval '18 months' <= now())
   or (m.credits_limit <> -1 and m.credits_used >= m.credits_limit)
order by refusal_reason, u.email;
