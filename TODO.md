# Open work

Things known to be missing or wrong, with enough context to pick up cold.
Delete an entry when it is done — this file is only useful if it is true.

## Membership lifecycle: complete and verified in production

Reminder, delist, credit expiry and archive all exercised against real data on 2026-08-17:
a reminder email sent and confirmed idempotent, 3 domains and 13 slugs delisted with the
410 page confirmed on both resumeto.website and webresu.me, then 3 mappings and 13 slugs
deleted with zero errors.

HOSTING_DELETE_ENABLED should be left "false" between deliberate uses. Nothing else is
near the 18-month threshold, so leaving the destructive path armed buys nothing and means
the next deletion happens unattended.

Two bugs this testing found, both now fixed: /u/:slug bypassed delisting entirely, and
deletion deleted only the domain mapping while leaving the html, images and meta.


## Note: the Stripe subscription API is not the Checkout API

modifySubscription now works, but took three attempts, each from assuming the two APIs
behave alike. They diverge on product handling in ways that never appear when creating a
session:

  price_data.product_data   accepted by Checkout, REJECTED by subscriptions.update, which
                            wants price_data.product (an existing id).
  archived products         Checkout happily invents a product per purchase; those get
                            archived over time, and subscriptions.update then refuses them
                            with "marked as inactive".

The function now verifies the product is active and creates a replacement when it is not.
Worth remembering before writing anything else against subscriptions by analogy with
checkout.


## reconcileHosting is linear in published objects

An alert now fires by email at 1000 slugs or a 20s run, whichever comes first — once,
then never again until ops/scale-warning-sent.json is deleted from the published-sites
store. So this item does not depend on anyone remembering to check.

Ten seconds for 4 domains and 29 slugs, because every blob is read and written individually.
Fine nightly at this scale, and roughly linear — a few thousand published slugs would push
it past a typical function timeout, at which point it fails silently every night.

When that becomes plausible: batch the reads, or narrow the work by querying Supabase for
users whose hosting_until changed since the last run rather than walking every blob.


## Storage: enforced, with a delete path

Allowances enforced on upload (1 GB free / 10 GB Graduate / 100 GB Prime), one-shot email
on the first refusal, and the Add/replace media dialog can now delete an uploaded file and
return the space.

Remaining rough edge: deleting a file does not remove the image from the page, which will
show broken until replaced. That is deliberate — silently editing the document from a
dialog is worse — but a "delete and clear" variant would be kinder.

Also: assets are content-hashed and therefore shared. One upload can back several
published versions, and deleting it takes them all. The confirm says so; nothing enforces
it.

Published HTML is still not counted toward the allowance: different store, kilobytes
against a gigabyte.


## Volume discount is plumbed but not set

`src/planPricing.mjs` supports a per-month tier ladder and both the page and the charge
compute from it. The numbers are still flat at $7 and $12. Lowering `extra` beneath the
early tiers is all that is required — the displayed total, the savings line and the amount
charged all follow.

## Conversions API not wired

Only the browser pixel reports to Meta, so ad blockers and iOS eat a share of conversions.
`stripeWebhook.mjs` already knows every payment server-side, which is a better signal.

`Purchase` already carries the Stripe session id as `eventID`, so the server copy can be
deduplicated against the browser one. **Sending it without that shared id would double every
conversion**, which looks like success while poisoning the optimiser.

