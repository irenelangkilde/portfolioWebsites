import OpenAI, { toFile } from "openai";
import { readFileSync } from "fs";
import { resolve } from "path";
import { getStore } from "@netlify/blobs";

// ─── Stage 1: Content Extraction Prompt ──────────────────────────────────────
// Extracts all resume content into a structured JSON object.
const STAGE1_PROMPT = `You are a resume parser. Extract ALL content from the attached resume PDF and output a single JSON object — no markdown, no explanation, just the JSON.

Use this exact schema (omit fields that are absent from the resume, but never fabricate):

{
  "personal": {
    "name": "",
    "email": "",
    "phone": "",
    "linkedin": "",
    "github": "",
    "website": "",
    "location": ""
  },
  "summary": "",
  "education": [
    {
      "institution": "",
      "degree": "",
      "major": "",
      "minor": "",
      "graduation_date": "",
      "gpa": "",
      "honors": "",
      "relevant_coursework": [],
      "thesis": "",
      "activities": []
    }
  ],
  "experience": [
    {
      "company": "",
      "title": "",
      "start_date": "",
      "end_date": "",
      "location": "",
      "bullets": [],
      "technologies": []
    }
  ],
  "projects": [
    {
      "name": "",
      "description": "",
      "role": "",
      "dates": "",
      "technologies": [],
      "links": { "github": "", "demo": "", "other": "" },
      "bullets": []
    }
  ],
  "skills": {
    "technical": [],
    "tools": [],
    "programming_languages": [],
    "soft_skills": [],
    "other": []
  },
  "certifications": [
    { "name": "", "issuer": "", "date": "", "credential_id": "" }
  ],
  "awards": [
    { "title": "", "issuer": "", "date": "", "description": "" }
  ],
  "publications": [
    { "title": "", "venue": "", "date": "", "authors": [], "link": "" }
  ],
  "languages": [
    { "language": "", "proficiency": "" }
  ],
  "volunteer": [
    { "organization": "", "role": "", "dates": "", "description": "" }
  ],
  "extracurricular": [
    { "organization": "", "role": "", "dates": "", "description": "" }
  ]
}

Output the JSON only. Do not add any commentary before or after it.`;

// ─── Stage 2: JSON Validation Prompt ─────────────────────────────────────────
// Validates and normalizes the Stage 1 JSON. Flags gaps, never fabricates.
const STAGE2_PROMPT = `You are a resume content validator. You will receive a JSON object extracted from a resume.

Your tasks:
1. Fix any formatting issues: normalize dates to "Month YYYY" or "YYYY" format, trim whitespace, remove duplicate entries.
2. Ensure arrays are arrays and strings are strings (never null — use "" or [] as defaults).
3. If the "personal.name" field is empty, set it to "Unknown".
4. Add a top-level "_validation" object summarizing what was found:
   {
     "_validation": {
       "completeness_score": 0-100,
       "missing_fields": [],
       "warnings": [],
       "section_counts": {
         "education": 0,
         "experience": 0,
         "projects": 0,
         "skills_total": 0,
         "certifications": 0
       }
     }
   }
5. Do NOT add, invent, or infer any content not present in the input JSON.
6. Output the corrected JSON only — no markdown, no explanation.`;
/**
 * Netlify Background Function: buildWebsite-background
 * Netlify returns 202 immediately; this function runs for up to 15 minutes.
 * Result is stored in a Netlify Blob keyed by jobId.
 * Poll /.netlify/functions/getPreviewResult?jobId=<id> for the result.
 *
 * Pipeline:
 *   Stage 1 (optional): Extract resume PDF → structured JSON (skipped if client sends resumeAnalysisJson)
 *   Stage 2 (optional): buildContentStrategy.md → strategy JSON (skipped if strategyJson pre-computed)
 *   Stage 3: Assemble visual_direction from designSpec + colorSpec
 *   Stage 4: rendererPrompt.md → portfolio HTML
 */


async function fetchSampleHtml(url) {
  if (!url) return "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PortfolioBuilder/1.0)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 40000);
  } catch {
    return "";
  }
}

