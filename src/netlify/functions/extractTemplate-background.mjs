import { readFileSync } from "fs";
import { resolve } from "path";
import https from "https";
import http from "http";
import { getStore } from "@netlify/blobs";

/** Fetch HTML via Node's http/https module — tolerant of SSL chain issues */
function fetchHtmlNode(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      rejectUnauthorized: false
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtmlNode(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve(body));
    });
    req.setTimeout(20000, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

/**
 * Netlify Background Function: extractTemplate-background
 * POST /.netlify/functions/extractTemplate-background
 * Body: { jobId, templateUrl?, templateHtmlBase64?, templateImageBase64?, templateImageMime?, provider? }
 * Returns 202 immediately; result stored in "preview-results" blob under jobId.
 * Poll /.netlify/functions/getPreviewResult?jobId=<id> for { status, templateHtml, embeddedJson }.
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
    store = getStore({
      name: "preview-results",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    await store.set(jobId, JSON.stringify({ status: "pending" }), { ttl: 3600 });

    const {
      templateUrl,
      templateHtmlBase64,
      templateImageBase64,
      templateImageMime = "image/png",
      templateJsonStr,
      major = "",
      specialization = "",
      provider = "claude",
      templateMode = "analysis"   // "analysis" | "mustache"
    } = body;

    if (!templateUrl && !templateHtmlBase64 && !templateImageBase64 && !templateJsonStr) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "One of templateUrl, templateHtmlBase64, templateImageBase64, or templateJsonStr is required" }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    // Load prompt — ConstructTemplate for image/JSON, ExtractMustacheTemplate for mustache mode, else EEWT
    const useConstructTemplate = !!(templateImageBase64 || templateJsonStr);
    let promptFileName;
    if (useConstructTemplate) {
      promptFileName = "ConstructTemplate.md";
    } else if (templateMode === "mustache") {
      promptFileName = "ExtractMustacheTemplate.md";
    } else {
      promptFileName = "ExtractExampleWebsiteTemplate.md";
    }
    const cwd = process.cwd();
    let promptTemplate;
    for (const candidate of [
      resolve(cwd, `src/netlify/functions/${promptFileName}`),
      resolve(cwd, `netlify/functions/${promptFileName}`),
      resolve(cwd, promptFileName),
    ]) {
      try { promptTemplate = readFileSync(candidate, "utf-8"); break; } catch {}
    }
    if (!promptTemplate) {
      await store.set(jobId, JSON.stringify({ status: "error", error: `Could not load ${promptFileName}` }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    // Substitute placeholders used by the various prompt templates
    // {{MAJOR}} / {{SPECIALIZATION}} used by ConstructTemplate.md
    // {{EXAMPLE_HTML}} used by ExtractMustacheTemplate.md (resolved after htmlText is known)
    promptTemplate = promptTemplate
      .replace(/\{\{MAJOR\}\}/g, major)
      .replace(/\{\{SPECIALIZATION\}\}/g, specialization);

    // Resolve input content
    let htmlText = null;
    let imageBase64 = null;
    let imageMime = null;

    if (templateJsonStr) {
      htmlText = templateJsonStr; // AI prompt handles "if the input is json"
    } else if (templateUrl) {
      try {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 20000);
          const res = await fetch(templateUrl, {
            signal: controller.signal,
            redirect: "follow",
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Cache-Control": "no-cache"
            }
          });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          htmlText = await res.text();
        } catch {
          htmlText = await fetchHtmlNode(templateUrl);
        }
        if (!htmlText) throw new Error("Empty response from URL");
      } catch (e) {
        await store.set(jobId, JSON.stringify({ status: "error", error: `Could not fetch template URL (${templateUrl}): ${e.message}` }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    } else if (templateHtmlBase64) {
      htmlText = Buffer.from(templateHtmlBase64, "base64").toString("utf-8");
    } else {
      imageBase64 = templateImageBase64;
      imageMime = templateImageMime;
    }

    if (htmlText && htmlText.length > 120000) {
      htmlText = htmlText.slice(0, 120000) + "\n<!-- truncated -->";
    }

    // ExtractMustacheTemplate.md embeds the HTML inline via {{EXAMPLE_HTML}}
    if (templateMode === "mustache" && htmlText) {
      promptTemplate = promptTemplate.replace("{{EXAMPLE_HTML}}", htmlText);
    }

    let rawHtml;

    if (provider === "openai") {
      const apiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OPENAI_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      // mustache mode: HTML already embedded in promptTemplate via {{EXAMPLE_HTML}}
      const oaiContent = imageBase64
        ? [
            { type: "input_image", image_url: `data:${imageMime};base64,${imageBase64}` },
            { type: "input_text", text: "Convert this website screenshot into a portfolio template following the instructions. Return valid HTML only." }
          ]
        : templateMode === "mustache"
        ? [{ type: "input_text", text: "Convert the example HTML into a Mustache template per the instructions. Return valid HTML only." }]
        : [
            { type: "input_text", text: htmlText },
            { type: "input_text", text: "Convert this into a portfolio template following the instructions. Return valid HTML only." }
          ];
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", "authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({ model: "gpt-4o", instructions: promptTemplate, input: [{ role: "user", content: oaiContent }], max_output_tokens: 16000 })
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = {}; }
      if (!res.ok) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OpenAI API error: " + text.slice(0, 300) }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      rawHtml = (json.output_text || "").trim();
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      // mustache mode: HTML already embedded in promptTemplate via {{EXAMPLE_HTML}}
      const messageContent = imageBase64
        ? [
            { type: "image", source: { type: "base64", media_type: imageMime, data: imageBase64 } },
            { type: "text", text: "Convert this website screenshot into a portfolio template following the instructions. Return valid HTML only." }
          ]
        : templateMode === "mustache"
        ? [{ type: "text", text: "Convert the example HTML into a Mustache template per the instructions. Return valid HTML only." }]
        : [
            { type: "text", text: htmlText },
            { type: "text", text: "Convert this into a portfolio template following the instructions. Return valid HTML only." }
          ];
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 16000, system: promptTemplate, messages: [{ role: "user", content: messageContent }] })
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = {}; }
      if (!res.ok) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Claude API error: " + text.slice(0, 300) }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      rawHtml = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    }

    let embeddedJson = null;
    const commentMatch = rawHtml.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
    if (commentMatch) { try { embeddedJson = JSON.parse(commentMatch[1]); } catch {} }

    await store.set(jobId, JSON.stringify({ status: "done", templateHtml: rawHtml, embeddedJson }), { ttl: 3600 });
  } catch (err) {
    const msg = err?.message || "Unknown error";
    console.error("extractTemplate-background error:", msg);
    if (store) {
      try {
        await store.set(jobId, JSON.stringify({ status: "error", error: msg }), { ttl: 3600 });
      } catch {}
    }
  }

  return { statusCode: 202 };
}
