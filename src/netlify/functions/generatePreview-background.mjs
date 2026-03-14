import Anthropic from "@anthropic-ai/sdk";
import { getStore } from "@netlify/blobs";

const PROMPT_TEMPLATE = `Portfolio Website Generation Prompt
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
• If the sample hero background is a multi-stop gradient (linear or radial), preserve every stop — just swap the hue values to match the provided colors while keeping the same structure (directions, stop positions, blend).
• If the sample has floating decorative elements (glowing orbs, soft blobs, glassmorphism cards), reproduce them with equivalent CSS using the provided colors.
• Only deviate from the sample's background technique if no sample is provided.

If it contains a foreground image besides a headshot, generate a new hero image that correlates with the input color scheme and the theme of the major + specialization.
Maintain the responsive design patterns from the sample.
Preserve any unique design elements (banners, gradients, grid layouts, card designs)
If no headshot photo is provided, render a monogram instead.

2. Color Scheme Integration

Replace ALL colors in the sample with the provided color scheme
Apply colors consistently
Try to use all the colors.

Primary color: Main headings, primary buttons, key branding elements
Secondary color: Subheadings, links, secondary buttons
Accent color: Highlights, hover states, call-to-action elements
Dark
Light

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



Projects Section (MOST IMPORTANT):

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
Clear call-to-action buttons: "View Resume (PDF)", "Contact Me", "See Projects"
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

Sample Website HTML (use as layout/style reference):
{{SAMPLE_WEBSITE_HTML}}

Color Scheme:
{{COLOR_SCHEME_JSON}}

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

    const { page1 = {}, page2 = {}, page4 = {}, resumePdfBase64 = "", headshotName = "", templateScreenshotBase64 = "", templateScreenshotMime = "" } = body;

    if (!resumePdfBase64) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "Resume PDF is required." }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    if (!process.env.ANTHROPIC_API_KEY_LOCAL && !process.env.ANTHROPIC_API_KEY) {
      await store.set(jobId, JSON.stringify({ status: "error", error: "ANTHROPIC_API_KEY is not set." }), { ttl: 3600 });
      return { statusCode: 202 };
    }

    // ANTHROPIC_API_KEY_LOCAL lets you bypass Netlify's AI gateway proxy in netlify dev,
    // which replaces ANTHROPIC_API_KEY with a JWT that fails locally.
    const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
    const client = new Anthropic({ apiKey, baseURL: "https://api.anthropic.com" });

    const theme = {
      primary:   page2?.theme?.primary   || "#4E70F1",
      secondary: page2?.theme?.secondary || "#FBAB9C",
      accent:    page2?.theme?.accent    || "#8DE0FF",
      dark:      page2?.theme?.dark      || "#0b1220",
      light:     page2?.theme?.light     || "#eaf0ff"
    };

    const sampleHtml = await fetchSampleHtml(page1.model_template);

    const jobInfo = (page4?.desired_role || page4?.job_ad)
      ? `Desired role: ${page4.desired_role || "(not specified)"}\n\nJob posting:\n${page4.job_ad || "(not provided)"}`
      : "(not provided)";

    const prompt = fillTemplate(PROMPT_TEMPLATE, {
      MAJOR:               page1.major          || "",
      SPECIALIZATION:      page1.specialization || "",
      COLOR_SCHEME_JSON:   JSON.stringify(theme, null, 2),
      SAMPLE_WEBSITE_HTML: sampleHtml           || "(No sample website provided)",
      HEADSHOT_PHOTO:      headshotName ? `provided — create an <img src='${headshotName}' alt='[Name]'> placeholder` : "not provided — render a CSS monogram using the person's initials",
      YEAR:                new Date().getFullYear().toString(),
      JOB_INFO:            jobInfo,
      TEMPLATE_SCREENSHOT: templateScreenshotBase64
        ? "A screenshot of the template website is attached as an image in this message. Use it as the PRIMARY visual style reference — faithfully reproduce its background gradients, decorative elements, and overall atmosphere using the provided color scheme."
        : "(not provided — rely on the sample HTML below for style reference)"
    });

    const userContent = [];
    if (resumePdfBase64) {
      userContent.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: resumePdfBase64 }
      });
    }
    if (templateScreenshotBase64 && templateScreenshotMime) {
      userContent.push({
        type: "image",
        source: { type: "base64", media_type: templateScreenshotMime, data: templateScreenshotBase64 }
      });
    }
    userContent.push({ type: "text", text: prompt });

    const stream = client.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 24000,
      system: "You are an expert portfolio-website generator. Return ONLY a complete standalone HTML file with embedded CSS. No markdown fences, no commentary before or after the HTML. The site must be fully complete — never cut off mid-tag or mid-section. Do NOT embed base64 image data or long SVG data URIs — use short placeholder comments like <!-- headshot photo --> instead.",
      messages: [{ role: "user", content: userContent }]
    });

    const msg = await stream.finalMessage();

    if (msg.stop_reason === "max_tokens") {
      await store.set(jobId, JSON.stringify({
        status: "error",
        error: "Generated HTML was truncated (max_tokens limit hit)."
      }), { ttl: 3600 });
    } else {
      await store.set(jobId, JSON.stringify({
        status: "done",
        site_html: msg.content[0].text
      }), { ttl: 3600 });
    }
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