// ─── Template usage instruction (shared by both pipelines) ──────────────────
function templateUsageInstruction(copyrightMode) {
  if (copyrightMode === "owned") {
    return "The sample website is provided with permission — reproduce its layout structure, card designs, section order, background gradient technique, and visual hierarchy as faithfully as possible. Treat it as the authoritative design specification.";
  }
  // "inspiration" or unset
  return "The sample website is provided for inspiration only — draw on its general mood, visual energy, and compositional feel, but do NOT copy its specific layout, sections, or unique structural elements. Create a clearly original design that only echoes the spirit of the sample.";
}

// ─── Strip GrapesJS-bloated duplicate style block from template HTML ─────────
// GrapesJS saves CSS with every shorthand expanded into sub-properties
// (e.g. `background` → 9 individual lines). When the template also contains
// the original compact CSS in a second <style> block, the GrapesJS block is
// redundant and ~3× larger. Remove it before sending to the renderer.
//
// Detection heuristic: a <style> block that contains the GrapesJS fingerprint
// (bare property:initial pairs with no whitespace, e.g. "background-image:initial;")
// is dropped. A block is only removed if at least one other <style> block remains.
function stripGrapesJsCss(html) {
  const styleRe = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;
  const blocks = [];
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    blocks.push({ full: m[0], open: m[1], body: m[2], close: m[3], index: m.index });
  }
  if (blocks.length < 2) return html; // nothing to strip

  const isGrapesBlock = b =>
    /\bbackground-image\s*:\s*initial\s*;/.test(b.body) &&
    /\bpadding-top\s*:\s*0px\s*;/.test(b.body);

  const toRemove = blocks.filter(isGrapesBlock);
  const remaining = blocks.length - toRemove.length;
  if (remaining < 1 || toRemove.length === 0) return html;

  // Remove from end to start so indices stay valid
  let result = html;
  for (const b of [...toRemove].reverse()) {
    result = result.slice(0, b.index) + result.slice(b.index + b.full.length);
  }
  return result;
}

// ─── HTML post-processing (shared by both pipelines) ────────────────────────
function cleanHtml(rawHtml) {
  // Strip markdown fences if model wrapped the output
  let html = rawHtml.replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  // Fix invalid CSS: GrapesJS (and sometimes the model) expands `background` shorthand into
  // `background-image: ..., initial` — the stray `initial` in a comma list is invalid and
  // drops the whole declaration. Use a depth-aware splitter to handle nested gradient commas.
  html = html.replace(/background-image\s*:([^;]+);/g, (_match, value) => {
    const parts = [];
    let depth = 0, curr = "";
    for (const ch of value) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(curr.trim()); curr = ""; }
      else curr += ch;
    }
    if (curr.trim()) parts.push(curr.trim());
    const cleaned = parts.filter(p => p.toLowerCase() !== "initial");
    return cleaned.length ? `background-image:${cleaned.join(", ")};` : "";
  });
  // Remove background sub-properties whose values are entirely "initial" keywords
  html = html.replace(
    /background-(?:position-x|position-y|size|repeat|attachment|origin|clip)\s*:\s*(?:initial\s*,?\s*)+;/g, ""
  );
  return html;
}

// ─── Prompt loaders ──────────────────────────────────────────────────────────
function loadPromptFile(filename) {
  const cwd = process.cwd();
  for (const candidate of [
    resolve(cwd, `src/netlify/functions/${filename}`),
    resolve(cwd, `netlify/functions/${filename}`),
    resolve(cwd, filename),
  ]) {
    try { return readFileSync(candidate, "utf-8"); } catch {}
  }
  throw new Error(`Could not load ${filename}`);
}

function parseJsonResponse(raw) {
  const cleaned = raw.trim()
    .replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf("{"), last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error("Response was not valid JSON");
}

