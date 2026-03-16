import OpenAI, { toFile } from "openai";
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

// ─── Stage 3: HTML Generation Prompt (long version — used in three-prompt mode) ─
const STAGE3_PROMPT = `You are building a personal portfolio website from structured resume data and a visual template.

NON-NEGOTIABLE REQUIREMENTS:
A. Output a SINGLE complete HTML file. Never stop mid-section.
B. VISUAL FIDELITY: Mirror the template's visual design exactly — hero technique, card style, typography, spacing, layout patterns.
C. SECTION STRUCTURE: Design the optimal section set for this person's specific major, specialization, and target job.
D. MATCH TEMPLATE LENGTH: Total visual length should be roughly similar to the template.
E. RESUME DOWNLOAD LINK: Include a prominent "Download Resume" button/link (href="resume.pdf") in both the navigation bar and the hero section.
F. Reproduce the hero/banner background technique from the sample EXACTLY — gradient stops, orbs, blobs, layered backgrounds. Never flatten to white or a solid color.

CONTENT SOURCE: Use ONLY the provided JSON for all personal information (name, contact, education, experience, projects, skills, etc). Do NOT invent facts, metrics, employers, or credentials.

CONTENT ENHANCEMENT (within the bounds of the JSON):
- Expand resume bullets into website-quality narratives (context, challenge, action, result)
- Write a compelling About Me section from the summary and overall profile
- Create visual skill cards with proficiency context
- Detailed project showcases with problem statements, tech stack, and links
- Mark any content embellished beyond what the JSON strictly states with *** and an incrementing index

COLOR SCHEME:
{{COLOR_INSTRUCTION}}

TEMPLATE REFERENCE:
{{TEMPLATE_SCREENSHOT}}

STRUCTURAL INPUT:
Major: {{MAJOR}}
Specialization: {{SPECIALIZATION}}
Headshot: {{HEADSHOT_PHOTO}}
Target Job: {{JOB_INFO}}

Sample website HTML:
{{TEMPLATE_USAGE}}
{{SAMPLE_WEBSITE_HTML}}

RESUME CONTENT JSON:
{{RESUME_JSON}}

TECHNICAL REQUIREMENTS:
- Self-contained HTML with embedded CSS
- No external dependencies except Google Fonts (max 2) and Font Awesome CDN
- Fully responsive (mobile, tablet, desktop)
- Smooth scroll navigation, sticky nav bar
- Footer: © {{YEAR}} [person's full name from JSON]. No other watermark.
- Alternate light and dark sections
- Sufficient text contrast for accessibility

Output the complete HTML file only. No explanation, no markdown — just the file.`;

// ─── Original single-prompt templates (preserved as fallback) ────────────────
const PROMPT_TEMPLATE = `You are building a personal portfolio website for a job seeker.
Use all the content of the input resume PDF (e.g., name, contact info, education, experience, projects, skills, etc) as the foundation for the new website.
You have a mandate to make improvements in overall quality and impactfulness, such as embellishing narratives while being more concise, using active voice rather than passive voice, spelling out concretely the hows, whys, where, whens, etc.
Do not fabricate achievements, metrics, employers, dates, or credentials.
Mark with a triple asterisk (***) anything fabricated beyond the resume info.
{{COLOR_INSTRUCTION}}
{{TEMPLATE_USAGE}}
If no example web page or image is provided, generate one suitable for the major specialization.
Apply the input color scheme to ALL colored elements throughout the new page — body background, decorative card visuals, orbs, bubbles, brand mark, and any other gradient or background elements. Every element should use the new color scheme, rather than the sample's colors.
CRITICAL: This includes every hardcoded hex (#rrggbb) and rgba() value inside gradient stops and background declarations — not just CSS custom properties. Convert the provided hex colors to rgba() as needed and use them for all gradient stops. Do NOT carry over any hardcoded color values from the sample's original gradients.
Visual content should be adapted to match the themes of corresponding elements of the job seeker's resume, for example: a visual with red laser beams for an Electrical Engineering major with a specialization in lasers.
Double-check that the text has enough contrast against the background so that it is easily visible.
Output the complete, self-contained HTML file only (ready to save and open in a browser); no explanation, no markdown — just the file.`;

