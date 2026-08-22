-- Give a referral code an owner, so its sales are attributable to a person.
--
-- Attribution runs on affiliate_codes.owner_user_id. A code with no owner still discounts
-- the buyer and still records the sale in purchase_sources, but earns nobody anything —
-- affiliate_conversions requires owner_user_id to be non-null. That is the intended state
-- for a house code like LAUNCHME; it is NOT what you want for a code handed to an affiliate.
--
-- ── THE AFFILIATE NEEDS AN ACCOUNT FIRST ─────────────────────────────────────
--
-- owner_user_id references auth.users, so an affiliate must have signed up on the site
-- before their code can be assigned. There is no way around this and it is the point: the
-- owner id is also what detects self-referral, and a code owned by nobody cannot be checked
-- against the buyer. Ask them to create an account with the email you will pay, then run
-- this with that email.
--
-- ── USAGE ────────────────────────────────────────────────────────────────────
--
-- Edit the two values in the DO block and run. It raises rather than writing if the email
-- has no account or the code does not exist — an unmatched email would otherwise set
-- owner_user_id to null, silently turning an affiliate's code into a house code that pays
-- them nothing, which you would not discover until a payout run came up short.

do $$
declare
  v_email text := 'affiliate@example.com';   -- ← the affiliate's account email
  v_code  text := 'SHAREMETFHTJ';            -- ← the code to assign to them
  v_user  uuid;
begin
  select id into v_user
  from auth.users
  where lower(email) = lower(v_email);

  if v_user is null then
    raise exception 'No account for %. Have them sign up first, then re-run.', v_email;
  end if;

  update public.affiliate_codes
     set owner_user_id = v_user
   where upper(code) = upper(v_code);

  if not found then
    raise exception 'No affiliate code %. Check the spelling against affiliate_codes.', v_code;
  end if;

  raise notice 'Assigned % to % (%)', v_code, v_email, v_user;
end $$;

-- ── VERIFY ───────────────────────────────────────────────────────────────────
--
-- Every code and who earns from it. A null owner means "house code, pays nobody" — check
-- that the ones listed that way are the ones you meant.

select ac.code,
       ac.discount_label,
       ac.active,
       ac.expires_at,
       u.email as owner_email,
       case when ac.owner_user_id is null then 'house code — pays nobody' else 'affiliate' end as kind
from public.affiliate_codes ac
left join auth.users u on u.id = ac.owner_user_id
order by kind, ac.code;