// ─── Code-level visual_direction assembly (replaces blendWebsite.md AI call) ─
function buildVisualDirection(motifs, designSpec, colorSpec, visualsJson) {
  const attrs   = designSpec?.exemplary_attributes || {};
  const factors = designSpec?.design_factors || {};
  const density            = designSpec?.density            || attrs.section_density || factors.density || "medium";
  const useEmojiIcons      = designSpec?.use_emoji_icons      ?? true;
  const alternateSections  = designSpec?.alternate_sections   ?? true;
  const visualMotifs = motifs?.potential_visual_motifs || [];
  const domain = motifs?.broad_primary_domain || "professional";

  const heroConcept = visualMotifs.length > 0
    ? `${visualMotifs[0]} — ${domain} field concept with ${(motifs?.symbolic_objects || [])[0] || "field-specific imagery"}`
    : `Abstract representation of the ${domain} domain using layered gradients and symbolic shapes`;

  const rendering = factors.rendering_style
    || (Array.isArray(motifs?.rendering_style) ? motifs.rendering_style[0] : motifs?.rendering_style)
    || "clean editorial vector";

  const isUseSampleColors = colorSpec?.use_sample_colors;
  const colorApp = isUseSampleColors
    ? {
        primary_use:   "Preserve template's primary color for headings and key UI elements",
        secondary_use: "Preserve template's secondary color for subheadings and links",
        accent_use:    "Preserve template's accent for hover states and CTAs",
        dark_use:      "Preserve template's dark color for backgrounds and body text",
        light_use:     "Preserve template's light color for cards and section backgrounds",
        gradient_notes: "Use template's existing gradient patterns"
      }
    : {
        primary_use:   `${colorSpec?.primary || "primary"} — headings, navbar brand, primary buttons`,
        secondary_use: `${colorSpec?.secondary || "secondary"} — subheadings, links, secondary buttons`,
        accent_use:    `${colorSpec?.accent || "accent"} — hover states, CTAs, highlights, icon accents`,
        dark_use:      `${colorSpec?.dark || "dark"} — hero background, dark section backgrounds`,
        light_use:     `${colorSpec?.light || "light"} — card backgrounds, alternating section fills`,
        gradient_notes: `Hero: ${colorSpec?.dark || "dark"} → ${colorSpec?.primary || "primary"}. Cards: subtle ${colorSpec?.light || "light"} base. Diagonal breaks: ${colorSpec?.primary || "primary"} → ${colorSpec?.secondary || "secondary"}.`
      };

  const pace = (attrs.pacing || "").toLowerCase();
  const animationGuidance = [];
  if (pace.includes("fast") || pace.includes("dynamic") || pace.includes("energet")) {
    animationGuidance.push("Fast scroll reveals: 0.3s fade-in with slight translateY(-10px)");
    animationGuidance.push("Subtle parallax on hero background layers");
  } else if (pace.includes("slow") || pace.includes("calm") || pace.includes("elegance") || pace.includes("minimal")) {
    animationGuidance.push("Gentle fade-in on scroll: 0.6s ease-out, staggered by 100ms per card");
    animationGuidance.push("Soft hover lift on cards: translateY(-3px) with deepened box-shadow");
  } else {
    animationGuidance.push("Fade-in on scroll via IntersectionObserver: 0.5s ease");
    animationGuidance.push("Card hover: translateY(-3px) with box-shadow transition 0.25s");
  }
  animationGuidance.push("Sticky frosted-glass navbar: backdrop-filter blur(12px) with subtle border");
  animationGuidance.push("CTA buttons: scale(1.03) on hover with 0.2s ease");

  const visualPlacements = (visualsJson || []).map(a => {
    const t = (a.type || "").toLowerCase();
    const lbl = (a.label || a.name || "").toLowerCase();
    let section = "about or projects";
    let notes = "Linked with a descriptive anchor button";
    if (t.includes("image") || t.includes("photo")) { section = "hero or about"; notes = "Displayed inline as a rounded portrait or project thumbnail"; }
    else if (t.includes("video")) { section = "projects"; notes = "Embedded as autoplay muted loop or linked thumbnail"; }
    else if (t.includes("pdf") || lbl.includes("resume")) { section = "hero"; notes = "Linked as a 'Download Resume' button"; }
    else if (lbl.includes("project") || lbl.includes("demo")) { section = "projects"; notes = "Linked as 'View Project' button with short description"; }
    return { visual_label: a.label || a.name || "visual", visual_type: a.type || "file", placement_section: section, presentation_notes: notes };
  });

  return {
    visual_direction: {
      mood:                     attrs.mood             || "professional, modern",
      compositional_feel:       attrs.compositional_feel || "balanced, content-rich",
      section_density:          density,
      use_emoji_icons:          useEmojiIcons,
      alternate_sections:       alternateSections,
      visual_treatment:         attrs.visual_treatment || "clean with subtle depth and card layering",
      composition_choice:       factors.composition_option || "split",
      rendering_style:          rendering,
      hero_concept:             heroConcept,
      visual_motifs:            visualMotifs,
      symbolic_objects:         motifs?.symbolic_objects || [],
      animation_guidance:       animationGuidance,
      template_inspiration_notes: `Style token: ${factors.style_token || "clean-minimal"}. Pacing: ${attrs.pacing || "moderate"}. Preserve this visual character throughout.`,
      color_application:        colorApp,
      visual_placements:        visualPlacements
    }
  };
}

