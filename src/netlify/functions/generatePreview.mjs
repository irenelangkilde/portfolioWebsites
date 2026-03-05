import OpenAI from "openai";

/**
 * Netlify Function: generatePreview
 * Input: { page1: {...}, page2: {...} }
 * Output: { site_json: {...}, site_html: "<!doctype html>..." }
 *
 * Env var required:
 *   OPENAI_API_KEY=...
 */
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- 1) Define a strict JSON schema for the preview draft ----
const SITE_JSON_SCHEMA = {
  name: "portfolio_site_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          headline: { type: "string" },
          subtitle: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          linkedin: { type: "string" },
          major: { type: "string" },
          specialization: { type: "string" },
          theme: {
            type: "object",
            additionalProperties: false,
            properties: {
              primary: { type: "string" },
              secondary: { type: "string" },
              accent: { type: "string" },
              dark: { type: "string" },
              light: { type: "string" }
            },
            required: ["primary", "secondary", "accent", "dark", "light"]
          }
        },
        required: ["name", "headline", "subtitle", "email", "phone", "linkedin", "major", "specialization", "theme"]
      },
      sections: {
        type: "object",
        additionalProperties: false,
        properties: {
          about: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
          education: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                degree: { type: "string" },
                institution: { type: "string" },
                date: { type: "string" },
                details: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 }
              },
              required: ["degree", "institution", "date", "details"]
            },
            minItems: 1,
            maxItems: 2
          },
          experience: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                org: { type: "string" },
                date: { type: "string" },
                bullets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 }
              },
              required: ["title", "org", "date", "bullets"]
            },
            minItems: 1,
            maxItems: 3
          },
          projects: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                link: { type: "string" },
                date: { type: "string" },
                bullets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 }
              },
              required: ["name", "link", "date", "bullets"]
            },
            minItems: 1,
            maxItems: 3
          },
          skills: {
            type: "object",
            additionalProperties: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              maxItems: 10
            }
          },
          certifications: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8 },
          cta: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              button_label: { type: "string" },
              button_href: { type: "string" }
            },
            required: ["text", "button_label", "button_href"]
          }
        },
        required: ["about", "education", "experience", "projects", "skills", "certifications", "cta"]
      }
    },
    required: ["meta", "sections"]
  }
};

// ---- 2) Deterministic HTML render (no model HTML) ----
function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function renderList(items) {
  const safe = (items || []).map(x => `<li>${escapeHTML(x)}</li>`).join("");
  return `<ul>${safe}</ul>`;
}

function renderCards(items, fields) {
  return (items || []).map(item => {
    const title = escapeHTML(item[fields.title] || "");
    const org = escapeHTML(item[fields.org] || "");
    const date = escapeHTML(item[fields.date] || "");
    const bullets = renderList(item[fields.bullets] || []);
    const link = fields.link ? (item[fields.link] || "") : "";

    const linkHtml = fields.link
      ? (link ? `<a href="${escapeHTML(link)}" target="_blank" rel="noopener">View</a>` : `<span class="muted">[Add link]</span>`)
      : "";

    return `
      <div class="card">
        <div class="card-top">
          <h3>${title}</h3>
          <div class="meta-line">
            <span><strong>${org}</strong></span>
            <span class="muted">${date}</span>
            ${linkHtml ? `<span class="link">${linkHtml}</span>` : ""}
          </div>
        </div>
        ${bullets}
      </div>
    `;
  }).join("");
}

function renderSkills(skillsObj) {
  const entries = Object.entries(skillsObj || {});
  return entries.map(([cat, skills]) => `
    <div class="skill-col">
      <h3>${escapeHTML(cat)}</h3>
      ${renderList(skills)}
    </div>
  `).join("");
}

