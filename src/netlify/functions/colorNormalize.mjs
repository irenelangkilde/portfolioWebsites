/**
 * Netlify Function: colorNormalize
 * POST /.netlify/functions/colorNormalize
 * Body: { htmlBase64: string }
 * Returns: { html: string, k: number, alreadyNormalized: boolean }
 *
 * Runs the deterministic color-normalization pipeline (extract clusters,
 * inject <style id="extracted-theme"> + <script id="color-palette">, rewrite
 * hex/rgba to var(--c-N) references) on user-supplied HTML.
 *
 * Idempotent: if the input is already normalized, the output is functionally
 * identical (cluster reps may shift if the color set changed).
 *
 * No AI, no background queue — runs synchronously, expects < a few seconds.
 */
import { normalizeColorsInHtml } from "../../../scripts/preprocessSamples.mjs";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function isAlreadyNormalized(html) {
  // The marker injected by buildPaletteJson — only present when normalization has run.
  return /<script[^>]*id=["']color-palette["']/i.test(String(html || ""));
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResponse(400, { error: "Invalid JSON body" }); }

  if (!body.htmlBase64) return jsonResponse(400, { error: "htmlBase64 is required" });

  let html;
  try { html = Buffer.from(body.htmlBase64, "base64").toString("utf-8"); }
  catch { return jsonResponse(400, { error: "htmlBase64 could not be decoded" }); }

  if (!html) return jsonResponse(400, { error: "decoded HTML is empty" });

  const alreadyNormalized = isAlreadyNormalized(html);

  try {
    const { html: out, k } = normalizeColorsInHtml(html);
    return jsonResponse(200, { html: out, k, alreadyNormalized });
  } catch (err) {
    return jsonResponse(500, { error: err?.message || String(err) });
  }
}