// ─── Mustache template helpers ───────────────────────────────────────────────

/**
 * Returns true when the HTML string contains Mustache tokens from our schema.
 * Used to detect whether the template should be filled programmatically.
 */
function isMustacheTemplate(html) {
  return /\{\{(?:name|headline|#experience|#projects|#education|#skill_groups)\}\}/.test(html);
}

/**
 * Minimal Mustache renderer (no external dependency).
 * Supports: {{scalar}}, {{#section}}...{{/section}}, {{.}} in loops.
 * Does NOT HTML-escape values (resume data is trusted).
 */
function renderMustache(template, data) {
  // Process sections recursively — lazy match ensures correct pairing for sequential sections
  let result = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
    const val = data[key];
    if (!val || (Array.isArray(val) && val.length === 0)) return "";
    if (Array.isArray(val)) {
      return val.map(item => {
        if (typeof item !== "object" || item === null) {
          // scalar array item — replace {{.}} with item value
          return inner.replace(/\{\{\.\}\}/g, String(item));
        }
        return renderMustache(inner, { ...data, ...item });
      }).join("");
    }
    // truthy scalar — render inner block once
    return renderMustache(inner, data);
  });

  // Replace scalar tokens {{key}}
  result = result.replace(/\{\{([^#\/!{][^}]*)\}\}/g, (_, key) => {
    const trimmed = key.trim();
    if (trimmed === ".") return data["."] != null ? String(data["."]) : "";
    const val = data[trimmed];
    return val != null ? String(val) : "";
  });

  return result;
}

/**
 * Maps contentJson + resumeJson into a flat Mustache data object
 * matching the schema in ExtractMustacheTemplate.md.
 */
function flattenToMustacheData(strategy, resumeJson) {
  const personal = resumeJson?.personal || {};
  const pos = strategy?.positioning || {};
  const edu0 = (resumeJson?.education || [])[0] || {};

  // Convert skills object → skill_groups array
  const skills = resumeJson?.skills || {};
  const skillGroupDefs = [
    { group_name: "Programming Languages", arr: skills.programming_languages },
    { group_name: "Technical Skills",      arr: skills.technical },
    { group_name: "Tools",                 arr: skills.tools },
    { group_name: "Soft Skills",           arr: skills.soft_skills },
    { group_name: "Other",                 arr: skills.other }
  ];
  const skill_groups = skillGroupDefs
    .filter(g => Array.isArray(g.arr) && g.arr.length)
    .map(g => ({ group_name: g.group_name, skills: g.arr }));

  // Combine volunteer + extracurricular into leadership
  const leadership = [
    ...(resumeJson?.volunteer      || []).map(v => ({ role: v.role, organization: v.organization, dates: v.dates, description: v.description })),
    ...(resumeJson?.extracurricular|| []).map(e => ({ role: e.role, organization: e.organization, dates: e.dates, description: e.description }))
  ];

  return {
    name:              personal.name     || "",
    headline:          pos.headline      || "",
    subheadline:       pos.subheadline   || "",
    value_proposition: pos.value_proposition || "",
    about:             resumeJson?.summary || "",
    email:             personal.email    || "",
    phone:             personal.phone    || "",
    linkedin:          personal.linkedin || "",
    github:            personal.github   || "",
    website:           personal.website  || "",
    location:          personal.location || "",
    major:             edu0.major        || "",
    specialization:    edu0.minor        || edu0.major || "",
    current_year:      new Date().getFullYear(),

    has_github:   !!(personal.github),
    has_linkedin: !!(personal.linkedin),
    has_website:  !!(personal.website),
    has_phone:    !!(personal.phone),

    experience: (resumeJson?.experience || []).map(e => ({
      title:       e.title      || "",
      company:     e.company    || "",
      start_date:  e.start_date || "",
      end_date:    e.end_date   || "Present",
      location:    e.location   || "",
      description: (e.bullets || [])[0] || "",
      bullets:     e.bullets    || [],
      technologies:e.technologies || []
    })),

    projects: (resumeJson?.projects || []).map(p => ({
      name:        p.name        || "",
      description: p.description || "",
      role:        p.role        || "",
      dates:       p.dates       || "",
      bullets:     p.bullets     || [],
      technologies:p.technologies || [],
      github_link: p.links?.github || "",
      demo_link:   p.links?.demo   || ""
    })),

    education: (resumeJson?.education || []).map(e => ({
      institution:      e.institution      || "",
      degree:           e.degree           || "",
      major:            e.major            || "",
      graduation_date:  e.graduation_date  || "",
      gpa:              e.gpa              || "",
      honors:           e.honors           || "",
      activities:       e.activities       || []
    })),

    skill_groups,

    certifications: (resumeJson?.certifications || []).map(c => ({
      name:   c.name   || "",
      issuer: c.issuer || "",
      date:   c.date   || ""
    })),

    publications: (resumeJson?.publications || []).map(p => ({
      title: p.title || "",
      venue: p.venue || "",
      date:  p.date  || "",
      link:  p.link  || ""
    })),

    leadership
  };
}

// ─── Provider-agnostic AI call helper ────────────────────────────────────────
// creds: { openaiClient, claudeKey }
// opts:  { system?, userText, pdfBuffer?, maxTokens? }
// returns: { text, model, truncated }
async function callAI(provider, creds, { system, userText, pdfBuffer, maxTokens = 8000 }) {
  if (provider === "openai") {
    const { openaiClient } = creds;
    if (pdfBuffer) {
      const uploadedFile = await openaiClient.files.create({
        file: await toFile(pdfBuffer, "resume.pdf", { type: "application/pdf" }),
        purpose: "user_data"
      });
      try {
        const r = await openaiClient.responses.create({
          model: "gpt-4o",
          ...(system ? { instructions: system } : {}),
          input: [{ role: "user", content: [
            { type: "input_file", file_id: uploadedFile.id },
            { type: "input_text", text: userText }
          ]}],
          max_output_tokens: maxTokens
        });
        return { text: r.output_text, model: r.model || "gpt-4o", truncated: r.incomplete_details?.reason === "max_output_tokens" };
      } finally {
        openaiClient.files.del(uploadedFile.id).catch(() => {});
      }
    }
    const r = await openaiClient.responses.create({
      model: "gpt-4o",
      ...(system ? { instructions: system } : {}),
      input: [{ role: "user", content: [{ type: "input_text", text: userText }] }],
      max_output_tokens: maxTokens
    });
    return { text: r.output_text, model: r.model || "gpt-4o", truncated: r.incomplete_details?.reason === "max_output_tokens" };
  } else {
    // Claude
    const claudeModel = "claude-sonnet-4-6";
    const userContent = pdfBuffer
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBuffer.toString("base64") } },
          { type: "text", text: userText }
        ]
      : [{ type: "text", text: userText }];
    const reqBody = { model: claudeModel, max_tokens: maxTokens, messages: [{ role: "user", content: userContent }] };
    if (system) reqBody.system = system;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": creds.claudeKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(reqBody)
    });
    const json = await res.json();
    if (!res.ok) throw new Error("Claude API error: " + (json.error?.message || JSON.stringify(json).slice(0, 200)));
    const text = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    return { text, model: json.model || claudeModel, truncated: json.stop_reason === "max_tokens" };
  }
}

