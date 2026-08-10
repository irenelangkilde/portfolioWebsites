-- Multi-use gift codes.
--
-- Before: a code carried redeemed_by (one uuid) and redeemed_at, so redemption was
-- single-use by construction — there was nowhere to record a second redeemer.
--
-- After: max_uses / use_count bound how many times a code may be redeemed, and a
-- separate table records who redeemed what. Existing codes are untouched in behaviour:
-- max_uses defaults to 1, and already-redeemed codes are backfilled to use_count = 1,
-- so they read as exhausted exactly as they did before.
--
-- Run this in the Supabase SQL editor. It is idempotent and transactional: if any
-- statement fails, nothing is applied.

begin;

-- ── 1. Usage counters ────────────────────────────────────────────────────────
alter table public.gift_codes
  add column if not exists max_uses  integer not null default 1,
  add column if not exists use_count integer not null default 0;

-- A code can never be redeemed more times than it allows, enforced by the database
-- rather than by the handler alone.
alter table public.gift_codes
  drop constraint if exists gift_codes_use_count_within_max;
alter table public.gift_codes
  add constraint gift_codes_use_count_within_max
  check (use_count >= 0 and use_count <= max_uses);

-- ── 2. Backfill so existing codes keep their current meaning ─────────────────
-- Anything already redeemed is a used-up single-use code.
update public.gift_codes
   set use_count = 1
 where redeemed_at is not null
   and use_count = 0;

-- ── 3. Who redeemed what ─────────────────────────────────────────────────────
-- The composite primary key is the real guard against one person consuming every
-- use of a shared code: a second attempt by the same user violates it, and that
-- cannot be raced the way a read-then-write check in the handler can.
create table if not exists public.gift_code_redemptions (
  gift_code_id uuid        not null references public.gift_codes(id) on delete cascade,
  user_id      uuid        not null references auth.users(id)        on delete cascade,
  redeemed_at  timestamptz not null default now(),
  primary key (gift_code_id, user_id)
);

create index if not exists gift_code_redemptions_user_id_idx
  on public.gift_code_redemptions (user_id);

-- Carry the existing single redemptions across so history is not lost.
insert into public.gift_code_redemptions (gift_code_id, user_id, redeemed_at)
select id, redeemed_by, coalesce(redeemed_at, now())
from public.gift_codes
where redeemed_by is not null
on conflict do nothing;

-- ── 4. Atomic redemption ─────────────────────────────────────────────────────
-- Claiming a use has to be one statement. A read-then-write in the handler lets two
-- simultaneous redemptions of the last remaining use both pass the check.
--
-- Returns the number of uses remaining after a successful claim, or NULL when the
-- code is exhausted. SECURITY DEFINER because only the service role should be able
-- to move the counter.
create or replace function public.claim_gift_code_use(p_gift_code_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.gift_codes
     set use_count = use_count + 1
   where id = p_gift_code_id
     and use_count < max_uses
  returning max_uses - use_count;
$$;

revoke all on function public.claim_gift_code_use(uuid) from public, anon, authenticated;
grant execute on function public.claim_gift_code_use(uuid) to service_role;

-- ── 5. Lock down the new table ───────────────────────────────────────────────
-- Only the service role touches it; the handler runs with the service key.
alter table public.gift_code_redemptions enable row level security;
-- No policies: with RLS on and none defined, anon/authenticated get nothing while
-- the service role continues to bypass RLS.

commit;
