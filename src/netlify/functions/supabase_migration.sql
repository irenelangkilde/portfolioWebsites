-- ============================================================
-- Portfolio Generator — Supabase schema migration
-- Run this in: Supabase dashboard → SQL Editor → New query
-- ============================================================


-- ── 1. memberships ──────────────────────────────────────────
-- One row per user. Tracks their tier and AI-call credit quota.
-- 1 unit = 5 credits + 1 download/deploy

-- Tier limits:
--   free                 — 5 credits, 0 downloads  (preview; no purchase)
--   basic                — 5 credits, 1 download   ($7 one-time; 1 unit)
--   premium              — N×5 credits, N downloads (N units purchased)
--     premium_monthly_new: graduated $19/11/7/5/4/2.95 per unit; no auto-renewal
--     premium_monthly_sub: 50% off (month 2+), auto-renewing subscription
--     premium_annual:      $99/year; 120 credits, downloads_limit=-1 (unlimited downloads)

create table if not exists public.memberships (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  tier                 text not null default 'free'
                         check (tier in ('free', 'basic', 'premium')),
  status               text not null default 'active'
                         check (status in ('active', 'cancelled', 'expired')),
  credits_used         integer not null default 0,
  credits_limit        integer not null default 5,      -- -1 = unlimited; overridden on upgrade
  downloads_used       integer not null default 0,
  downloads_limit      integer not null default 0,      -- 0 = none (free); -1 = unlimited
  stripe_customer_id      text,
  stripe_subscription_id  text,
  stripe_payment_intent   text,                         -- for one-time purchases
  current_period_end      timestamptz,                  -- null for one-time tiers
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id)
);

-- Auto-create a free membership row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.memberships (user_id, tier, credits_limit, downloads_limit)
  values (new.id, 'free', 5, 0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Keep updated_at current
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger memberships_updated_at
  before update on public.memberships
  for each row execute procedure public.set_updated_at();


-- ── 2. usage_events ─────────────────────────────────────────
-- One row per billable AI call. Lets you audit spend and enforce quotas.

create table if not exists public.usage_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  event_type    text not null
                  check (event_type in (
                    'resume_analysis',
                    'job_extraction',
                    'content_strategy',
                    'bridge',
                    'generation',
                    'template_extraction'
                  )),
  provider      text,        -- 'claude' | 'openai'
  model         text,        -- e.g. 'claude-sonnet-4-6'
  input_tokens  integer,
  output_tokens integer,
  success       boolean not null default true,
  error_message text,
  created_at    timestamptz not null default now()
);

create index if not exists usage_events_user_id_idx on public.usage_events (user_id);
create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);


-- ── 3. saved_sessions ───────────────────────────────────────
-- Stores the full form payload so users can regenerate later
-- (new resume, different job target, different colors).

create table if not exists public.saved_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  label        text,                  -- user-visible name, e.g. "Google SWE — March 2026"
  form_payload jsonb not null,        -- full form state: resume facts, job, colors, template
  site_html    text,                  -- last generated HTML (nullable — set after generation)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists saved_sessions_user_id_idx on public.saved_sessions (user_id);

create trigger saved_sessions_updated_at
  before update on public.saved_sessions
  for each row execute procedure public.set_updated_at();


-- ── 4. Row Level Security ────────────────────────────────────
-- Users can only read/write their own rows.
-- Service role (used by Netlify functions) bypasses RLS entirely.

alter table public.memberships     enable row level security;
alter table public.usage_events    enable row level security;
alter table public.saved_sessions  enable row level security;

-- memberships
create policy "users read own membership"
  on public.memberships for select
  using (auth.uid() = user_id);

create policy "users update own membership"
  on public.memberships for update
  using (auth.uid() = user_id);

-- usage_events (insert only from service role / functions; users can read their own)
create policy "users read own usage"
  on public.usage_events for select
  using (auth.uid() = user_id);

-- saved_sessions
create policy "users read own sessions"
  on public.saved_sessions for select
  using (auth.uid() = user_id);

create policy "users insert own sessions"
  on public.saved_sessions for insert
  with check (auth.uid() = user_id);

create policy "users update own sessions"
  on public.saved_sessions for update
  using (auth.uid() = user_id);

create policy "users delete own sessions"
  on public.saved_sessions for delete
  using (auth.uid() = user_id);
