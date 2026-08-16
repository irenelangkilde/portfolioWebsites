-- People who traded contact details for a discount code.
--
-- Separate from auth.users on purpose: giving an email and phone is not creating an
-- account, and most of these will never become users. Folding them into memberships would
-- mean inventing a half-account with no password and no session.
--
-- email is unique on lower(email) because the code is the payment for the contact details.
-- Without it the same person could take a fresh 10% code as often as they liked by
-- retyping their address, and each one would be a real Stripe promotion code.
--
-- The issued code is recorded here as well as in affiliate_codes so that a lead can be
-- given their code again — people lose emails — without minting a second one.
create table if not exists public.signup_leads (
  id                       uuid        primary key default gen_random_uuid(),
  email                    text        not null,
  phone                    text,

  -- Consent to be TEXTED, which is a separate question from consent to be emailed a code
  -- they asked for. US TCPA rules treat marketing SMS as requiring express opt-in, so this
  -- is stored as its own fact rather than assumed from the presence of a phone number.
  sms_consent              boolean     not null default false,
  sms_consent_at           timestamptz,

  code                     text,        -- the discount code issued to this person
  stripe_promotion_code_id text,

  -- Where they came from, same shape as purchase_sources, so a lead that converts can be
  -- traced end to end.
  utm_source               text,
  utm_medium               text,
  utm_campaign             text,
  landing_path             text,
  referrer_host            text,

  created_at               timestamptz not null default now()
);

create unique index if not exists signup_leads_email_idx
  on public.signup_leads (lower(email));

create index if not exists signup_leads_created_idx
  on public.signup_leads (created_at);

-- Service-role only. This table holds personal contact details and must never be readable
-- from a browser; the function that writes it runs with the service key.
alter table public.signup_leads enable row level security;
