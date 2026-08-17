# Open work

Things known to be missing or wrong, with enough context to pick up cold.
Delete an entry when it is done — this file is only useful if it is true.

## Membership expiry: done, archiving still disabled

Sites are delisted when hosting lapses (reconcileHosting nightly, edge serves 410).
Credits expire 18 months after that, the same moment the data becomes archivable, so
hosting_until is the single date the system reasons about. Editor access is deliberately
permanent — opening old work costs nothing; generating new sites is what costs money.

REMAINING: archiving is written but OFF. Set HOSTING_ARCHIVE_ENABLED="true" only after
watching the dry-run logs across several nights and agreeing with every line they name.
It is the only irreversible operation in the system.

Note that a one-time buyer keeps tier and status indefinitely. That is now deliberate
rather than an oversight: their site goes dark and their credits expire, which is what
the money actually pays for.


## Subscription modification is untested against Stripe

modifySubscription.mjs swaps the subscription item onto a new price with a different
interval_count and proration_behavior "none". The intent is: nothing charged today, the
new block length applies at the next renewal.

Stripe can be particular about changing a recurring interval on a live subscription — it
may reset the billing cycle rather than leaving it alone. Verify against a real
subscription that current_period_end does NOT jump forward, and that no invoice is
generated at the moment of the change.

## reconcileHosting is linear in published objects

Ten seconds for 4 domains and 29 slugs, because every blob is read and written individually.
Fine nightly at this scale, and roughly linear — a few thousand published slugs would push
it past a typical function timeout, at which point it fails silently every night.

When that becomes plausible: batch the reads, or narrow the work by querying Supabase for
users whose hosting_until changed since the last run rather than walking every blob.


## Storage allowances are advertised, not enforced

The plan cards promise 10 GB (Graduate) and 100 GB (Prime). Nothing counts bytes per
user and nothing refuses an upload for exceeding them.

Currently honest because it cannot realistically be reached: assets cap at 5 MB each, so
10 GB is roughly two thousand uploads against a plan allowing one site. It stops being
honest the moment anyone approaches it.

Enforcing would need a bytes-per-user tally maintained on upload and delete, a backfill
for existing sites, and checks in the upload and deploy paths. None of that exists — do
not start treating the number as a limit without building it.


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