const PROMPT_TEMPLATE_LONG = `NON-NEGOTIABLE REQUIREMENTS (read before anything else):
A. Output a SINGLE complete HTML file. Never stop mid-section. If content is long, be more concise per section rather than omitting sections.
B. VISUAL FIDELITY — always: Mirror the template's visual design exactly — hero technique, card style, typography, spacing, layout patterns. This applies regardless of how different the majors are.
C. SECTION STRUCTURE — use expert judgment:
   Portfolio websites are not space-constrained like resumes. Design the OPTIMAL section set for this person's specific major, specialization, and target job — that often means MORE sections than the resume has.
   • When the user's major is CLOSELY RELATED to the template's field: treat the template's section order and selection as a strong structural guide.
   • When the user's major DIFFERS SIGNIFICANTLY from the template's: depart freely. Design sections that are standard and high-impact for their actual field (e.g. Lab Skills + Research for science; Case Studies + Process for design; System Architecture + APIs for software engineering).
   • When a target job is provided: meaningfully shift which sections appear, their order, and their emphasis so the site speaks directly to that role. A different job target should produce a noticeably different site structure.
   • Use your knowledge of what hiring managers in this field look for to decide which sections will make the strongest impression.
D. MATCH TEMPLATE LENGTH: Total visual length of the generated site should be roughly similar to the template. Scale items within each section to fit the resume (one card per project, one entry per job) but do not let sections balloon.
E. RESUME DOWNLOAD LINK: Include a prominent "Download Resume" button/link (href="resume.pdf") in both the navigation bar and the hero section.
F. Reproduce the hero/banner background technique from the sample EXACTLY — gradient stops, orbs, blobs, layered backgrounds. Never flatten to white or a solid color.

You are an expert portfolio website generator and career positioning strategist.
I need you to create a full-fledged, production-ready portfolio website. You will receive:

Major and specialization (e.g., "Data Science" with specialization in "Machine Learning")
Resume PDF content (name, contact info, education, experience, skills, projects)
Sample website HTML (use this as your style and layout template if provided; if not then improvise and follow best practices)
Color scheme (hex codes for primary, secondary, accent colors)
Job target (desired role, job posting)

INTERNAL PLANNING STEP (DO NOT OUTPUT)

Before generating the website, internally determine:

1. the candidate’s primary professional identity
2. the most important projects or experiences
3. the strongest technical skills
4. the logical section order for the website
5. how the sample HTML layout should be adapted
6. how to apply the provided color palette consistently
7. what to highlight, emphasize, or prioritize in consideration of the target job

Do not output this planning step.
Use the strengths of a website:

• clearer visual hierarchy
• stronger narrative flow
• scannable sections
• featured projects
• links to external work
• calls to action
• readable layout

Instructions
1. Structure & Layout

Use the sample website HTML as your template for style, navigation structure, and overall layout.

CRITICAL — Hero & background fidelity:
• Reproduce the hero section's visual technique EXACTLY: if the sample uses a CSS gradient background, radial-gradient orbs, blobs, animated shapes, or layered background elements, copy that CSS technique faithfully and re-skin it with the provided color scheme. Do NOT flatten it to a solid or plain white background.
• If the sample hero background is a multi-stop gradient (linear or radial), preserve every stop — map each distinct stop to a DIFFERENT provided color (primary, secondary, accent, light, dark) so the gradient remains visually rich and multi-colored. Never collapse all stops to the same color. Keep the same structure (directions, stop positions, blend, opacity).
• If the sample has floating decorative elements (glowing orbs, soft blobs, glassmorphism cards), reproduce them with equivalent CSS using the provided colors — with the same size, position, blur, and opacity as the original.
• Only deviate from the sample's background technique if no sample is provided.

If it contains a foreground image besides a headshot, generate a new hero image that correlates with the input color scheme and the theme of the major + specialization.
Maintain the responsive design patterns from the sample.
Preserve any unique design elements (banners, gradients, grid layouts, card designs)
If no headshot photo is provided, render a monogram instead.

2. Color Scheme Integration

{{COLOR_INSTRUCTION}}

Alternate between light and dark sections

Ensure sufficient contrast for accessibility (text must be readable)

3. Content Transformation (CRITICAL)
Do NOT just copy resume text to the website. Enhance and embellish it to leverage website advantages and to illustrate to the user their full potential; but avoid misrepresentations.  The goal is to WOW the potential employer and their recruiters by portraying the user at their best. 
From Resume → To Website
Education Section:

Resume: "B.S. Computer Science, University Name, GPA 3.8"
Website: Expand with relevant coursework, thesis/capstone details, academic honors with context, any notable professors or research groups



Provide context and specialization
Resume: limited explanation.
Website: interpretive context. 

Instruction
Explain:
  -areas of interest
  -industries of focus
  -methodological strengths
  -preferred problem domains.

Example:

Interests
• Predictive modeling for business analytics
• Reproducible machine learning pipelines
• Data storytelling for non-technical stakeholders


Experience Section:

Resume: Bullet points of responsibilities and/or isolated achievements
Website: Transform into coherent narratives that tell the story of growth in each role. Describe:
  -how skills developed over time
  -themes across projects
  -the candidate’s professional direction.

Instruction
Include:
  Context: What was the company/project about?
  Challenge: What problem were you solving?
  Action: What did you specifically do?
  Result: What was the measurable impact?
  Technologies: Detailed tech stack (can be more extensive than resume)



Projects Section:

Resume: 1-2 lines per project
Website: Create detailed project showcases with:

Project title, icon and tagline
Hero image (AI-generated or stock) or description (e.g., "Dashboard screenshot", "Mobile app mockup")
Problem statement: What need did this address?
Your role: What specifically did you do?
Technical approach: Architecture, algorithms, methodologies
Technologies used: Comprehensive list with brief explanations
Key features: 3-5 main capabilities
Results/Impact: Metrics, outcomes, learnings
Links: GitHub repo, live demo, documentation (use placeholder URLs)
Add “View Code”, “View Dashboard”, or “Read Analysis” links.
Visuals: Suggest where screenshots, diagrams, or charts should go
Use visual elements such as:
  -charts or plots
  -project thumbnails
  -icons for technologies
  -timeline components
  -badges for tools or methods.
Supply inline stock or AI-generated photos when possible; mark them with a triple asterisk (***) and an index number that counts the asterisk groups so far.



Skills Section:

Resume: Simple categorized lists
Website: Create visual skill cards with:

Skill categories as tabs or sections
Proficiency indicators (e.g., "Advanced", "Intermediate", "Familiar")
Context for each skill cluster (e.g., "Used extensively in 3 production projects")


Additional Website-Only Content
Add sections that wouldn't fit on a resume:
About Me Section:

Write a compelling 3-6 sentence narrative
Include professional interests, career goals, what makes them unique
Make it personable but professional
Incorporate the major/specialization naturally

Achievements/Highlights:

Create visual callout boxes for:

Awards and honors
Certifications
Publications or presentations
Notable metrics (e.g., "Managed $X budget", "Improved performance by Y%")



Process/Methodology Section (for relevant fields):

Explain their approach to work (research process, design thinking, development workflow)
Shows thought leadership beyond just listing accomplishments

4. Technical Implementation
Generate a single, self-contained HTML file with:

Embedded CSS (in <style> tags)
No external dependencies except:

Google Fonts (max 2 font families)
Font Awesome or similar icon CDN (if needed)


Fully responsive (mobile, tablet, desktop)
Semantic HTML5 structure
Accessibility considerations (alt text, ARIA labels, proper heading hierarchy)

5. Content Writing Style

Professional but personable tone
Active voice (avoid passive constructions)
Specific and concrete (use numbers, metrics, names of technologies)
Achievement-oriented (focus on impact and results)
Keyword-rich for SEO (naturally incorporate major, skills, job titles)
Scannable (use headings, short paragraphs, bullet points where appropriate)

6. Navigation & User Experience

Sticky navigation with smooth scroll to sections
Include a "Download Resume" button/link (href="resume.pdf") in BOTH the nav bar and the hero section — style it prominently to match the site design
Clear call-to-action buttons: "Contact Me", "See Projects"
Footer with contact info and social links
Smooth scroll behavior for anchor links
Consider adding a "Back to Top" button for long pages

7. SEO & Meta Tags
Include proper meta tags:
<title>[Name] | [Major] Graduate Portfolio</title>
<meta name="description" content="Portfolio of [Name], [Major] graduate specializing in [Specialization]. View projects, experience, and skills.">

8. Any augmentation, enhancement or embellishment not supported (directly or indirectly) by the resume should be marked with a triple asterisk (***) and an index number counting the number of asterisk groups in the page so far.

9. Quality Checks
Before finalizing, ensure:

 All colors from the color scheme are used consistently
 The hero section's background technique (gradient, orbs, blobs, shapes) matches the sample — NOT a flat/white background
 No Lorem ipsum or placeholder text
 Contact information is accurate and formatted correctly
 All sections from the resume are represented and expanded
 The layout matches the sample website's structure
 Code is clean, indented, and commented
 Mobile responsiveness is maintained
 No broken links or missing assets
Include a footer copyright line using the person's name from the resume and the current year: © {{YEAR}} [Person's Full Name]. Do not add any other watermark.

Output Format
Provide the complete HTML file only (ready to save and deploy). No summary, no suggestions after the HTML — just the file.


INPUT DATA

Template screenshot: {{TEMPLATE_SCREENSHOT}}

Headshot photo: {{HEADSHOT_PHOTO}} (placed in header, hero or footer as most suiting, if provided; otherwise add a monogram instead)

Major: {{MAJOR}}
Specialization: {{SPECIALIZATION}}

Target Job:
{{JOB_INFO}}

Resume: (attached as PDF — extract name, email, phone, LinkedIn, GitHub, and all other content from it)

Sample Website HTML:
{{TEMPLATE_USAGE}}
{{SAMPLE_WEBSITE_HTML}}

Now generate the complete portfolio website following all the instructions above.

Optional Enhancements (include if mentioned in inputs)
If the resume includes any of these, give them special treatment:

Publications: Create a dedicated section with proper citations and links
Speaking/Presentations: Showcase with event names, dates, and topics
Open Source Contributions: Highlight with repo stats if available
Certifications: Display with issuing organization and dates
Languages: If multilingual, showcase prominently
Volunteer Work: Include if relevant to career narrative
`;
/**
 * Netlify Background Function: generatePreview-background
 * Netlify returns 202 immediately; this function runs for up to 15 minutes.
 * Result is stored in a Netlify Blob keyed by jobId.
 * Poll /.netlify/functions/getPreviewResult?jobId=<id> for the result.
 *
 * Supports two pipelines:
 *   - Three-prompt (body.use_three_prompt = true): Stage 1 extracts JSON from PDF,
 *     Stage 2 validates it, Stage 3 generates HTML from the JSON + template.
 *   - Single-prompt (default / fallback): Original approach — one prompt with PDF attached.
 */

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