function renderHTML(site) {
  const t = site.meta.theme;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHTML(site.meta.name)} — Portfolio</title>
  <style>
    :root{
      --primary:${t.primary}; --secondary:${t.secondary}; --accent:${t.accent};
      --dark:${t.dark}; --light:${t.light};
      --panel: rgba(255,255,255,0.06);
      --border: rgba(255,255,255,0.14);
      --shadow: 0 10px 30px rgba(0,0,0,0.35);
      --radius: 14px;
      --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    }
    *{box-sizing:border-box}
    body{
      margin:0; font-family:var(--font); color:var(--light);
      background:
        radial-gradient(900px 520px at 15% 0%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 60%),
        radial-gradient(900px 520px at 85% 0%, color-mix(in oklab, var(--secondary) 18%, transparent), transparent 60%),
        radial-gradient(900px 520px at 50% 100%, color-mix(in oklab, var(--accent) 14%, transparent), transparent 60%),
        var(--dark);
      line-height:1.5;
    }
    a{ color:var(--accent); text-decoration:none }
    a:hover{ text-decoration:underline }
    .wrap{ max-width: 980px; margin: 0 auto; padding: 24px 16px 56px; }
    header{
      background: linear-gradient(180deg, rgba(255,255,255,.06), transparent 55%), var(--panel);
      border:1px solid var(--border); border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 18px;
      display:grid;
      gap:10px;
    }
    .name{ font-size: 30px; font-weight: 900; margin:0; letter-spacing:.2px }
    .headline{ font-size: 16px; font-weight: 800; margin:0; color: rgba(234,240,255,.95) }
    .subtitle{ margin:0; color: rgba(234,240,255,.75) }
    .contact{ display:flex; gap:12px; flex-wrap:wrap; font-size: 14px; color: rgba(234,240,255,.85) }
    nav{
      position: sticky; top: 0; z-index: 10;
      margin: 14px 0;
      background: rgba(11,18,32,.70);
      border:1px solid var(--border);
      border-radius: 999px;
      padding: 10px 12px;
      backdrop-filter: blur(6px);
      display:flex; gap: 12px; flex-wrap:wrap;
    }
    nav a{ font-weight: 800; font-size: 13px; color: rgba(234,240,255,.88) }
    section{
      margin-top: 14px;
      background: var(--panel);
      border:1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 16px;
    }
    h2{ margin:0 0 10px; font-size: 16px; letter-spacing:.2px }
    .muted{ color: rgba(234,240,255,.70) }
    .grid2{ display:grid; grid-template-columns: 1fr; gap: 12px; }
    @media (min-width: 860px){ .grid2{ grid-template-columns: 1fr 1fr; } }
    .card{
      border:1px solid rgba(255,255,255,.12);
      background: rgba(0,0,0,.20);
      border-radius: 14px;
      padding: 12px;
    }
    .card-top h3{ margin:0 0 6px; font-size: 14.5px }
    .meta-line{
      display:flex; gap: 10px; flex-wrap:wrap;
      font-size: 12.5px;
    }
    ul{ margin:8px 0 0; padding-left: 18px; }
    li{ margin: 5px 0; }
    .skills{ display:grid; grid-template-columns: 1fr; gap: 10px; }
    @media (min-width: 860px){ .skills{ grid-template-columns: 1fr 1fr; } }
    .skill-col h3{ margin:0 0 6px; font-size: 13.5px }
    .cta{
      display:flex; align-items:center; justify-content:space-between; gap: 12px; flex-wrap:wrap;
      background: linear-gradient(90deg, color-mix(in oklab, var(--primary) 40%, transparent), color-mix(in oklab, var(--accent) 25%, transparent));
      border:1px solid rgba(255,255,255,.16);
    }
    .btn{
      display:inline-block;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255,255,255,.10);
      border: 1px solid rgba(255,255,255,.16);
      font-weight: 900;
    }
    footer{ margin-top: 16px; text-align:center; color: rgba(234,240,255,.70); font-size: 12.5px; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1 class="name">${escapeHTML(site.meta.name)}</h1>
      <p class="headline">${escapeHTML(site.meta.headline)}</p>
      <p class="subtitle">${escapeHTML(site.meta.subtitle)}</p>
      <div class="contact">
        <span>${escapeHTML(site.meta.email)}</span>
        <span>${escapeHTML(site.meta.phone)}</span>
        <span><a href="${escapeHTML(site.meta.linkedin)}" target="_blank" rel="noopener">${escapeHTML(site.meta.linkedin || "LinkedIn")}</a></span>
      </div>
    </header>

    <nav>
      <a href="#about">About</a>
      <a href="#education">Education</a>
      <a href="#experience">Experience</a>
      <a href="#projects">Projects</a>
      <a href="#skills">Skills</a>
      <a href="#certs">Certifications</a>
      <a href="#contact">Contact</a>
    </nav>

    <section id="about">
      <h2>About</h2>
      ${(site.sections.about || []).map(p => `<p>${escapeHTML(p)}</p>`).join("")}
    </section>

    <section id="education">
      <h2>Education</h2>
      ${renderCards(site.sections.education, { title:"degree", org:"institution", date:"date", bullets:"details" })}
    </section>

    <section id="experience">
      <h2>Experience</h2>
      ${renderCards(site.sections.experience, { title:"title", org:"org", date:"date", bullets:"bullets" })}
    </section>

    <section id="projects">
      <h2>Projects</h2>
      ${renderCards(site.sections.projects, { title:"name", org:"link", date:"date", bullets:"bullets", link:"link" })}
    </section>

    <section id="skills">
      <h2>Skills</h2>
      <div class="skills">${renderSkills(site.sections.skills)}</div>
    </section>

    <section id="certs">
      <h2>Certifications</h2>
      ${(site.sections.certifications || []).length
        ? renderList(site.sections.certifications)
        : `<p class="muted">[Add certifications if applicable]</p>`
      }
    </section>

    <section id="contact" class="cta">
      <div>
        <h2 style="margin:0 0 6px;">Let’s Connect</h2>
        <div class="muted">${escapeHTML(site.sections.cta.text)}</div>
      </div>
      <a class="btn" href="${escapeHTML(site.sections.cta.button_href)}">${escapeHTML(site.sections.cta.button_label)}</a>
    </section>

    <footer>© ${new Date().getFullYear()} ${escapeHTML(site.meta.name)} • Built from a template + AI-generated draft content</footer>
  </div>
</body>
</html>`;
}

// ---- 3) Prompt the model for JSON only (Structured Outputs) ----
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
    `Accent: ${theme.accent || ""}`,
    `Dark: ${theme.dark || ""}`,
    `Light: ${theme.light || ""}`,
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
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }
    const { page1, page2 } = JSON.parse(event.body || "{}");

    // Basic guardrails
    if (!page1?.name || !page1?.email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields: name and email." })
      };
    }

    // Normalize theme defaults
    const theme = {
      primary: page2?.theme?.primary || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      accent: page2?.theme?.accent || "#8DE0FF",
      dark: page2?.theme?.dark || "#0b1220",
      light: page2?.theme?.light || "#eaf0ff"
    };

    const prompt = buildPreviewPrompt(page1, { ...page2, theme });

    // Responses API: structured outputs use text.format (per migration guidance)
    const resp = await client.responses.create({
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: "You are a portfolio website generator. Return JSON only." },
        { role: "user", content: prompt }
      ],
      text: {
        format: {
          type: "json_schema",
          json_schema: SITE_JSON_SCHEMA
        }
      }
    });

    // The SDK provides output_text for plain text; for structured JSON you parse:
    const jsonText = resp.output_text; // should be JSON text due to schema
    const site_json = JSON.parse(jsonText);

    // Inject normalized theme back just in case
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