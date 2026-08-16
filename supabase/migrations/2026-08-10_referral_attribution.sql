-- Referral codes and purchase-source attribution.
--
-- Two tables, deliberately separate from gift_codes: a gift code GRANTS a tier, a
-- referral code DISCOUNTS a purchase and credits a third party. Overloading one table
-- would mean every query had to know which kind it was looking at.
--
-- Run in the Supabase SQL editor. Transactional and idempotent.

begin;

-- ── 1. Referral codes ────────────────────────────────────────────────────────
-- `code` is the human-facing string (store UPPERCASE — lookups uppercase their input).
-- `stripe_promotion_code_id` is the promo_… id created in Stripe; that is what actually
-- applies the discount, so this table never computes money.
-- `owner_user_id` is nullable so house codes (LAUNCH10) can exist with no affiliate.
create table if not exists public.affiliate_codes (
  id                       uuid primary key default gen_random_uuid(),
  code                     text        not null unique,
  owner_user_id            uuid        references auth.users(id) on delete set null,
  stripe_promotion_code_id text        not null,
  discount_label           text,                        -- e.g. "10% off", for UI copy
  active                   boolean     not null default true,
  expires_at               timestamptz,
  created_at               timestamptz not null default now()
);

-- Lookups are always by uppercase code.
create unique index if not exists affiliate_codes_code_upper_idx
  on public.affiliate_codes (upper(code));

-- ── 2. Purchase source attribution ───────────────────────────────────────────
-- One row per completed checkout. Deliberately wider than "which affiliate": it also
-- records utm_* and landing path, so it is useful before any affiliate exists and the
-- affiliate case is one source among several.
--
-- stripe_session_id is unique because Stripe RETRIES webhooks — the insert must be
-- idempotent or a retried delivery duplicates the row.
create table if not exists public.purchase_sources (
  id                 uuid primary key default gen_random_uuid(),
  stripe_session_id  text        not null unique,
  user_id            uuid        references auth.users(id) on delete set null,

  ref_code           text,                                    -- as typed/captured
  affiliate_code_id  uuid        references public.affiliate_codes(id) on delete set null,
  self_referred      boolean     not null default false,      -- buyer owns the code

  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  landing_path       text,
  referrer_host      text,

  promotion_code     text,                                    -- what Stripe actually applied
  tier               text,
  amount_total       integer,                                 -- cents, as Stripe reports
  currency           text,
  created_at         timestamptz not null default now()
);

create index if not exists purchase_sources_affiliate_idx on public.purchase_sources (affiliate_code_id);
create index if not exists purchase_sources_user_idx      on public.purchase_sources (user_id);
create index if not exists purchase_sources_created_idx   on public.purchase_sources (created_at);

-- ── 3. Commission-eligible sales ─────────────────────────────────────────────
-- A view rather than a column so the rule lives in one place: attributed to a code,
-- with an owner, and not self-referred. Payout runs read this.
-- security_invoker is set by a later migration (2026-08-15_fix_affiliate_view_security).
-- A view runs as its OWNER by default, which meant this one bypassed the RLS on the tables
-- it reads and exposed buyer ids and amounts to the anon key via PostgREST. If this view is
-- ever recreated, set security_invoker again — create or replace silently drops it.
create or replace view public.affiliate_conversions as
select ps.id,
       ps.created_at,
       ac.code,
       ac.owner_user_id,
       ps.user_id       as buyer_user_id,
       ps.tier,
       ps.amount_total,
       ps.currency
from public.purchase_sources ps
join public.affiliate_codes ac on ac.id = ps.affiliate_code_id
where ps.self_referred = false
  and ac.owner_user_id is not null;

-- ── 4. Lock both tables down ─────────────────────────────────────────────────
-- Only the service role touches them; every writer is a Netlify function using the
-- service key, which bypasses RLS. With RLS on and no policies, anon/authenticated
-- get nothing — important, since these rows tie a person to a purchase amount.
alter table public.affiliate_codes  enable row level security;
alter table public.purchase_sources enable row level security;

commit;