// ─── Three-prompt pipeline ───────────────────────────────────────────────────
async function runThreePromptPipeline(client, store, jobId, {
  page1, page2, page3, pdfBuffer,
  templateScreenshotBase64, templateScreenshotMime,
  sampleHtml, theme, headshotName
}) {
  // ── Stage 1: Extract resume content → structured JSON ──────────────────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Extracting resume content (1/3)…"
  }), { ttl: 3600 });

  const uploadedFile = await client.files.create({
    file: await toFile(pdfBuffer, "resume.pdf", { type: "application/pdf" }),
    purpose: "user_data"
  });

  let stage1Json;
  try {
    const stage1Response = await client.responses.create({
      model: "gpt-4o",
      input: [{ role: "user", content: [
        { type: "input_file", file_id: uploadedFile.id },
        { type: "input_text", text: STAGE1_PROMPT }
      ]}],
      max_output_tokens: 8000
    });
    const stage1Raw = stage1Response.output_text
      .replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
    stage1Json = JSON.parse(stage1Raw);
  } finally {
    // Clean up uploaded file regardless of success/failure
    client.files.del(uploadedFile.id).catch(() => {});
  }

  // ── Stage 2: Validate and normalize the JSON ────────────────────────────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Validating resume data (2/3)…"
  }), { ttl: 3600 });

  const stage2Response = await client.responses.create({
    model: "gpt-4o",
    input: [{ role: "user", content: [{
      type: "input_text",
      text: `${STAGE2_PROMPT}\n\nJSON to validate:\n${JSON.stringify(stage1Json, null, 2)}`
    }]}],
    max_output_tokens: 8000
  });
  const stage2Raw = stage2Response.output_text
    .replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  const validatedJson = JSON.parse(stage2Raw);

  // ── Stage 3: Generate portfolio HTML from validated JSON + template ─────────
  await store.set(jobId, JSON.stringify({
    status: "pending", stage: "Generating portfolio website (3/3)…"
  }), { ttl: 3600 });

  const colorInstruction = page2?.use_sample_colors
    ? "Preserve the EXACT color scheme from the sample website — do NOT replace any colors. Use the provided color scheme JSON only as a fallback if no sample is available."
    : `Replace ALL colors in the sample with the provided color scheme and apply them consistently. Try to use all five colors.\n\nPrimary: Main headings, primary buttons, key branding\nSecondary: Subheadings, links, secondary buttons\nAccent: Highlights, hover states, CTAs\nDark: Dark section backgrounds\nLight: Light section backgrounds\n\nCRITICAL: Replace every hardcoded hex (#rrggbb) and rgba() color value inside gradient stops and background declarations — not just CSS custom properties. Convert the provided hex colors to rgba() as needed. Do NOT carry over any hardcoded color values from the sample's original gradients.\n\nColor scheme:\n${JSON.stringify(theme, null, 2)}`;

  const jobInfo = (page3?.desired_role || page3?.job_ad)
    ? `Desired role: ${page3.desired_role || "(not specified)"}\n\nJob posting:\n${page3.job_ad || "(not provided)"}`
    : "(not provided)";

  const stage3Prompt = fillTemplate(STAGE3_PROMPT, {
    COLOR_INSTRUCTION:   colorInstruction,
    TEMPLATE_SCREENSHOT: templateScreenshotBase64
      ? "A screenshot of the template website is attached as an image in this message. Use it as the PRIMARY visual style reference — faithfully reproduce its background gradients, decorative elements, and overall atmosphere using the provided color scheme."
      : "(not provided — rely on the sample HTML below for style reference)",
    MAJOR:               page1.major          || "",
    SPECIALIZATION:      page1.specialization || "",
    HEADSHOT_PHOTO:      headshotName
      ? `provided — create an <img src='${headshotName}' alt='[Name]'> placeholder`
      : "not provided — render a CSS monogram using the person's initials",
    JOB_INFO:            jobInfo,
    SAMPLE_WEBSITE_HTML: sampleHtml || "(No sample website provided)",
    TEMPLATE_USAGE:      templateUsageInstruction(page1.template_copyright_mode),
    RESUME_JSON:         JSON.stringify(validatedJson, null, 2),
    YEAR:                new Date().getFullYear().toString()
  });

  const stage3Content = [];
  if (templateScreenshotBase64 && templateScreenshotMime) {
    stage3Content.push({
      type: "input_image",
      image_url: `data:${templateScreenshotMime};base64,${templateScreenshotBase64}`,
      detail: "high"
    });
  }
  stage3Content.push({ type: "input_text", text: stage3Prompt });

  const stage3Response = await client.responses.create({
    model: "gpt-4o",
    input: [{ role: "user", content: stage3Content }],
    max_output_tokens: 32000
  });

  const siteHtml = cleanHtml(stage3Response.output_text);

  if (!/<[a-z]/i.test(siteHtml)) {
    await store.set(jobId, JSON.stringify({
      status: "error",
      error: "The AI declined to generate the portfolio. Try adjusting your inputs or color scheme and resubmitting."
    }), { ttl: 3600 });
    return;
  }

  await store.set(jobId, JSON.stringify({
    status: "done",
    site_html: siteHtml,
    resume_json: validatedJson,
    truncated: stage3Response.incomplete_details?.reason === "max_output_tokens"
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

    const { page1 = {}, page2 = {}, page3 = {}, resumePdfBase64 = "", headshotName = "", templateScreenshotBase64 = "", templateScreenshotMime = "" } = body;

    if (!resumePdfBase64) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Resume PDF is required." }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    if (!process.env.OPENAI_API_KEY_LOCAL && !process.env.OPENAI_API_KEY) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "OPENAI_API_KEY is not set." }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    // OPENAI_API_KEY_LOCAL bypasses Netlify dev's AI gateway proxy, which replaces
    // OPENAI_API_KEY with a JWT and redirects the base URL, causing 404s on /v1/responses.
    const apiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
    const client = new OpenAI({ apiKey, baseURL: "https://api.openai.com/v1" });

    const theme = {
      primary:   page2?.theme?.primary   || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      accent:    page2?.theme?.accent    || "#8DE0FF",
      dark:      page2?.theme?.dark      || "#0b1220",
      light:     page2?.theme?.light     || "#eaf0ff"
    };

    const sampleHtml = await fetchSampleHtml(page1.model_template);

    // ── Three-prompt pipeline ────────────────────────────────────────────────
    if (body.use_three_prompt) {
      const pdfBuffer = Buffer.from(resumePdfBase64, "base64");
      await runThreePromptPipeline(client, store, jobId, {
        page1, page2, page3, pdfBuffer,
        templateScreenshotBase64, templateScreenshotMime,
        sampleHtml, theme, headshotName
      });
      return { statusCode: 202 };
    }

    // ── Single-prompt pipeline (original, preserved as fallback) ────────────
    const jobInfo = (page3?.desired_role || page3?.job_ad)
      ? `Desired role: ${page3.desired_role || "(not specified)"}\n\nJob posting:\n${page3.job_ad || "(not provided)"}`
      : "(not provided)";

    const prompt = fillTemplate(PROMPT_TEMPLATE, {
      MAJOR:               page1.major          || "",
      SPECIALIZATION:      page1.specialization || "",
      SAMPLE_WEBSITE_HTML: sampleHtml           || "(No sample website provided)",
      TEMPLATE_USAGE:      templateUsageInstruction(page1.template_copyright_mode),
      HEADSHOT_PHOTO:      headshotName ? `provided — create an <img src='${headshotName}' alt='[Name]'> placeholder` : "not provided — render a CSS monogram using the person's initials",
      YEAR:                new Date().getFullYear().toString(),
      JOB_INFO:            jobInfo,
      COLOR_INSTRUCTION:   page2?.use_sample_colors
        ? "Preserve the EXACT color scheme from the sample website — do NOT replace any colors. Use the provided color scheme JSON only as a fallback if no sample is available."
        : `Replace ALL colors in the sample with the provided color scheme and apply them consistently. Try to use all five colors.\n\nPrimary color: Main headings, primary buttons, key branding elements\nSecondary color: Subheadings, links, secondary buttons\nAccent color: Highlights, hover states, call-to-action elements\nDark: Dark section backgrounds\nLight: Light section backgrounds\n\nCRITICAL: Replace every hardcoded hex (#rrggbb) and rgba() color value inside gradient stops and background declarations — not just CSS custom properties. Convert the provided hex colors to rgba() as needed. Do NOT carry over any hardcoded color values from the sample's original gradients.\n\nProvided color scheme:\n${JSON.stringify(theme, null, 2)}`,
      TEMPLATE_SCREENSHOT: templateScreenshotBase64
        ? "A screenshot of the template website is attached as an image in this message. Use it as the PRIMARY visual style reference — faithfully reproduce its background gradients, decorative elements, and overall atmosphere using the provided color scheme."
        : "(not provided — rely on the sample HTML below for style reference)"
    });

    // Upload PDF via Files API so it can be referenced by file_id
    const pdfBuffer = Buffer.from(resumePdfBase64, "base64");
    const uploadedFile = await client.files.create({
      file: await toFile(pdfBuffer, "resume.pdf", { type: "application/pdf" }),
      purpose: "user_data"
    });

    const inputContent = [];
    inputContent.push({ type: "input_file", file_id: uploadedFile.id });
    if (templateScreenshotBase64 && templateScreenshotMime) {
      inputContent.push({
        type: "input_image",
        image_url: `data:${templateScreenshotMime};base64,${templateScreenshotBase64}`,
        detail: "high"
      });
    }
    const textPrompt = sampleHtml
      ? `${prompt}\n\nSample website HTML (use for style/layout reference):\n${sampleHtml}`
      : prompt;
    inputContent.push({ type: "input_text", text: textPrompt });

    const response = await client.responses.create({
      model: "gpt-4o",
input: [{ role: "user", content: inputContent }],
      max_output_tokens: 32000
    });

    // Clean up the uploaded file (non-fatal if it fails)
    client.files.del(uploadedFile.id).catch(() => {});

    // Strip markdown fences if model wrapped output
    let rawHtml = response.output_text
      .replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

    // Fix invalid CSS: remove any "initial" layers from background-image comma-separated lists.
    // Simple regex fails here because gradient values contain commas; use a depth-aware splitter.
    rawHtml = rawHtml.replace(/background-image\s*:([^;]+);/g, (_match, value) => {
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

    // Remove background sub-properties whose values are entirely comma-separated "initial" keywords —
    // these are invalid in multi-value lists and can cause browsers to suppress the whole background stack
    const siteHtml = rawHtml.replace(
      /background-(?:position-x|position-y|size|repeat|attachment|origin|clip)\s*:\s*(?:initial\s*,?\s*)+;/g, ""
    );

    // Detect model refusals — a valid HTML file always starts with a tag.
    // If the output contains no HTML tags, treat it as an error rather than rendering the refusal text.
    if (!/<[a-z]/i.test(siteHtml)) {
      await store.set(jobId, JSON.stringify({
        status: "error",
        error: "The AI declined to generate the portfolio. Try adjusting your inputs or color scheme and resubmitting."
      }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    await store.set(jobId, JSON.stringify({
      status: "done",
      site_html: siteHtml,
      truncated: response.incomplete_details?.reason === "max_output_tokens"
    }), { ttl: 3600 });
  } catch (err) {
    const msg = err?.message || "Unknown error";
    console.error("generatePreview-background error:", msg, err?.stack);
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