// ─── Job analysis pipeline (stages 1-2 only) ─────────────────────────────────
// Runs resume extraction and content strategy while the user fills Design/Colors.
// Result is stored in the blob and consumed by the full pipeline to skip Stage 2.
async function runJobAnalysisPipeline(provider, creds, store, jobId, {
  page3, pdfBuffer, resumeAnalysisJson
}) {
  const jobAnalysis = {
    desired_role: page3?.desired_role || "",
    job_ad:       page3?.job_ad       || ""
  };

  // Stage 1 (optional): Extract resume PDF → JSON
  let resumeJson = resumeAnalysisJson;
  if (!resumeJson) {
    await store.set(jobId, JSON.stringify({
      status: "pending", stage: "Extracting resume content (1/2)…"
    }), { ttl: 3600 });

    const r1 = await callAI(provider, creds, { userText: STAGE1_PROMPT, pdfBuffer, maxTokens: 8000 });
    const stage1Json = parseJsonResponse(r1.text);

    const r2 = await callAI(provider, creds, {
      userText: `${STAGE2_PROMPT}\n\nJSON to validate:\n${JSON.stringify(stage1Json, null, 2)}`,
      maxTokens: 8000
    });
    resumeJson = parseJsonResponse(r2.text);
  }

  // Stage 2: Content strategy (resume + job)
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Content strategy (2/2)…"
  }), { ttl: 3600 });

  const { compatible_color_schemes, ...resumeForStrategy } = resumeJson;
  const contentPrompt = loadPromptFile("buildContentStrategy.md")
    .replace("{{RESUME_JSON}}",       JSON.stringify(resumeForStrategy, null, 2))
    .replace("{{JOB_ANALYSIS_JSON}}", JSON.stringify(jobAnalysis, null, 2));

  const contentResponse = await callAI(provider, creds, { userText: contentPrompt, maxTokens: 8000 });
  const aiStrategy = parseJsonResponse(contentResponse.text);

  await store.set(jobId, JSON.stringify({
    status: "done",
    strategy_json: aiStrategy,
    resume_json:   resumeJson
  }), { ttl: 3600 });
}

