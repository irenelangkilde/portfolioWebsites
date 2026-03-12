import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";
import { PROMPT_TEMPLATE } from "../shared/promptTemplate.mjs";

/**
 * Netlify Background Function: generatePreview-background
 * Netlify returns 202 immediately; this function runs for up to 15 minutes.
 * Result is stored in a Netlify Blob keyed by jobId.
 * Poll /.netlify/functions/getPreviewResult?jobId=<id> for the result.
 */

function fillTemplate(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? "");
}

async function fetchSampleHtml(url) {
  if (!url) return "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioBuilder/1.0)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 12000);
  } catch {
    return "";
  }
}

export async function handler(event) {
  const store = getStore("preview-results");
  let jobId;

  try {
    const body = JSON.parse(event.body || "{}");
    jobId = body.jobId;

    if (!jobId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing jobId" }) };
    }

    // Write pending status immediately so the poller knows the function started
    await store.set(jobId, JSON.stringify({ status: "pending" }), { ttl: 3600 });

    const { page1 = {}, page2 = {}, resumeText = "" } = body;

    if (!page1.name || !page1.email) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Missing required fields: name and email." }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set." }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const theme = {
      primary:   page2?.theme?.primary   || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      accent:    page2?.theme?.accent    || "#8DE0FF",
      dark:      page2?.theme?.dark      || "#0b1220",
      light:     page2?.theme?.light     || "#eaf0ff"
    };

    const contactInfo = {
      name:     page1.name     || "",
      email:    page1.email    || "",
      phone:    page1.phone    || "",
      linkedin: page1.linkedin || "",
      github:   page1.github   || ""
    };

    const sampleHtml = await fetchSampleHtml(page1.model_template);

    const prompt = fillTemplate(PROMPT_TEMPLATE, {
      CONTACT_INFO_JSON:   JSON.stringify(contactInfo, null, 2),
      NAME:                page1.name           || "",
      EMAIL:               page1.email          || "",
      MAJOR:               page1.major          || "",
      SPECIALIZATION:      page1.specialization || "",
      COLOR_SCHEME_JSON:   JSON.stringify(theme, null, 2),
      RESUME_TEXT:         resumeText           || "(Resume not provided)",
      SAMPLE_WEBSITE_HTML: sampleHtml           || "(No sample website provided)",
      HEADSHOT_PHOTO:      page1.headshot        || "(No headshot provided)"
    });

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: "You are an expert portfolio-website generator. Return ONLY a complete standalone HTML file with embedded CSS. No markdown fences, no commentary before or after the HTML. The site must be fully complete — never cut off mid-tag or mid-section.",
      messages: [{ role: "user", content: prompt }]
    });

    if (msg.stop_reason === "max_tokens") {
      await store.set(jobId, JSON.stringify({
        status: "error",
        error: "Generated HTML was truncated (max_tokens limit hit)."
      }), { ttl: 3600 });
    } else {
      await store.set(jobId, JSON.stringify({
        status: "done",
        site_html: msg.content[0].text
      }), { ttl: 3600 });
    }
  } catch (err) {
    if (jobId) {
      await store.set(jobId, JSON.stringify({
        status: "error",
        error: err?.message || "Unknown error"
      }), { ttl: 3600 });
    }
  }

  return { statusCode: 202 };
}
