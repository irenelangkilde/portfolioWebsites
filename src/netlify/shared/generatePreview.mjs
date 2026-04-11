import OpenAI from "openai";
import { SITE_JSON_SCHEMA } from "../shared/siteSchema.mjs";
import { renderHTML } from "../shared/siteRender.mjs";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildPreviewPrompt(page1, page2) {
  const theme = page2?.theme || {};
  return [
    "You generate a DRAFT one-page portfolio site content as JSON, matching the provided JSON schema exactly.",
    "",
    "Inputs (may be incomplete):",
    `Name: ${page1?.name || ""}`,
    `Email: ${page1?.email || ""}`,
    `Phone: ${page1?.phone || ""}`,
    `Major: ${page1?.major || ""}`,
    `Specialization: ${page1?.specialization || ""}`,
    `LinkedIn: ${page1?.linkedin || ""}`,
    "",
    "Color theme (hex):",
    `Primary: ${theme.primary || ""}`,
    `Secondary: ${theme.secondary || ""}`,
    `Tertiary: ${theme.tertiary || ""}`,
    `Accent 2: ${theme.accent2 || ""}`,
    `Accent 1: ${theme.accent1 || ""}`,
    "",
    "Rules:",
    "- Draft should be skimmable, professional, and honest.",
    "- Do NOT fabricate real employers, schools, certifications, or project names. If missing, use placeholders like [University Name], [Project 1], [Metric].",
    "- Headline must be: target role + specialty + value (use placeholders if needed).",
    "- Keep About paragraphs short (1–3).",
    "- Experience and Projects can be placeholders but include measurable-looking bullets with placeholders.",
    "- Output must be ONLY valid JSON that matches the schema."
  ].join("\n");
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    const { page1, page2 } = JSON.parse(event.body || "{}");
    if (!page1?.name || !page1?.email) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields: name and email." }) };
    }

    const theme = {
      primary: page2?.theme?.primary || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      tertiary: page2?.theme?.tertiary || "#8DE0FF",
      accent2: page2?.theme?.accent2 || "#0b1220",
      accent1: page2?.theme?.accent1 || "#eaf0ff"
    };

    const prompt = buildPreviewPrompt(page1, { ...page2, theme });

    const resp = await client.responses.create({
      model: "gpt-5-mini",
      input: [
        { role: "system", content: "You are a portfolio website generator. Return JSON only." },
        { role: "user", content: prompt }
      ],
      text: { format: { type: "json_schema", json_schema: SITE_JSON_SCHEMA } }
    });

    const site_json = JSON.parse(resp.output_text);
    site_json.meta.theme = theme;

    const site_html = renderHTML(site_json);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_json, site_html })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: err?.message || "Unknown error" })
    };
  }
}