// ─── Main pipeline ───────────────────────────────────────────────────────────
async function runPortfolioWebsitePipeline(provider, creds, store, jobId, {
  page1, page2, page3, pdfBuffer,
  sampleHtml, theme, headshotName,
  resumeAnalysisJson, templateAnalysisJson, templateHtml,
  artifactsData = [],
  strategyJson = null   // pre-computed by runJobAnalysisPipeline — skips Stage 2
}) {
  const jobAnalysis = {
    desired_role: page3?.desired_role || "",
    job_ad:       page3?.job_ad       || ""
  };

  // ── Stage 1 (optional): Extract resume PDF → JSON ───────────────────────────
  let resumeJson = resumeAnalysisJson;
  if (!resumeJson) {
    await store.set(jobId, JSON.stringify({
      status: "pending", stage: "Extracting resume content (1/4)…"
    }), { ttl: 3600 });

    const r1 = await callAI(provider, creds, { userText: STAGE1_PROMPT, pdfBuffer, maxTokens: 8000 });
    const stage1Json = parseJsonResponse(r1.text);

    const r2 = await callAI(provider, creds, {
      userText: `${STAGE2_PROMPT}\n\nJSON to validate:\n${JSON.stringify(stage1Json, null, 2)}`,
      maxTokens: 8000
    });
    resumeJson = parseJsonResponse(r2.text);
  }

  // ── Stage 2: buildContentStrategy.md → core_content_json ────────────────
  // Skip if a pre-computed strategyJson was provided by runJobAnalysisPipeline.
  const { compatible_color_schemes, ...resumeForStrategy } = resumeJson;

  let aiStrategy;
  if (strategyJson) {
    aiStrategy = strategyJson.strategy ?? strategyJson;
  } else {
    await store.set(jobId, JSON.stringify({
      status: "pending", stage: "Content strategy (2/4)…"
    }), { ttl: 3600 });

    const contentPrompt = loadPromptFile("buildContentStrategy.md")
      .replace("{{RESUME_JSON}}",       JSON.stringify(resumeForStrategy, null, 2))
      .replace("{{JOB_ANALYSIS_JSON}}", JSON.stringify(jobAnalysis, null, 2));

    const contentResponse = await callAI(provider, creds, { userText: contentPrompt, maxTokens: 8000 });
    aiStrategy = parseJsonResponse(contentResponse.text);
  }

  // Construct source_facts directly from resume_json — no AI re-extraction.
  // This prevents information loss from AI summarisation or schema mismatches.
  const coreContent = {
    strategy: aiStrategy.strategy ?? aiStrategy,
    source_facts: {
      identity: resumeForStrategy.identity ?? {},
      ...(resumeForStrategy.factual_profile ?? {})
    }
  };

  // ── Stage 3: code-level visual_direction assembly ────────────────────────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Assembling visual direction (3/4)…"
  }), { ttl: 3600 });

  const colorSpec = page2?.use_sample_colors
    ? { use_sample_colors: true, note: "Preserve the template's exact color scheme." }
    : { ...theme, use_sample_colors: false };

  // Enrich user-supplied artifacts with source and colorized fields.
  const COLORIZABLE_TYPES = new Set(["image", "html", "text"]);
  const userArtifacts = (artifactsData || []).map(a => ({
    ...a,
    source: "user",
    colorized: COLORIZABLE_TYPES.has((a.type || "").toLowerCase())
  }));

  // Stage 3: Build visual_direction using user artifacts only (for placement guidance).
  // Merge page1 user preferences on top of templateAnalysisJson so they always win,
  // regardless of which template source (option 1/2/3) was used.
  const designSpec = {
    ...(templateAnalysisJson || {}),
    ...(page1.design_density     !== undefined && { density:           page1.design_density }),
    ...(page1.use_emoji_icons    !== undefined && { use_emoji_icons:   page1.use_emoji_icons }),
    ...(page1.alternate_sections !== undefined && { alternate_sections: page1.alternate_sections }),
  };
  const blendResult = buildVisualDirection(
    resumeForStrategy.motifs ?? {},
    designSpec,
    colorSpec,
    userArtifacts
  );

  // ── Stage 3.5: Merge template visual elements into artifact list ─────────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Merging artifacts (3/4)…"
  }), { ttl: 3600 });

  const templateVisuals = templateAnalysisJson?.visual_elements;
  const templateImageArtifacts = (templateVisuals?.images || []).map(img => ({
    type: "image",
    label: img.src_file_name || img.role || "template image",
    content: img.src_file_name || "",
    tagline: img.role || "",
    selector: img.selector || "",
    source: "example website",
    colorized: false
  }));
  const templateAnimationArtifacts = (templateVisuals?.animations || []).map(anim => ({
    type: "animation",
    label: anim.src_file_name || anim.name || "template animation",
    content: anim.src_file_name || "",
    tagline: anim.name || "",
    selector: anim.selector || "",
    source: "example website",
    colorized: false
  }));
  const artifactsJson = [...userArtifacts, ...templateImageArtifacts, ...templateAnimationArtifacts];

  // ── Assemble renderer inputs ─────────────────────────────────────────────────
  const candidateName = coreContent.source_facts?.identity?.name || "";
  const headshotHint  = headshotName
    ? `provided — use <img src='${headshotName}' alt='${candidateName}'>`
    : `not provided — render a CSS monogram using the initials of "${candidateName}"`;

  // content_json: strategy + facts + rendering metadata
  const contentJson = {
    strategy:       coreContent.strategy,
    source_facts:   coreContent.source_facts,
    candidate_name: candidateName || "UNKNOWN — check source_facts.identity.name"
  };

  // Keep a combined blob for debug output only
  const websiteJson = {
    ...contentJson,
    visual_direction: blendResult.visual_direction,
    visuals: artifactsJson
  };

  // ── Stage 4: fill template → HTML ────────────────────────────────────────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Generating portfolio website (4/4)…"
  }), { ttl: 3600 });

  // Use the template HTML sent by the client (from extractedTemplateCache.templateHtml).
  // Fall back to the separately-fetched sampleHtml for URL-based templates.
  const rendererSampleHtml = stripGrapesJsCss(templateHtml || sampleHtml || "(No sample website provided)");

  let siteHtml, usedModel, truncated;

  if (isMustacheTemplate(rendererSampleHtml)) {
    // ── Mustache path: fill programmatically, skip AI renderer ─────────────
    const mustacheData = flattenToMustacheData(
      coreContent.strategy?.positioning ? coreContent.strategy : coreContent.strategy?.strategy,
      resumeJson
    );
    siteHtml = cleanHtml(renderMustache(rendererSampleHtml, mustacheData));
    usedModel = "mustache";
    truncated = false;
  } else {
    // ── AI renderer path ─────────────────────────────────────────────────────
    const rendererPrompt = loadPromptFile("rendererPrompt.md")
      .replace("{{CONTENT_JSON}}",    JSON.stringify(contentJson, null, 2))
      .replace("{{VISUAL_DIRECTION}}", JSON.stringify(blendResult.visual_direction, null, 2))
      .replace("{{VISUALS_JSON}}",    JSON.stringify(artifactsJson, null, 2))
      .replace("{{SAMPLE_HTML}}",     rendererSampleHtml)
      .replace("{{HEADSHOT}}",        headshotHint)
      .replace("{{TEMPLATE_USAGE}}",  templateUsageInstruction(page1.template_copyright_mode))
      .replace("{{YEAR}}",            new Date().getFullYear().toString());

    const rendererSystem = "You are an HTML code generator for a legitimate professional portfolio website builder service. Your sole task is to output a single complete HTML file as requested. This is a standard web development task. Output only raw HTML starting with <!DOCTYPE html> — no explanations, no refusals, no markdown, no commentary of any kind.";
    const rendererResponse = await callAI(provider, creds, {
      system: rendererSystem,
      userText: "Generate the portfolio HTML file per the spec below.\n\n" + rendererPrompt,
      maxTokens: 32000
    });

    siteHtml = cleanHtml(rendererResponse.text);
    usedModel = rendererResponse.model;
    truncated = rendererResponse.truncated;

    if (!/<[a-z]/i.test(siteHtml)) {
      let reason;
      if (!rendererResponse.text?.trim()) {
        reason = "The AI returned an empty response. This is usually a transient error — please resubmit.";
      } else if (rendererResponse.truncated) {
        reason = "The AI's output was cut off before any HTML was produced (token limit reached). Try a shorter job description or fewer visuals, then resubmit.";
      } else {
        reason = `The AI did not return valid HTML. Raw output started with: "${rendererResponse.text?.slice(0, 120)}"`;
      }
      await store.set(jobId, JSON.stringify({ status: "error", error: reason }), { ttl: 3600 });
      return;
    }
  }

  await store.set(jobId, JSON.stringify({
    status: "done",
    model: usedModel,
    site_html: siteHtml,
    resume_json: websiteJson,
    strategy_json: coreContent.strategy,
    visual_direction_json: blendResult.visual_direction,
    truncated
  }), { ttl: 3600 });
}

