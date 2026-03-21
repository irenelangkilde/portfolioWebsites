import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Netlify Function: analyzeResume
 * POST /.netlify/functions/analyzeResume
 * Body: {
 *   resumePdfBase64: string,
 *   resumeMime?: string,
 *   major?: string,
 *   specialization?: string,
 *   provider?: "claude" | "openai"   // default: "claude"
 * }
 * Returns the structured JSON from extractResumeProfile.md analysis.
 *
 * Uses raw fetch to avoid esbuild SDK bundling issues.
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
    resumePdfBase64,
    resumeMime = "application/pdf",
    major = "",
    specialization = "",
    provider = "claude"
  } = body;

  if (!resumePdfBase64) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "resumePdfBase64 is required" })
    };
  }

  if (!/pdf/i.test(resumeMime || "")) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: `Unsupported file type: ${resumeMime}. Please upload a PDF.` })
    };
  }

  // Load the extractResumeProfile.md prompt
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
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Could not load extractResumeProfile.md" })
    };
  }

  const filledPrompt = promptTemplate
    .replace(/\{\{MAJOR\}\}/g, major)
    .replace(/\{\{SPECIALIZATION\}\}/g, specialization)
    .replace(/\{\{RESUME\}\}/g, "[See the attached PDF document]")
    .replace(/\{\{COPY_OKAY\}\}/g, "")
    .replace(/\{\{SAMPLE_WEBSITE\}\}/g, "")
    .replace(/\{\{COLOR_SCHEME_JSON\}\}/g, "");

  // ── OpenAI path ─────────────────────────────────────────────────────────────
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set." })
      };
    }

    let rawText;
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_file",
                  filename: "resume.pdf",
                  file_data: `data:application/pdf;base64,${resumePdfBase64}`
                },
                {
                  type: "input_text",
                  text: filledPrompt + "\n\nAnalyze this resume according to the instructions above. Return valid JSON only."
                }
              ]
            }
          ],
          max_output_tokens: 8000
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
      rawText = (json.output_text || "").trim();
    } catch (err) {
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OpenAI fetch error: " + (err.message || String(err)) })
      };
    }

    return parseAndRespond(rawText);
  }

  // ── Anthropic / Claude path (default) ────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set." })
    };
  }

  let rawText;
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
        max_tokens: 8000,
        system: filledPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: resumePdfBase64
                }
              },
              {
                type: "text",
                text: "Analyze this resume according to the instructions. Return valid JSON only."
              }
            ]
          }
        ]
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
    rawText = (json.content || [])
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

  return parseAndRespond(rawText);
}

function parseAndRespond(rawText) {
  // Strip markdown code fences — trim first so ^ reliably hits the fence characters
  let cleaned = rawText
    .trim()
    .replace(/^```[a-zA-Z]*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "")
    .trim();

  let json;
  try {
    json = JSON.parse(cleaned);
  } catch {
    // Fallback: find the first { ... } block spanning the full response
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        json = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
    if (!json) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ _parse_error: "Response was not valid JSON", raw_text: rawText })
      };
    }
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(json)
  };
}
