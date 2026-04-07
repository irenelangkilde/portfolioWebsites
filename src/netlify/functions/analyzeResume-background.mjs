import { readFileSync } from "fs";
import { resolve } from "path";
import { explainBlobStoreError, getPreviewResultsStore } from "./blobStore.mjs";
import { attachProjectIconsToAnalysis } from "./projectIcons.mjs";
import { checkAndIncrementCredits, logUsageEvent } from "./usageQuota.mjs";

/**
 * Netlify Background Function: analyzeResume-background
 * POST /.netlify/functions/analyzeResume-background
 * Body: { jobId, resumePdfBase64, resumeMime?, major?, specialization?, provider? }
 * Returns 202 immediately; result stored in "preview-results" blob under jobId.
 * Poll /.netlify/functions/getPreviewResult?jobId=<id> for { status, ...analysisFields }.
 */
export async function handler(event) {
  let body, jobId, store;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  jobId = body.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing jobId" }) };
  }

  try {
    const { store: previewStore, configError } = getPreviewResultsStore();
    if (!previewStore) {
      return { statusCode: 500, body: JSON.stringify({ error: configError }) };
    }
    store = previewStore;

    await store.set(jobId, JSON.stringify({ status: "pending" }), { ttl: 3600 });

    const {
      resumePdfBase64,
      resumeMime = "application/pdf",
      major = "",
      specialization = "",
      provider = "claude",
      userId = null
    } = body;

    if (!resumePdfBase64) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "resumePdfBase64 is required" }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    if (!/pdf/i.test(resumeMime || "")) {
      await store.set(jobId, JSON.stringify({ status: "error", error: `Unsupported file type: ${resumeMime}. Please upload a PDF.` }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    if (userId) {
      const quota = await checkAndIncrementCredits(userId);
      if (!quota.allowed) {
        await store.set(jobId, JSON.stringify({
          status: "error",
          error: quota.reason,
          quota: true,
          tier: quota.tier,
          used: quota.used,
          limit: quota.limit
        }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    }

    // Load prompt
    const cwd = process.cwd();
    let promptTemplate;
    for (const candidate of [
      resolve(cwd, "src/netlify/functions/extractResumeProfile.md"),
      resolve(cwd, "netlify/functions/extractResumeProfile.md"),
      resolve(cwd, "extractResumeProfile.md"),
    ]) {
      try { promptTemplate = readFileSync(candidate, "utf-8"); break; } catch {}
    }
    if (!promptTemplate) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Could not load extractResumeProfile.md" }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    const filledPrompt = promptTemplate
      .replace(/\{\{MAJOR\}\}/g, major)
      .replace(/\{\{SPECIALIZATION\}\}/g, specialization)
      .replace(/\{\{RESUME\}\}/g, "[See the attached PDF document]")
      .replace(/\{\{COPY_OKAY\}\}/g, "")
      .replace(/\{\{SAMPLE_WEBSITE\}\}/g, "")
      .replace(/\{\{COLOR_SCHEME_JSON\}\}/g, "");

    let rawText;

    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OPENAI_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o",
          input: [{ role: "user", content: [
            { type: "input_file", filename: "resume.pdf", file_data: `data:application/pdf;base64,${resumePdfBase64}` },
            { type: "input_text", text: filledPrompt + "\n\nAnalyze this resume according to the instructions above. Return valid JSON only." }
          ]}],
          max_output_tokens: 16000
        })
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = {}; }
      if (!res.ok) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OpenAI API error: " + text.slice(0, 300) }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      rawText = (json.output_text || "").trim();
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 16000,
          system: filledPrompt,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: resumePdfBase64 } },
              { type: "text", text: "Analyze this resume according to the instructions. Return valid JSON only." }
            ]
          }]
        })
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = {}; }
      if (!res.ok) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Claude API error: " + text.slice(0, 300) }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      rawText = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    }

    // Parse the analysis JSON
    let cleaned = rawText.trim()
      .replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
    let analysisJson;
    try {
      analysisJson = JSON.parse(cleaned);
    } catch {
      const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
      if (first !== -1 && last > first) {
        try { analysisJson = JSON.parse(cleaned.slice(first, last + 1)); } catch {}
      }
    }

    if (!analysisJson) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Response was not valid JSON", raw_text: rawText.slice(0, 500) }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    attachProjectIconsToAnalysis(analysisJson);

    await store.set(jobId, JSON.stringify({ status: "done", ...analysisJson }), { ttl: 3600 });
    await logUsageEvent(userId, {
      event_type: "resume_analysis",
      provider,
      model: provider === "openai" ? "gpt-4o" : "claude-sonnet-4-6",
      success: true
    });
  } catch (err) {
    const msg = explainBlobStoreError(err);
    console.error("analyzeResume-background error:", msg);
    if (store) {
      try {
        await store.set(jobId, JSON.stringify({ status: "error", error: msg }), { ttl: 3600 });
      } catch {}
    }
  }

  return { statusCode: 202 };
}
