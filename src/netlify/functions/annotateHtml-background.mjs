/**
 * Netlify Function: annotateHtml-background
 * POST /.netlify/functions/annotateHtml-background
 * Body: { htmlBase64: string, jobId: string }
 * Returns 202 immediately; result is stored in the "preview-results" blob store under jobId.
 * Poll /.netlify/functions/getPreviewResult?jobId=<id> for { status, html, error }.
 *
 * Adds data-* attributes to an HTML document via the AnnotateTemplate.md Claude prompt.
 * Used by the editor when the user opens an HTML file that lacks annotation
 * (e.g. an arbitrary sample.html) and opts in to AI annotation.
 *
 * Color values in the input are preserved (the prompt explicitly forbids changing them),
 * so the editor can then run colorNormalize.mjs on the result if needed.
 */

import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { getPreviewResultsStore } from "./blobStore.mjs";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 32000;
const PROMPT_FILE = "AnnotateTemplate.md";

function loadPromptFile(filename) {
  const cwd = process.cwd();
  let here = null;
  try { here = dirname(fileURLToPath(import.meta.url)); } catch {}
  const candidates = [
    resolve(cwd, `src/netlify/functions/${filename}`),
    resolve(cwd, `netlify/functions/${filename}`),
    resolve(cwd, filename),
  ];
  if (here) candidates.unshift(resolve(here, filename));
  for (const candidate of candidates) {
    try { return readFileSync(candidate, "utf-8"); } catch {}
  }
  throw new Error(`Could not load prompt: ${filename}`);
}

function cleanHtml(text) {
  return String(text || "")
    .replace(/^```[a-zA-Z]*\r?\n?/m, "")
    .replace(/\r?\n?```\s*$/m, "")
    .trim();
}

export async function handler(event) {
  let body, jobId, store;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) }; }

  jobId = body.jobId;
  if (!jobId) return { statusCode: 400, body: JSON.stringify({ error: "Missing jobId" }) };

  const { htmlBase64 } = body;
  if (!htmlBase64) return { statusCode: 400, body: JSON.stringify({ error: "Missing htmlBase64" }) };

  try {
    const { store: previewStore, configError } = getPreviewResultsStore();
    if (!previewStore) {
      return { statusCode: 500, body: JSON.stringify({ error: configError || "Blob store unavailable" }) };
    }
    store = previewStore;

    await store.set(jobId, JSON.stringify({ status: "pending", stage: "Annotating with AI…" }), { ttl: 3600 });

    let html;
    try { html = Buffer.from(htmlBase64, "base64").toString("utf-8"); }
    catch {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Could not decode htmlBase64" }), { ttl: 3600 });
      return { statusCode: 202 };
    }
    if (!html || !html.trim()) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Decoded HTML is empty" }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    if (html.length > 120000) {
      html = html.slice(0, 120000) + "\n<!-- truncated -->";
    }

    const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set on this deploy." }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    const promptTemplate = loadPromptFile(PROMPT_FILE);
    const prompt = promptTemplate.includes("{{NORMALIZED_HTML}}")
      ? promptTemplate.replace("{{NORMALIZED_HTML}}", html)
      : `${promptTemplate}\n\n──────────────────────────────────────────────\nHTML TO ANNOTATE\n──────────────────────────────────────────────\n\n${html}`;

    let claudeBody;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: "You are a web template engineer. Add data-* attributes to the HTML per the instructions. Output only the annotated HTML. No markdown fences. No explanation.",
          messages: [{ role: "user", content: prompt }],
        }),
      });
      claudeBody = await res.text();
      if (!res.ok) {
        await store.set(jobId, JSON.stringify({ status: "error", error: `Claude API error: ${claudeBody.slice(0, 300)}` }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    } catch (err) {
      await store.set(jobId, JSON.stringify({ status: "error", error: `Claude API request failed: ${err?.message || String(err)}` }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    let parsed;
    try { parsed = JSON.parse(claudeBody); } catch { parsed = {}; }
    const annotated = cleanHtml(
      (parsed.content || [])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("")
    );

    if (!annotated.toLowerCase().startsWith("<!doctype") && !annotated.toLowerCase().startsWith("<html")) {
      await store.set(jobId, JSON.stringify({
        status: "error",
        error: `Annotation output doesn't look like HTML. First 200 chars: ${annotated.slice(0, 200)}`,
      }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    await store.set(jobId, JSON.stringify({
      status: "done",
      html: annotated,
      usage: parsed.usage || null,
    }), { ttl: 3600 });
    return { statusCode: 202 };
  } catch (err) {
    const msg = err?.message || String(err);
    if (store) {
      try { await store.set(jobId, JSON.stringify({ status: "error", error: msg }), { ttl: 3600 }); } catch {}
    }
    return { statusCode: 500, body: JSON.stringify({ error: msg }) };
  }
}
