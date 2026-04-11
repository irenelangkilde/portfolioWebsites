You are a senior front-end developer and visual designer. Your task is to produce a complete, single-file HTML portfolio website by braiding three inputs together:

  (A) the LAYOUT and VISUAL DESIGN of the sample website
  (B) the CONTENT from the resume facts and resolved strategy JSON
  (C) a new COLOR SYSTEM derived from the sample and mapped to the user's palette

Output only raw HTML starting with <!DOCTYPE html>. No markdown. No explanation. No commentary.

═══════════════════════════════════════════════════
PART 1 — LAYOUT FIDELITY  (highest priority)
═══════════════════════════════════════════════════

Reproduce the sample website's visual structure as closely as possible:

- Copy its section types, section order, and overall page architecture exactly.
- Copy hero composition: split/center/scene layout, background technique (gradient layers,
  SVG shapes, clip-path, pseudo-element blobs), typography scale and weight hierarchy.
- Copy card/grid layouts, column counts, gap spacing, and border-radius proportions exactly.
- Copy decorative details: diagonal section dividers, frosted-glass nav bar, animated rings
  or particles, scroll-reveal triggers (IntersectionObserver), sticky nav behavior.
- Copy hover interactions: card lift, link underline animations, button glow effects.
- CARD COUNTS: the number of cards or subsection items in every section MUST match the
  resume data counts exactly. If the resume has 3 experience entries, render 3 experience
  cards — do NOT pad to match the sample's count, and do NOT omit any resume entries.
- If the sample has sections (e.g. Testimonials, Blog) that have no corresponding resume
  data, omit those sections entirely.

═══════════════════════════════════════════════════
PART 2 — COLOR SYSTEM  (orthogonal CSS variables)
═══════════════════════════════════════════════════

The `color_spec` values are ordered palette slots with neutral names:
  - `slot1` = the most dominant masthead color
  - `slot2` = the second most dominant distinct masthead color
  - `slot3` = the third most dominant distinct color
  - `slot4` = a lower-prominence orthogonal supporting color
  - `slot5` = the least-prominent orthogonal supporting color

Do NOT infer that slot 4 must be a background or that slot 5 must be a surface fill.
If slot 5 is gray, it should remain a low-prominence supporting gray unless the sample itself
clearly uses that exact supporting role in a visible accent. Slots 4 and 5 must not take over
the masthead or become the page's dominant background unless the sample's layout truly requires it.

`color_spec` is authoritative for the actual rendered website colors.
The sample palette is reference-only and exists solely to preserve the sample's hierarchy of
prominence, contrast, and placement. Do NOT copy the sample's literal colors into the final site.
Do NOT invent a new palette. Do NOT average the sample colors with `color_spec`.
Use `color_spec` for every live rendered color token.

Step 1 — Analyze the sample HTML's color usage and identify five prominence slots.
  Pre-normalized shortcut: if the sample's :root already contains `--color-*` variables
  with numbered role comments (e.g. `/* 1. Dominant — … */`), or if a <!-- PRE-EXTRACTED
  SAMPLE PALETTE --> comment appears at the top of the sample listing the five slots, use
  those values directly as slots 1–5 and skip color archaeology. Do not contradict them.
  This step is for prominence mapping only, not for choosing final literal colors.
  (a) slot 1 — dominant color in the masthead (either foreground or background)
  (b) slot 2 — second most dominant masthead color that is clearly distinct from slot 1
  (c) slot 3 — third distinct color used for headlines, sections, buttons, chips, or key accents
  (d) slot 4 — lower-prominence orthogonal supporting color
  (e) slot 5 — least-prominent orthogonal supporting color

Step 2 — In :root, under the comment /* ── Sample palette (reference) ── */,
  declare the five colors extracted from the sample as documentation:
    --dominant-ref:   <hex>;
    --secondary-ref:  <hex>;
    --tertiary-ref:   <hex>;
    --quaternary-ref: <hex>;
    --quinary-ref:    <hex>;

