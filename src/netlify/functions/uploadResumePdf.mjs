import { explainBlobStoreError, getPreviewImagesStore } from "./blobStore.mjs";

/**
 * POST /.netlify/functions/uploadResumePdf
 * Body: { jobId: "...", resumePdfBase64: "..." }
 *
 * Stores the base64-encoded PDF in the preview-images blob store under
 * key `resume:<jobId>` and returns { ok: true, key }.
 *
 * Why this exists: Netlify rejects background-function POSTs above ~150 KB
 * at the platform layer with an opaque "Internal Error. ID: …" 500 before
 * the function runs. A base64 resume PDF is typically 100–250 KB, so we
 * upload it here first, then invoke `buildWebsite-background` with only a
 * small reference key instead of the full base64 payload.
 */
export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const jobId = String(body.jobId || "").trim();
    const resumePdfBase64 = String(body.resumePdfBase64 || "");
    if (!jobId) {
      return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Missing jobId" }) };
    }
    if (!resumePdfBase64) {
      return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Missing resumePdfBase64" }) };
    }
    const { store, configError } = getPreviewImagesStore();
    if (!store) {
      return { statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: configError || "Blob store unavailable" }) };
    }
    const key = `resume:${jobId}`;
    await store.set(key, resumePdfBase64, { ttl: 3600 });
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, key })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: explainBlobStoreError(err) || err?.message || String(err) })
    };
  }
}
