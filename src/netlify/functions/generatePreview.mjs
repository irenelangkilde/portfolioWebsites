import OpenAI from "openai";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Netlify Function: generatePreview
 * Input:  { page1: { name, email, phone, major, specialization, linkedin, github, model_template },
 *           page2: { theme: { primary, secondary, tertiary, accent2, accent1 } },
 *           resumeText?: string }
 * Output: { site_html: "<!doctype html>..." }
 *
 * Env var required:
 *   ANTHROPIC_API_KEY=...
 */

function loadPromptTemplate() {
  const cwd = process.cwd();
  //const p0 = resolve(cwd, "src/FirstOutputPrompt.txt");
  const p1 = resolve(cwd, "src/Prompt for Portfolio Website Generation-Claude.txt");
  try { return readFileSync(p1, "utf-8"); } catch {}
  const p2 = resolve(cwd, "FirstOutputPrompt.txt");
  try { return readFileSync(p2, "utf-8"); } catch {}
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
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html.slice(0, 12000);
  } catch {
    return "";
  }
}

export async function handler(event) {
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

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
      primary:   page2?.theme?.primary   || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      tertiary:  page2?.theme?.tertiary  || "#8DE0FF",
      accent2:   page2?.theme?.accent2   || "#0b1220",
      accent1:   page2?.theme?.accent1   || "#eaf0ff"
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
      SAMPLE_WEBSITE_HTML: sampleHtml           || "(No sample website provided)"
    });

    const systemPrompt = "You are an expert portfolio-website generator. Return ONLY a complete standalone HTML file with embedded CSS. No markdown fences, no commentary before or after the HTML. The site must be fully complete — never cut off mid-tag or mid-section.";

    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      max_output_tokens: 7500,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: prompt }
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
