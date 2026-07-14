import { getPreviewResultsStore } from "./blobStore.mjs";

/**
 * POST /.netlify/functions/testBackground-background
 * Body: { jobId: "..." }
 *
 * Bare-bones diagnostic to confirm Netlify's background-function invocation
 * itself works for this project. Writes a "done" record to the preview-results
 * blob store so the client can poll for it. If this fires and produces the
 * blob write, the runtime is healthy — the crash in buildWebsite-background is
 * happening deeper in that function's code, not at the platform layer.
 */
export async function handler(event) {
  console.log("[testBackground] handler entered");
  try {
    const body = JSON.parse(event.body || "{}");
    const jobId = body.jobId || `test_${Date.now()}`;
    const { store } = getPreviewResultsStore();
    if (!store) {
      console.error("[testBackground] no store");
      return { statusCode: 202, body: "" };
    }
    await store.set(jobId, JSON.stringify({
      status: "done",
      test: true,
      timestamp: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
    }), { ttl: 3600 });
    console.log(`[testBackground] wrote done record for ${jobId}`);
  } catch (err) {
    console.error("[testBackground] threw:", err?.stack || err?.message || err);
  }
  return { statusCode: 202, body: "" };
}
