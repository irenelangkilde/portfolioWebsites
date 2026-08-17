/**
 * Nightly reconciliation of published sites against what customers have paid for.
 *
 * WHY A SCHEDULED JOB RATHER THAN A CHECK AT SERVE TIME
 *
 * The edge function runs on every page view of every published site. Asking Supabase
 * "is this owner still paid up?" there would put a database round trip on the hot path of
 * somebody else's portfolio — the page a recruiter is looking at. So the decision is made
 * here, once a day, and written as a flag onto the domain record the edge already reads.
 * Serving stays a single blob lookup.
 *
 * TWO STAGES, DELIBERATELY UNEQUAL
 *
 *   DELIST   reversible. The site stops being served; everything is still stored. Buying
 *            more months relists it on the next run, and nothing was lost meanwhile.
 *
 *   ARCHIVE  irreversible. Eighteen months after hosting lapsed, the data may be deleted.
 *            This is the only destructive operation in the system, so it is OFF unless
 *            HOSTING_ARCHIVE_ENABLED is explicitly "true". By default the job reports what
 *            it would remove and removes nothing.
 *
 * FAILING OPEN IS THE RULE THROUGHOUT. A membership that cannot be read, a date that will
 * not parse, a lookup that errors — all leave the site exactly as it is. Wrongly taking
 * down a paying customer's portfolio is far worse than serving one for an extra day, and
 * on the archive side the asymmetry is absolute: nothing deleted can be brought back.
 */

import { createClient } from "@supabase/supabase-js";
import { getEnv } from "./localEnv.mjs";
import { getNamedBlobStore } from "./blobStore.mjs";
import { isHostingActive, isArchivable, archiveDate } from "./membershipDates.mjs";

const PUBLISHED_STORE = "published-sites";

function getSupabaseAdmin() {
  return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

export async function handler() {
  const archiveEnabled = getEnv("HOSTING_ARCHIVE_ENABLED") === "true";
  const started = Date.now();

  const report = {
    scanned: 0, delisted: 0, relisted: 0, unchanged: 0,
    archivable: 0, archived: 0, skipped: 0, errors: 0,
    archiveEnabled,
  };

  // getNamedBlobStore returns { store, configError } rather than the store itself — it
  // reports a misconfiguration as a value instead of throwing, so the caller can say
  // something useful about credentials. Assigning the wrapper and calling .list on it is
  // exactly the mistake that produced "store.list is not a function".
  let store, supabase;
  try {
    const opened = getNamedBlobStore(PUBLISHED_STORE);
    if (opened.configError) {
      console.error("[reconcile] blob store unavailable:", opened.configError);
      return { statusCode: 500, body: JSON.stringify({ error: opened.configError }) };
    }
    store    = opened.store;
    supabase = getSupabaseAdmin();
  } catch (err) {
    console.error("[reconcile] could not start:", err?.message);
    return { statusCode: 500, body: JSON.stringify({ error: err?.message }) };
  }

  let keys = [];
  try {
    const listed = await store.list({ prefix: "domain/" });
    keys = (listed?.blobs || []).map(b => b.key);
  } catch (err) {
    console.error("[reconcile] could not list domains:", err?.message);
    return { statusCode: 500, body: JSON.stringify({ error: err?.message }) };
  }

  // One membership lookup per owner, not per domain — someone with five published sites
  // should not cost five queries.
  const hostingByUser = new Map();
  async function hostingUntilFor(userId) {
    if (hostingByUser.has(userId)) return hostingByUser.get(userId);
    let value = null;
    try {
      const { data, error } = await supabase
        .from("memberships")
        .select("hosting_until")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      value = data?.hosting_until ?? null;
    } catch (err) {
      console.warn(`[reconcile] membership lookup failed for ${userId}:`, err?.message);
      value = undefined;   // undefined means "unknown" — distinct from "no hosting"
    }
    hostingByUser.set(userId, value);
    return value;
  }

  for (const key of keys) {
    report.scanned++;
    const domain = key.replace(/^domain\//, "");

    let record;
    try {
      const raw = await store.get(key);
      if (!raw) { report.skipped++; continue; }
      record = JSON.parse(raw);
    } catch (err) {
      console.warn(`[reconcile] unreadable record ${key}:`, err?.message);
      report.errors++;
      continue;
    }

    const userId = record?.user_id;
    if (!userId) {
      // Pre-dates user_id being recorded. There is no owner to check, so leave it alone
      // rather than guessing.
      report.skipped++;
      continue;
    }

    const hostingUntil = await hostingUntilFor(userId);
    if (hostingUntil === undefined) { report.errors++; continue; }   // lookup failed: leave as is

    // No hosting date at all is NOT an expiry. Free-tier sites and anything published
    // before hosting_until was recorded have none, and isHostingActive(null) is false —
    // so treating absent as lapsed would take those sites down on the first run. Absent
    // means "no opinion": leave it exactly as it is.
    if (!hostingUntil) { report.skipped++; continue; }

    const active      = isHostingActive(hostingUntil);
    const wasListed   = record.listed !== false;   // absent means listed
    let   changed     = false;

    if (active && !wasListed) {
      record.listed = true;
      delete record.delisted_at;
      changed = true;
      report.relisted++;
      console.log(`[reconcile] relisting ${domain} — hosting until ${hostingUntil}`);
    } else if (!active && wasListed) {
      record.listed = false;
      record.delisted_at = new Date().toISOString();
      changed = true;
      report.delisted++;
      console.log(`[reconcile] delisting ${domain} — hosting ended ${hostingUntil || "never set"}`);
    } else {
      report.unchanged++;
    }

    // Archival is considered only for sites already delisted and past the retention
    // window. archiveDate() derives that from hosting_until, so the two cannot drift.
    if (!active && hostingUntil && isArchivable(hostingUntil)) {
      report.archivable++;
      if (archiveEnabled) {
        try {
          await store.delete(key);
          report.archived++;
          console.log(`[reconcile] ARCHIVED ${domain} — eligible since ${archiveDate(hostingUntil)}`);
          continue;   // record is gone; nothing to write back
        } catch (err) {
          console.error(`[reconcile] archive failed for ${domain}:`, err?.message);
          report.errors++;
        }
      } else {
        console.log(`[reconcile] would archive ${domain} — eligible since ${archiveDate(hostingUntil)} (dry run)`);
      }
    }

    if (changed) {
      try {
        await store.set(key, JSON.stringify(record));
      } catch (err) {
        console.error(`[reconcile] could not save ${domain}:`, err?.message);
        report.errors++;
      }
    }
  }

  report.ms = Date.now() - started;
  console.log("[reconcile] done:", JSON.stringify(report));
  return { statusCode: 200, body: JSON.stringify(report) };
}
