import { getStore } from "@netlify/blobs";

/**
 * Netlify Function: getPreviewResult
 * GET /.netlify/functions/getPreviewResult?jobId=<id>
 * Returns: { status: "pending" | "done" | "error", site_html?, error? }
 */

export async function handler(event) {
  const jobId = event.queryStringParameters?.jobId;

  if (!jobId) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Missing jobId" })
    };
  }

  try {
    const store = getStore({
      name: "preview-results",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });
    const result = await store.get(jobId);

    if (!result) {
      // Not written yet — background function hasn't started or finished yet
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "pending" })
      };
    }

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: result
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: err?.message || "Unknown error" })
    };
  }
}
