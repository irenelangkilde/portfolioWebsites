import { readFileSync } from "fs";
import { resolve } from "path";
import https from "https";
import http from "http";

/** Fetch HTML via Node's http/https module — more tolerant of SSL chain issues than native fetch */
function fetchHtmlNode(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      rejectUnauthorized: false   // tolerate self-signed / incomplete cert chains
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow one redirect
        return fetchHtmlNode(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
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
 * Netlify Function: extractTemplate
 * POST /.netlify/functions/extractTemplate
 * Body: {
 *   templateUrl?:         string,   // HTTP(S) URL to fetch
 *   templateHtmlBase64?:  string,   // base64-encoded HTML file content
 *   templateImageBase64?: string,   // base64-encoded screenshot image
 *   templateImageMime?:   string,   // e.g. "image/png"
 *   provider?:            "claude" | "openai"
 * }
 * Returns: { templateHtml: string, embeddedJson: object|null }
 *
 * Uses raw fetch to avoid esbuild SDK bundling issues.
 * ANTHROPIC_API_KEY_LOCAL / OPENAI_API_KEY_LOCAL bypass Netlify dev's AI gateway proxy.
 */
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" })
    };
  }

  const {
    templateUrl,
    templateHtmlBase64,
    templateImageBase64,
    templateImageMime = "image/png",
    provider = "claude"
  } = body;

  if (!templateUrl && !templateHtmlBase64 && !templateImageBase64) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "One of templateUrl, templateHtmlBase64, or templateImageBase64 is required" })
    };
  }

  // Load the ExtractExampleWebsiteTemplate.md prompt
  const cwd = process.cwd();
  let promptTemplate;
  for (const candidate of [
    resolve(cwd, "src/netlify/functions/ExtractExampleWebsiteTemplate.md"),
    resolve(cwd, "netlify/functions/ExtractExampleWebsiteTemplate.md"),
    resolve(cwd, "ExtractExampleWebsiteTemplate.md"),
  ]) {
    try { promptTemplate = readFileSync(candidate, "utf-8"); break; } catch {}
  }
  if (!promptTemplate) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Could not load ExtractExampleWebsiteTemplate.md" })
    };
  }

  // Resolve input content
  let htmlText = null;
  let imageBase64 = null;
  let imageMime = null;

  if (templateUrl) {
    try {
      // Try native fetch first; fall back to https module if SSL/network issues occur
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
        // Native fetch failed (SSL chain, DNS, etc.) — retry with https module
        htmlText = await fetchHtmlNode(templateUrl);
      }
      if (!htmlText) throw new Error("Empty response from URL");
      const contentType = ""; // already consumed; trust it's HTML if we got here
      void contentType;
    } catch (e) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: `Could not fetch template URL (${templateUrl}): ${e.message}` })
      };
    }
  } else if (templateHtmlBase64) {
    htmlText = Buffer.from(templateHtmlBase64, "base64").toString("utf-8");
  } else {
    imageBase64 = templateImageBase64;
    imageMime = templateImageMime;
  }

  // Truncate very large HTML to avoid exceeding model context
  if (htmlText && htmlText.length > 120000) {
    htmlText = htmlText.slice(0, 120000) + "\n<!-- truncated -->";
  }

  let rawHtml;

  // ── OpenAI path ───────────────────────────────────────────────────────────────
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set." })
      };
    }

    let oaiContent;
    if (imageBase64) {
      oaiContent = [
        { type: "input_image", image_url: `data:${imageMime};base64,${imageBase64}` },
        { type: "input_text", text: "Convert this website screenshot into a portfolio template following the instructions. Return valid HTML only." }
      ];
    } else {
      oaiContent = [
        { type: "input_text", text: htmlText },
        { type: "input_text", text: "Convert this into a portfolio template following the instructions. Return valid HTML only." }
      ];
    }

    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          instructions: promptTemplate,
          input: [{ role: "user", content: oaiContent }],
          max_output_tokens: 16000
        })
      });
      const json = await res.json();
      if (!res.ok) {
        return {
          statusCode: 502,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "OpenAI API error: " + JSON.stringify(json) })
        };
      }
      rawHtml = (json.output_text || "").trim();
    } catch (err) {
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OpenAI fetch error: " + (err.message || String(err)) })
      };
    }
  } else {
    // ── Anthropic / Claude path (default) ──────────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set." })
      };
    }

    let messageContent;
    if (imageBase64) {
      messageContent = [
        { type: "image", source: { type: "base64", media_type: imageMime, data: imageBase64 } },
        { type: "text", text: "Convert this website screenshot into a portfolio template following the instructions. Return valid HTML only." }
      ];
    } else {
      messageContent = [
        { type: "text", text: htmlText },
        { type: "text", text: "Convert this into a portfolio template following the instructions. Return valid HTML only." }
      ];
    }

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 16000,
          system: promptTemplate,
          messages: [{ role: "user", content: messageContent }]
        })
      });
      const json = await res.json();
      if (!res.ok) {
        return {
          statusCode: 502,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "Claude API error: " + JSON.stringify(json) })
        };
      }
      rawHtml = (json.content || [])
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("")
        .trim();
    } catch (err) {
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Claude fetch error: " + (err.message || String(err)) })
      };
    }
  }

  // Extract the embedded JSON comment from near the top of the returned HTML
  let embeddedJson = null;
  const commentMatch = rawHtml.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (commentMatch) {
    try { embeddedJson = JSON.parse(commentMatch[1]); } catch {}
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateHtml: rawHtml, embeddedJson })
  };
}
