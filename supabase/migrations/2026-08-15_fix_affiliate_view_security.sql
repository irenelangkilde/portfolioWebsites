-- Close a hole in public.affiliate_conversions.
--
-- THE PROBLEM
--
-- purchase_sources and affiliate_codes both have RLS enabled with no policies, so a
-- browser holding the anon key reads nothing from them directly. That was the intent.
--
-- A Postgres view, however, runs as its OWNER unless told otherwise. This view was created
-- by the migration role, so querying it applies that role's permissions rather than the
-- caller's — the RLS on the tables underneath is simply not consulted. And because the
-- view lives in `public`, PostgREST exposes it at /rest/v1/affiliate_conversions with
-- SELECT granted to anon and authenticated by Supabase's defaults.
--
-- The net effect: the anon key, which is published in every page of the site, could read
-- every affiliate conversion — buyer user id, tier, and amount paid. The RLS on the tables
-- was doing nothing to stop it.
--
-- THE FIX, IN TWO INDEPENDENT LAYERS
--
-- 1. security_invoker makes the view run as the CALLER, so the RLS on the underlying
--    tables applies as originally intended: anon and authenticated match no policy and get
--    nothing, while the service role continues to bypass RLS and sees everything.
--
-- 2. Revoking SELECT removes it from PostgREST's reach regardless. Kept as well as (1)
--    rather than instead of it, because they fail differently: a future `create or replace
--    view` silently resets security_invoker, while a grant has to be re-added deliberately.

alter view public.affiliate_conversions set (security_invoker = on);

revoke all on public.affiliate_conversions from anon, authenticated;

-- The service role is what every reporting query should use. It bypasses RLS by design,
-- so this grant is explicit rather than implied.
grant select on public.affiliate_conversions to service_role;

-- ── VERIFY ───────────────────────────────────────────────────────────────────
--
-- Expect security_invoker = true, and no anon/authenticated privileges listed.

select c.relname,
       c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'affiliate_conversions';

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name   = 'affiliate_conversions'
order by grantee;
