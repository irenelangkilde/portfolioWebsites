-- Backfill hosting_until for memberships that have none.
--
-- WHY THIS IS NEEDED
--
-- reconcileHosting skips any site whose owner has no hosting_until, because an absent date
-- means "no opinion" rather than "expired" — treating absent as lapsed would have taken
-- down every account predating the field. That safety leaves those accounts permanently
-- outside the lifecycle: never delisted, credits never expiring.
--
-- Giving them a real date brings them into it.
--
-- ── RUN THIS FIRST, AND READ IT ──────────────────────────────────────────────
-- Nothing below the preview is reversible in any useful sense: once a date is written you
-- cannot tell which rows you wrote it to.

select tier,
       status,
       count(*)                                as rows_affected,
       min(created_at)                         as oldest_account
from public.memberships
where hosting_until is null
group by tier, status
order by tier;

-- ── THE BACKFILL ─────────────────────────────────────────────────────────────
--
-- Scoped to PAID tiers on purpose.
--
-- Free accounts have downloads_limit = 0 — they cannot deploy a site — so for them a null
-- hosting_until is correct rather than missing: there is nothing published to host. Giving
-- them 18 months would grant hosting they cannot use, and would start a clock that expires
-- credits on accounts that never bought anything.
--
-- To include free accounts anyway, delete the `and tier in (...)` line. Consider instead
-- whether provisionFreeTier should stop writing null, which is where new ones keep coming
-- from — a backfill alone patches the past and leaks again tomorrow.

update public.memberships
   set hosting_until = now() + interval '18 months'
 where hosting_until is null
   and tier in ('graduate', 'prime');

-- ── VERIFY ───────────────────────────────────────────────────────────────────
--
-- Expect: no paid rows left with a null date, and the free rows untouched.

select tier,
       count(*)                                          as total,
       count(*) filter (where hosting_until is null)     as still_null,
       min(hosting_until)                                as earliest_expiry
from public.memberships
group by tier
order by tier;

-- What the lifecycle will now do with these accounts:
--   in 18 months          their published site is delisted (410, data kept)
--   in 36 months          their credits expire
--   in 36 months          their data becomes archivable — deletion still requires
--                         HOSTING_ARCHIVE_ENABLED="true", which is not set
