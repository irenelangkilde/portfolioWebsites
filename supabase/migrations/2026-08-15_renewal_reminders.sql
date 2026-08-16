-- Marker for the pre-expiry renewal reminder.
--
-- Stores WHICH expiry the reminder was sent about, not merely when it was sent.
--
-- A timestamp alone answers "have we emailed this person?", which is the wrong question.
-- The right one is "have we emailed them about the expiry they are currently facing?" —
-- because when someone renews, hosting_until moves forward and they become due for a
-- reminder again months later. A "last sent" timestamp would either suppress that second
-- reminder forever or need an arbitrary cooldown that guesses at the billing period.
--
-- Comparing this against the current hosting_until makes the rule exact: send when they
-- differ, skip when they match. Renewal changes hosting_until, which re-arms the reminder
-- automatically with no cleanup step.
alter table public.memberships
  add column if not exists renewal_reminder_for timestamptz;

comment on column public.memberships.renewal_reminder_for is
  'The hosting_until value a renewal reminder was last sent about. Differs from the current hosting_until when a reminder is due.';