export async function handler(event) {
  // Parse body and jobId FIRST so the catch block can always reference them
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

    // Write pending status immediately so the poller knows the function started
    await store.set(jobId, JSON.stringify({ status: "pending" }), { ttl: 3600 });

    const {
      page1 = {}, page2 = {}, page3 = {},
      artifactsData = [],
      resumePdfBase64 = "", headshotName = "",
      resumeAnalysisJson = null, templateAnalysisJson = null, templateHtml = null,
      mode = "full",          // "full" | "analyzeJob"
      strategyJson = null,    // pre-computed strategy from analyzeJob mode
      provider = "claude"     // "claude" (default) | "openai"
    } = body;

    if (mode === "analyzeJob") {
      if (!resumePdfBase64 && !resumeAnalysisJson) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Resume PDF or pre-computed analysis required." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    } else {
      if (!resumePdfBase64) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "Resume PDF is required." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
    }

    // Build provider credentials
    let creds;
    if (provider === "openai") {
      const openaiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "OPENAI_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      creds = { openaiClient: new OpenAI({ apiKey: openaiKey, baseURL: "https://api.openai.com/v1" }) };
    } else {
      const claudeKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
      if (!claudeKey) {
        await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set." }), { ttl: 3600 });
        return { statusCode: 202 };
      }
      creds = { claudeKey };
    }

    // analyzeJob mode: run stages 1-2 only (resume extraction + content strategy)
    if (mode === "analyzeJob") {
      const pdfBuf = resumePdfBase64 ? Buffer.from(resumePdfBase64, "base64") : null;
      await runJobAnalysisPipeline(provider, creds, store, jobId, {
        page3, pdfBuffer: pdfBuf, resumeAnalysisJson
      });
      return { statusCode: 202 };
    }

    const theme = {
      primary:   page2?.theme?.primary   || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      accent:    page2?.theme?.accent    || "#8DE0FF",
      dark:      page2?.theme?.dark      || "#0b1220",
      light:     page2?.theme?.light     || "#eaf0ff"
    };

    const sampleHtml = await fetchSampleHtml(page1.model_template);
    const pdfBuffer  = Buffer.from(resumePdfBase64, "base64");

    await runPortfolioWebsitePipeline(provider, creds, store, jobId, {
      page1, page2, page3, pdfBuffer,
      sampleHtml, theme, headshotName,
      resumeAnalysisJson, templateAnalysisJson, templateHtml,
      artifactsData,
      strategyJson
    });
  } catch (err) {
    const msg = err?.message || "Unknown error";
    console.error("buildWebsite-background error:", msg, err?.stack);
    if (store) {
      try {
        await store.set(jobId, JSON.stringify({ status: "error", error: msg }), { ttl: 3600 });
      } catch (blobErr) {
        console.error("Failed to write error to blob:", blobErr?.message);
      }
    }
    // Return error details in body so they're visible in function logs
    return { statusCode: 202, body: JSON.stringify({ error: msg }) };
  }

  return { statusCode: 202 };
}
