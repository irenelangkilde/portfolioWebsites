-- Who signed up recently — for a weekly check on whether the funnel is moving.
--
-- "Signup" means two unrelated things in this schema, and the difference matters when you
-- quote a number to anyone:
--
--   * public.signup_leads — someone gave an email (and maybe a phone) in exchange for a
--     discount code. Not an account. Most of these never become users; that is the point of
--     keeping them out of auth.users. See 2026-08-15_signup_leads.sql.
--   * auth.users — someone actually created an account. Every such row gets a free
--     membership from handle_new_user(), so the join below is expected to always match.
--
-- The two are not nested: a person can be a lead and never a user, a user and never a lead.
-- Adding the counts together double-counts anyone who did both.
--
-- RUN AS THE SERVICE ROLE. signup_leads has RLS enabled with no policies at all — it holds
-- personal contact details and is written only by the function holding the service key. With
-- the anon key these queries return zero rows and no error worth reading. The Supabase SQL
-- editor runs with sufficient privilege.
--
-- ── THE WINDOW ───────────────────────────────────────────────────────────────
--
-- Every query below uses now() - interval '7 days', which is a rolling 7x24 hours ending at
-- the moment you run it. Two other readings of "the past week", if one of them is what you
-- actually mean:
--
--   date_trunc('week', now())   -- since Monday 00:00, a calendar week to date
--   current_date - 6            -- the last seven whole days, ignoring clock time
--
-- created_at is timestamptz and date_trunc/current_date resolve in the session time zone,
-- which is UTC in the SQL editor unless you have changed it. For a report on US activity
-- that boundary lands mid-evening the day before, so say which you used before comparing two
-- weeks against each other.


-- ── 1. LEADS IN THE LAST WEEK ────────────────────────────────────────────────
--
-- The UTM columns are the reason to read this row by row rather than just counting: they say
-- which campaign produced the address, in the same shape as purchase_sources, so a lead that
-- later converts can be traced end to end.
--
-- code is the discount code issued to this person. A null there means the lead was recorded
-- but no code was minted — worth noticing, since the code is what they were promised.

select created_at,
       email,
       phone,
       sms_consent,          -- consent to be TEXTED; separate from emailing the code
       code,
       utm_source,
       utm_medium,
       utm_campaign,
       landing_path,
       referrer_host
from public.signup_leads
where created_at >= now() - interval '7 days'
order by created_at desc;


-- ── 2. ACCOUNT SIGNUPS IN THE LAST WEEK ──────────────────────────────────────
--
-- The left join is deliberately a left join even though handle_new_user() should guarantee a
-- membership row. If a tier comes back null, the trigger did not fire for that user and that
-- is the finding — an inner join would hide exactly the case worth seeing.
--
-- confirmed distinguishes an address someone proved they own from one they typed. An
-- unconfirmed account is not yet a reachable person.

select u.created_at,
       u.email,
       u.email_confirmed_at is not null as confirmed,
       m.tier,
       m.status,
       m.credits_used
from auth.users u
left join public.memberships m on m.user_id = u.id
where u.created_at >= now() - interval '7 days'
order by u.created_at desc;


-- ── 3. LEADS PER DAY ─────────────────────────────────────────────────────────
--
-- current_date - 6 here, not the rolling window, because a bar chart of days should not have
-- a partial day at both ends.
--
-- Days with no leads are absent rather than zero — this reads the table, it does not
-- generate a calendar. If you need the gaps filled, join against
-- generate_series(current_date - 6, current_date, interval '1 day').

select date_trunc('day', created_at)::date as day,
       count(*)                            as leads
from public.signup_leads
where created_at >= current_date - 6
group by 1
order by 1;