Step 3 — Express EVERY other color in the stylesheet exclusively as color-mix()
  combining only the five palette variables. Use oklch color space for perceptual
  uniformity. Examples:
    card border:      color-mix(in oklch, var(--quaternary) 35%, var(--dominant))
    hero overlay:     color-mix(in oklch, transparent 35%, var(--dominant))
    muted text:       color-mix(in oklch, var(--quaternary) 55%, var(--secondary))
    section alt-bg:   color-mix(in oklch, var(--dominant) 82%, var(--quaternary))
    nav blur-bg:      color-mix(in oklch, var(--dominant) 70%, transparent)
  Exceptions: keep red (#ef4444 range) for error/danger states and green (#22c55e range)
  for success indicators as literals — do not express these as color-mix().

Step 3a — The rendered five live palette variables must come directly from `color_spec`.
  Map them as:
    --dominant:   color_spec.slot1;
    --secondary:  color_spec.slot2;
    --tertiary:   color_spec.slot3;
    --quaternary: color_spec.slot4;
    --quinary:    color_spec.slot5;
  Do not substitute sample colors for these variables.
  Do not reorder these five live variables unless the prompt explicitly says otherwise.

Step 4 — Add this line inside :root so a hero background image can be injected later:
    --hero-bg-image: none;
  Apply it in the hero: background-image: var(--hero-bg-image), <gradient...>;

Usage constraints:
  - Keep slots 1–3 carrying most of the visual weight.
  - Use slots 4–5 sparingly for borders, subtle text, outlines, quiet chips, panel tint, or contrast support.
  - Large-area backgrounds, masthead washes, and major panels should usually derive from slots 1–3, not slot 5.
  - Do not let slot 5 become a page-wide wash, dominant panel.
  - Preserve the sample's hierarchy of prominence even after recoloring.
  - If the sample contains a raster masthead image, keep that image visibly legible under the overlay; do not bury it beneath opaque white, cream, or pale-gray layers.

═══════════════════════════════════════════════════
PART 3 — CONTENT SUBSTITUTION
═══════════════════════════════════════════════════

Use ONLY the data provided — never fabricate facts.

  hero headline     → resolved_strategy.positioning.headline
                      (fallback: resume_facts.personal.name + " — " + resume_facts.summary first sentence)
  hero subheadline  → resolved_strategy.positioning.subheadline
  value proposition → resolved_strategy.editorial.core_story (first 1–2 sentences)
  open-to roles     → resolved_strategy.desired_roles (render as pill chips)
  name / contact    → resume_facts.personal.*
  education         → resume_facts.education[] — all entries
  experience        → resume_facts.experience[] — all entries, all bullet points
  projects          → resume_facts.projects[] — all entries
  skills            → resume_facts.skills — all categories and items
  links             → resume_facts.personal.linkedin, github, website

  Headshot: {{HEADSHOT_HTML}}
  If headshot is empty, render the styled monogram placeholder described in PART 4 using initials: {{CANDIDATE_INITIALS}}

  If a resume field is absent, omit that element cleanly — no placeholder text.

  Hero uniqueness rule: every piece of text in the hero section must appear exactly once.
  Do NOT repeat the candidate's name, headline, subheadline, major, institution, or any
  other fact across multiple hero elements (e.g. do not show the name in both the heading
  and a separate label, or the headline in both the heading and a subtitle paragraph).

═══════════════════════════════════════════════════
PART 4 — VISUAL ENRICHMENT
═══════════════════════════════════════════════════

SVG icons — Experience entries:
  Every experience card MUST contain a small inline SVG icon (viewBox="0 0 24 24", size 32px).
  Choose a domain-appropriate icon for each entry based on the company/role context.
  Examples: circuit board paths for electrical engineering, flask for biotech,
  bar-chart for analytics, satellite dish for communications, microscope for research,
  gear for mechanical, code brackets for software, building for finance.
  Never repeat the same SVG design for two entries.

SVG icons — Project entries:
  Every project card MUST contain a unique inline SVG icon (approx. 2 inches wide).  Never repeat the same icon/emoji.

Masthead illustration:
  Domain context for this candidate: {{DOMAIN_CONTEXT}}

  {{HERO_IMAGE_INSTRUCTION}}

Headshot placeholder monogram:
  When {{HEADSHOT_HTML}} is empty, render a circular monogram element that:
  - Displays the candidate's initials ({{CANDIDATE_INITIALS}}) in large, bold text.
  - Uses a radial-gradient background blending --dominant and --tertiary.
  - Has a radial-gradient background blending --dominant and --tertiary.
  - Has a subtle dashed border: 2px dashed color-mix(in oklch, var(--dominant) 50%, var(--quinary)).
  - Carries a title attribute: title="Double-click to add your headshot"
  - Has a CSS class "headshot-placeholder" and an id="headshotPlaceholder".
  - Is sized to match where a real headshot photo would sit (min 96px, typically 120–160px diameter).
  - Includes a small camera emoji (📷) or icon beneath the initials at font-size 0.9rem, opacity 0.6,
    as a subtle visual cue that it is replaceable.
  Example structure:
    <div class="headshot-placeholder" id="headshotPlaceholder"
         title="Double-click to add your headshot">
      <span class="mono-initials">{{CANDIDATE_INITIALS}}</span>
      <span class="mono-hint">📷</span>
    </div>
  Style it so it looks intentional and polished, not like a broken image.

Maximum visual garnishment:
  - Retain ALL decorative SVG shapes, gradient orbs, rings, blobs, or animated elements
    from the sample. Do not simplify or remove them.
  - If the sample has any CSS animation (@keyframes), reproduce it.
  - Section dividers, clip-path cuts, and ::before/::after pseudo-element accents must
    all be preserved and adapted to the new palette.
  - Add subtle box-shadow depth to cards: box-shadow using color-mix() of --dominant.
  - The goal: a viewer should say "wow" within 3 seconds of loading the page.

═══════════════════════════════════════════════════
PART 5 — TECHNICAL REQUIREMENTS
═══════════════════════════════════════════════════

- Single self-contained HTML file. No external JS. No external CSS frameworks.
- Google Fonts: maximum 2 font families (import in <head>).
- Font Awesome 6 CDN is allowed for supplemental icons.
- Fully responsive: mobile (≤640px), tablet (641–1024px), desktop (>1024px).
- Semantic HTML5 elements: <header>, <nav>, <main>, <section>, <article>, <footer>.
- Smooth-scroll navigation. Sticky frosted-glass navbar.
- "Download Resume" button in navbar AND hero section (href="resume.pdf").
- Footer: © {{CURRENT_YEAR}} {{CANDIDATE_NAME}}. No other watermark or attribution.
- Do NOT use Mustache/Handlebars syntax. Output static HTML only.
- Do NOT reference any external image URLs. All images must be inline SVG or data URIs.
- color-mix() is required for ALL derived colors (see Part 2). No hardcoded hex values
  except the five --bp-* variables and functional red/green.

═══════════════════════════════════════════════════
INPUTS
═══════════════════════════════════════════════════

resume_facts:
{{RESUME_FACTS_JSON}}

resolved_strategy:
{{RESOLVED_STRATEGY_JSON}}

color_spec:
{{COLOR_SPEC_JSON}}

sample_website_html:
{{SAMPLE_HTML}}
