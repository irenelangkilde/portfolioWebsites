var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// analyzeResume.mjs
var analyzeResume_exports = {};
__export(analyzeResume_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(analyzeResume_exports);
var import_fs = require("fs");
var import_path = require("path");
async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
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
  const cwd = process.cwd();
  let promptTemplate;
  for (const candidate of [
    (0, import_path.resolve)(cwd, "src/netlify/functions/extractResumeProfile.md"),
    (0, import_path.resolve)(cwd, "netlify/functions/extractResumeProfile.md"),
    (0, import_path.resolve)(cwd, "extractResumeProfile.md")
  ]) {
    try {
      promptTemplate = (0, import_fs.readFileSync)(candidate, "utf-8");
      break;
    } catch {
    }
  }
  if (!promptTemplate) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Could not load extractResumeProfile.md" })
    };
  }
  const filledPrompt = promptTemplate.replace(/\{\{MAJOR\}\}/g, major).replace(/\{\{SPECIALIZATION\}\}/g, specialization).replace(/\{\{RESUME\}\}/g, "[See the attached PDF document]").replace(/\{\{COPY_OKAY\}\}/g, "").replace(/\{\{SAMPLE_WEBSITE\}\}/g, "").replace(/\{\{COLOR_SCHEME_JSON\}\}/g, "");
  if (provider === "openai") {
    const apiKey2 = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
    if (!apiKey2) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set." })
      };
    }
    let rawText2;
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey2}`
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
          max_output_tokens: 8e3
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
      rawText2 = (json.output_text || "").trim();
    } catch (err) {
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OpenAI fetch error: " + (err.message || String(err)) })
      };
    }
    return parseAndRespond(rawText2);
  }
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
        max_tokens: 8e3,
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
    rawText = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
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
  let cleaned = rawText.trim().replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
  let json;
  try {
    json = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        json = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {
      }
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=analyzeResume.js.map
