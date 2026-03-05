import OpenAI from "openai";
import JSZip from "jszip";
import { SITE_JSON_SCHEMA } from "../shared/siteSchema.mjs";
import { renderHTML } from "../shared/siteRender.mjs";

function buildZipPrompt(page1, page2) {
  // You can reuse the same prompt as preview; often identical is fine.
  const theme = page2?.theme || {};
  return [
    "Generate a one-page portfolio site as JSON matching the schema exactly.",
    "Be concise and skimmable.",
    "Do not fabricate real employers/schools/projects; use placeholders if missing.",
    "",
    `Name: ${page1?.name || ""}`,
    `Email: ${page1?.email || ""}`,
    `Phone: ${page1?.phone || ""}`,
    `Major: ${page1?.major || ""}`,
    `Specialization: ${page1?.specialization || ""}`,
    `LinkedIn: ${page1?.linkedin || ""}`,
    "",
    "Theme:",
    `Primary: ${theme.primary || ""}`,
    `Secondary: ${theme.secondary || ""}`,
    `Accent: ${theme.accent || ""}`,
    `Dark: ${theme.dark || ""}`,
    `Light: ${theme.light || ""}`,
    "",
    "Return JSON only."
  ].join("\n");
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set. Add it to your .env file or Netlify environment variables." })
      };
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { page1, page2 } = JSON.parse(event.body || "{}");
    if (!page1?.name || !page1?.email) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields: name and email." }) };
    }

    const theme = {
      primary: page2?.theme?.primary || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      accent: page2?.theme?.accent || "#8DE0FF",
      dark: page2?.theme?.dark || "#0b1220",
      light: page2?.theme?.light || "#eaf0ff"
    };

    const prompt = buildZipPrompt(page1, { ...page2, theme });

    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "You are a portfolio website generator. Return JSON only." },
        { role: "user", content: prompt }
      ],
      text: { format: { type: "json_schema", json_schema: SITE_JSON_SCHEMA } }
    });

    const site_json = JSON.parse(resp.output_text);
    site_json.meta.theme = theme;
    const indexHtml = renderHTML(site_json);

    const zip = new JSZip();
    zip.file("index.html", indexHtml);
    zip.file("site.json", JSON.stringify(site_json, null, 2));
    zip.file(
      "README.txt",
      [
        "Portfolio site package",
        "",
        "Publish in 2 minutes:",
        "1) Unzip this folder.",
        "2) Netlify → Add new site → Deploy manually.",
        "3) Drag the unzipped folder into Netlify.",
        "",
        "Or GitHub Pages:",
        "1) Commit index.html to a repo.",
        "2) Enable Pages on the main branch.",
      ].join("\n")
    );

    const zipData = await zip.generateAsync({ type: "nodebuffer" });

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="portfolio-site.zip"'
      },
      body: zipData.toString("base64"),
      isBase64Encoded: true
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: err?.message || "Unknown error" })
    };
  }
}