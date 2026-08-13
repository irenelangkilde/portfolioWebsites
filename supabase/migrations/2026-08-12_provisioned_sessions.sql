-- One row per Stripe checkout session that has been turned into membership.
--
-- WHY THIS EXISTS
--
-- Two independent paths provision a purchase, by design — the webhook (authoritative,
-- server-to-server) and provisionFromSession (called by purchased.html the moment Stripe
-- redirects back, so the customer is not left staring at an unprovisioned account while a
-- webhook retries).
--
-- Both ran on every purchase. provisionFromSession guarded itself by asking "does this
-- user already have an active paid membership?", which is not the same question as "has
-- this session already been granted": the browser call and the webhook arrive within
-- roughly the same second, so both saw no membership and both granted. Fields assigned
-- outright survived that unharmed; hosting_until stacks, so it doubled — one month paid,
-- two months granted.
--
-- The bug was invisible while the webhook URL was misconfigured and every delivery 404'd.
-- Only one path was running, so the arithmetic looked right. Fixing the URL exposed it.
--
-- The primary key is the race guard. Both paths attempt an insert and check whether they
-- actually created the row; exactly one can win, and only the winner grants. This is the
-- same pattern the multi-use gift codes use, and it holds regardless of ordering, retries
-- or how many times Stripe redelivers.
create table if not exists public.provisioned_sessions (
  stripe_session_id text        primary key,
  user_id           uuid        references auth.users(id) on delete cascade,
  source            text,                    -- 'webhook' | 'client', for diagnosis only
  provisioned_at    timestamptz not null default now()
);

create index if not exists provisioned_sessions_user_idx
  on public.provisioned_sessions (user_id);

-- Service-role only. Both writers run server-side with the service key; no browser
-- should be able to read or forge a claim, since forging one would suppress a real
-- purchase's provisioning.
alter table public.provisioned_sessions enable row level security;
