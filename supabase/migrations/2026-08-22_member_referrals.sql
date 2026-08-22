-- Per-member referral codes, and the credits they earn.
--
-- Every signed-in member gets their own SHAREME code. A lead who uses it gets 15% off their
-- first purchase; the member who owns it earns bonus credits when that purchase completes.
--
-- Run in the Supabase SQL editor. Transactional and idempotent.

begin;

-- ── 1. Tell personal codes apart from house codes ────────────────────────────
--
-- Both live in affiliate_codes and both have an owner, so owner_user_id alone cannot
-- distinguish them — a member could also be handed a SHAREME sharing code. `kind` is what
-- lets the pricing page ask for "this member's own code" and get exactly one row.
--
-- Defaults to 'house' so every existing row keeps its current meaning.
alter table public.affiliate_codes
  add column if not exists kind text not null default 'house';

do $$
begin
  alter table public.affiliate_codes
    add constraint affiliate_codes_kind_chk check (kind in ('house', 'personal'));
exception when duplicate_object then null;
end $$;

-- One personal code per member, enforced by the database rather than by the minting code.
-- The mint is called on sign-in, so two tabs signing in at once race; a partial unique index
-- makes the loser's insert fail instead of quietly giving somebody two codes.
create unique index if not exists affiliate_codes_one_personal_per_owner
  on public.affiliate_codes (owner_user_id)
  where kind = 'personal';

create index if not exists affiliate_codes_owner_idx
  on public.affiliate_codes (owner_user_id);

-- ── 2. Rewards ledger ────────────────────────────────────────────────────────
--
-- One row per converted checkout session, and stripe_session_id is the PRIMARY KEY rather
-- than merely indexed. That is the whole point of the table: Stripe retries webhooks, and
-- credits granted by an UPDATE are not idempotent — a retried delivery would mint free
-- credits every time it arrived. The insert must fail on the second attempt.
--
-- It also doubles as the audit trail. "Why do I have 14 credits" is answerable by selecting
-- from here, which a bare counter on memberships could never do.
create table if not exists public.referral_rewards (
  stripe_session_id text        primary key,
  owner_user_id     uuid        not null references auth.users(id) on delete cascade,
  buyer_user_id     uuid        references auth.users(id) on delete set null,
  affiliate_code_id uuid        references public.affiliate_codes(id) on delete set null,
  code              text,                                  -- denormalised, survives a code deletion
  credits_granted   integer     not null default 1,
  amount_total      integer,                               -- cents of the sale that earned it
  created_at        timestamptz not null default now()
);

create index if not exists referral_rewards_owner_idx   on public.referral_rewards (owner_user_id);
create index if not exists referral_rewards_created_idx on public.referral_rewards (created_at);

-- ── 3. Granting a credit, atomically ─────────────────────────────────────────
--
-- Ledger row and credit bump in ONE statement each, inside one function, so they cannot
-- half-happen. Doing this as two calls from the webhook would leave a window where the
-- ledger says granted and the balance disagrees — and the ledger is what stops a retry, so
-- that window loses the member a credit permanently.
--
-- Returns true if a credit was granted, false if this session had already been rewarded.
-- The caller treats false as success: it means the guard worked.
create or replace function public.grant_referral_reward(
  p_session_id text,
  p_owner_user_id uuid,
  p_buyer_user_id uuid,
  p_affiliate_code_id uuid,
  p_code text,
  p_credits integer,
  p_amount_total integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.referral_rewards
    (stripe_session_id, owner_user_id, buyer_user_id, affiliate_code_id, code, credits_granted, amount_total)
  values
    (p_session_id, p_owner_user_id, p_buyer_user_id, p_affiliate_code_id, p_code, p_credits, p_amount_total)
  on conflict (stripe_session_id) do nothing;

  if not found then
    return false;   -- already rewarded; a webhook retry
  end if;

  -- credits_limit, not credits_used: the reward RAISES the ceiling. Writing to credits_used
  -- would spend the member's quota instead of extending it.
  --
  -- -1 means unlimited, and adding to it would turn an unlimited plan into a 0-credit one.
  update public.memberships
     set credits_limit = credits_limit + p_credits
   where user_id = p_owner_user_id
     and credits_limit >= 0;

  return true;
end $$;

revoke all on function public.grant_referral_reward(text, uuid, uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.grant_referral_reward(text, uuid, uuid, uuid, text, integer, integer) to service_role;

-- ── 4. Lock the ledger down ──────────────────────────────────────────────────
--
-- Same reasoning as purchase_sources: it ties a person to a purchase amount. Only the
-- service role reads it, and the function above is security definer so the webhook can
-- write through it without a policy.
alter table public.referral_rewards enable row level security;

commit;

-- ── VERIFY ───────────────────────────────────────────────────────────────────

select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'affiliate_codes' and column_name = 'kind';

select count(*) as reward_rows from public.referral_rewards;
