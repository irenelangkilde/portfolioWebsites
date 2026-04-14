var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// generatePreview.mjs
var generatePreview_exports = {};
__export(generatePreview_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(generatePreview_exports);
var import_openai = __toESM(require("openai"), 1);
var import_fs = require("fs");
var import_path = require("path");
function loadPromptTemplate() {
  const cwd = process.cwd();
  const p1 = (0, import_path.resolve)(cwd, "src/Prompt for Portfolio Website Generation-Claude.txt");
  try {
    return (0, import_fs.readFileSync)(p1, "utf-8");
  } catch {
  }
  const p2 = (0, import_path.resolve)(cwd, "FirstOutputPrompt.txt");
  try {
    return (0, import_fs.readFileSync)(p2, "utf-8");
  } catch {
  }
  throw new Error(`Cannot find FirstOutputPrompt.txt. Tried: "${p1}" and "${p2}" (cwd: "${cwd}")`);
}
function fillTemplate(template, vars) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? "");
}
async function fetchSampleHtml(url) {
  if (!url) return "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioBuilder/1.0)" },
      signal: AbortSignal.timeout(8e3)
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html.slice(0, 12e3);
  } catch {
    return "";
  }
}
async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set. Add it to your .env file." })
      };
    }
    const client = new import_openai.default({ apiKey: process.env.OPENAI_API_KEY });
    const { page1 = {}, page2 = {}, resumeText = "" } = JSON.parse(event.body || "{}");
    const PROMPT_TEMPLATE = loadPromptTemplate();
    if (!page1.name || !page1.email) {
      return {
        statusCode: 400,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing required fields: name and email." })
      };
    }
    const theme = {
      primary: page2?.theme?.primary || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      accent: page2?.theme?.accent || "#8DE0FF",
      dark: page2?.theme?.dark || "#0b1220",
      light: page2?.theme?.light || "#eaf0ff"
    };
    const contactInfo = {
      name: page1.name || "",
      email: page1.email || "",
      phone: page1.phone || "",
      linkedin: page1.linkedin || "",
      github: page1.github || ""
    };
    const sampleHtml = await fetchSampleHtml(page1.model_template);
    const prompt = fillTemplate(PROMPT_TEMPLATE, {
      CONTACT_INFO_JSON: JSON.stringify(contactInfo, null, 2),
      NAME: page1.name || "",
      EMAIL: page1.email || "",
      MAJOR: page1.major || "",
      SPECIALIZATION: page1.specialization || "",
      COLOR_SCHEME_JSON: JSON.stringify(theme, null, 2),
      RESUME_TEXT: resumeText || "(Resume not provided)",
      SAMPLE_WEBSITE_HTML: sampleHtml || "(No sample website provided)"
    });
    const systemPrompt = "You are an expert portfolio-website generator. Return ONLY a complete standalone HTML file with embedded CSS. No markdown fences, no commentary before or after the HTML. The site must be fully complete \u2014 never cut off mid-tag or mid-section.";
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      max_output_tokens: 7500,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ]
    });
    if (resp.status === "incomplete") {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Generated HTML was truncated (token limit hit). Try reducing input length." })
      };
    }
    const site_html = resp.output_text;
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_html })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: err?.message || "Unknown error" })
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=generatePreview.js.map
