/**
 * Trigger a scheduled job on demand.
 *
 * Netlify does not expose scheduled functions over HTTP in production, which is correct —
 * nobody should be able to run your nightly reaper by guessing a URL. But it also means a
 * job cannot be tested without waiting for its next firing, and "wait until 04:00 UTC and
 * hope" is not a way to verify code that deletes things.
 *
 * This calls the same handlers the scheduler does, behind a shared secret.
 *
 * SECURITY
 *
 * Refuses outright when OPS_TRIGGER_SECRET is unset, rather than defaulting to open. An
 * ops endpoint that quietly works without a secret because someone forgot to configure one
 * is worse than no endpoint: it looks protected.
 *
 * Only names in JOBS can be run — the job is selected from a fixed map rather than
 * imported by whatever string arrives, so a crafted request cannot reach an arbitrary
 * module.
 *
 * Usage:
 *   curl -X POST https://resumeto.website/.netlify/functions/runJob \
 *        -H "x-ops-secret: $OPS_TRIGGER_SECRET" \
 *        -H "content-type: application/json" \
 *        -d '{"job":"reconcileHosting"}'
 */

import { getEnv } from "./localEnv.mjs";
import { handler as reconcileHosting } from "./reconcileHosting.mjs";
import { handler as sendRenewalReminders } from "./sendRenewalReminders.mjs";

const JOBS = { reconcileHosting, sendRenewalReminders };

const json = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Length-independent comparison, so timing cannot leak the secret a character at a time. */
function secretMatches(provided, expected) {
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const expected = getEnv("OPS_TRIGGER_SECRET");
  if (!expected) {
    console.error("[runJob] OPS_TRIGGER_SECRET is not set — refusing");
    return json(503, { error: "Not configured." });
  }

  const provided = event.headers?.["x-ops-secret"] || event.headers?.["X-Ops-Secret"];
  if (!secretMatches(provided, expected)) {
    console.warn("[runJob] rejected a request with a bad or missing secret");
    return json(403, { error: "Forbidden." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch {}

  const name = String(body.job || "");
  const job  = Object.prototype.hasOwnProperty.call(JOBS, name) ? JOBS[name] : null;
  if (!job) {
    return json(400, { error: `Unknown job. Available: ${Object.keys(JOBS).join(", ")}` });
  }

  console.log(`[runJob] running ${name}`);
  try {
    const result = await job();
    // The report is the point of running this by hand, so it is passed straight through
    // rather than summarised.
    let report = result?.body;
    try { report = JSON.parse(report); } catch {}
    return json(200, { job: name, statusCode: result?.statusCode ?? null, report });
  } catch (err) {
    console.error(`[runJob] ${name} threw:`, err?.message);
    return json(500, { job: name, error: err?.message });
  }
}
