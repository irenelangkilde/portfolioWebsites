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
PART 2 — COLOR SYSTEM  (use the sample's full palette)
═══════════════════════════════════════════════════

The sample HTML already has a normalized palette declared in its `<style id="extracted-theme">`
block as `--c-1`, `--c-2`, …, `--c-N`, where N is the actual number of distinct color clusters
in the sample (typically anywhere from 4 to 18). These variables are ordered by visual weight
(count × chroma) — `--c-1` is the most visually prominent / chromatic color, `--c-2` the next,
and so on. Near-neutral grays/black/white sink to the high-N end. The companion
`<script id="color-palette">` JSON describes each cluster.

Do NOT collapse the palette into a fixed five-slot taxonomy (primary/secondary/tertiary/etc.).
The template's design uses as many slots as it needs.

`color_preferences` (when provided) describes the user's preferred colors as ANCHOR colors —
colors they want prominently featured. This is NOT a complete palette and you should NOT try
to squash the sample's full set of `--c-N` slots down to just these anchors. Treat anchors as
"the colors the user definitely wants prominent" and let the other `--c-N` slots keep filling
out the design.

Step 1 — Use the existing `--c-1` through `--c-N` variables from the sample's :root as-is.
  Do not invent new palette variable names. Do not rename them. The sample already has the
  right number of slots for its design. Preserve the sample's existing `<style id="extracted-theme">`
  block in your output.

Step 2 — Express every COLOR-MIX or relative-color expression using only the existing
  `--c-N` variables. Use oklch color space for perceptual uniformity. Examples:
    card border:      color-mix(in oklch, var(--c-2) 18%, var(--c-1))
    hero overlay:     color-mix(in oklch, transparent 35%, var(--c-1))
    muted text:       color-mix(in oklch, var(--c-2) 55%, var(--c-1))
    nav blur-bg:      color-mix(in oklch, var(--c-1) 70%, transparent)
  Exceptions: keep red (#ef4444 range) for error/danger states and green (#22c55e range)
  for success indicators as literals — do not express these as color-mix().

Step 3 — If `color_preferences` provides user-supplied anchor colors, assign them to slots by
  SEMANTIC BEST-FIT, not by positional order:

  3a. For each `--c-N` in the sample, identify the visual role it plays (hero background,
      primary CTA, card surface, body text, muted divider, etc.) by examining where the
      variable is referenced in the sample's CSS.

  3b. For each anchor, pick the `--c-N` slot whose current role + hue/temperature best matches
      the anchor's intent, then override that slot's value with the anchor's hex.
      Examples:
        - Anchor "deep navy" + sample uses `--c-2` as a dark heading/accent → override `--c-2`.
        - Anchor "warm copper" + sample uses `--c-4` as the warmest mid-chroma accent → override `--c-4`.
        - Anchor "soft cream" + sample uses `--c-3` as the off-white card surface → override `--c-3`.

  3c. Tie-breakers when multiple slots fit similarly:
        - Prefer the more prominent (lower-N) slot for the anchor the user listed first.
        - If the user supplied only one anchor and no slot is a clearly best match, override `--c-1`.

  3d. Keep all other `--c-N` slots intact — they're needed for the design's full color
      expression. Do NOT delete unused slots, rename them, or compress the palette to match
      the number of anchors. The user's anchors are an INPUT to the palette, not a
      REPLACEMENT for it.

  3e. If `color_preferences` is empty, do not modify any `--c-N` value — render the template
      with its original palette.

Step 4 — Add this line inside :root so a hero background image can be injected later:
    --hero-bg-image: none;
  Apply it in the hero: background-image: var(--hero-bg-image), <gradient...>;

Usage constraints:
  - Preserve the sample's hierarchy of prominence (which `--c-N` is used where) even after
    re-coloring. If the sample used `--c-1` as the dominant action color and `--c-3` as a
    card surface, keep that pattern.
  - Lower-N slots (`--c-1`, `--c-2`, `--c-3`) carry the most chromatic personality. Higher-N
    slots are typically neutrals; use them for backgrounds, borders, and muted text.
  - Within any one repeated section pattern, keep card styling systematic.
    Sibling cards in the same section should share the same surface/background treatment,
    border treatment, title color role, and chip/tag styling unless there is a real semantic reason not to.
  - Distinguish titles from chips intentionally.
    If card titles in a section use one role, keep that role stable across the section.
    If chips/tags use another role family, keep that role stable across the section.
    Do not mix title colors and chip colors arbitrarily from card to card.
  - Prefer one reusable section recipe:
    section heading role, card title role, body text role, chip role, border role.
    Apply that recipe uniformly across all sibling cards.
  - If the sample contains a raster masthead image, keep that image visibly legible under the overlay; do not bury it beneath opaque white, cream, or pale-gray layers.

═══════════════════════════════════════════════════
PART 3 — CONTENT SUBSTITUTION
═══════════════════════════════════════════════════

CONTENT vs. STRUCTURE — the fundamental rule:
  - The TEMPLATE (sample_website_html) determines page LAYOUT, section ORDER, hero
    panel structure, card grid shapes, decorative sub-elements (rings, waveforms,
    badges, diagonal dividers, etc.), and the VISUAL vocabulary.
  - The RESUME DATA (resume_facts) determines what CONTENT fills each container.
  - These two are orthogonal. The template tells you HOW MANY skill cards / experience
    rows / project tiles to lay out; the resume tells you WHAT GOES IN each one.
  - When the resume has more or fewer items than the template's sample shows, adjust
    the COUNT of cards to match the resume — do NOT pad the resume to match the
    template's count, and do NOT omit resume items to keep the template's count.

THE SAMPLE'S TEXT IS PLACEHOLDER — DISCARD IT:
  The sample HTML contains realistic-looking placeholder content (example skill chips
  like "Phonology, Syntax, Morphology" for a linguistics template; example project names
  like "Cross-Linguistic Vowel Analysis"; example experience entries; example bullet
  points). NONE OF THIS PLACEHOLDER TEXT MAY APPEAR IN THE OUTPUT.

  Sample → output transformation:
  - Sample's hardcoded skill items (chips, list items, level labels) → REPLACE with
    items from `resume_facts.factual_profile.skills`. If the resume has 5 programming
    languages and 3 tools, render exactly those 8 items in the appropriate categories.
  - Sample's hardcoded project cards/titles/descriptions → REPLACE with entries from
    `resume_facts.factual_profile.projects`.
  - Sample's hardcoded experience entries (company, title, dates, bullets) → REPLACE
    with entries from `resume_facts.factual_profile.experience`.
  - Sample's hardcoded education entries → REPLACE with entries from `education`.
  - Sample's hardcoded about/bio paragraphs → REPLACE with content derived from the
    resume, written in `resolved_strategy.editorial_direction.recommended_tone`.
  - Sample's hardcoded section titles ("Core Competencies", "Selected Work") → MAY be
    kept verbatim or rewritten in the same register, your choice.

  Self-check before emitting output: search the generated HTML for every literal text
  string that appeared in the sample. If ANY of them survives (a skill name, a project
  title, a company name, a date, a bullet) and that string isn't ALSO in the candidate's
  resume_facts, regenerate that section — you've left a placeholder behind.

Use ONLY the data provided — never fabricate facts.

  hero headline     → resolved_strategy.positioning.headline
                      (fallback: resume_facts.personal.name + " — " + resume_facts.summary first sentence)
  hero subheadline  → resolved_strategy.positioning.subheadline
  value proposition → resolved_strategy.editorial.core_story (first 1–2 sentences)
  open-to roles     → resolved_strategy.desired_roles (render as pill chips)
  name / contact    → resume_facts.personal.*
  education         → resume_facts.factual_profile.education[]
  experience        → resume_facts.factual_profile.experience[]
  projects          → resume_facts.factual_profile.projects[]
  skills            → resume_facts.factual_profile.skills
  links             → resume_facts.identity.contact.linkedin, other_links

═══════════════════════════════════════════════════
HARD ANTI-FABRICATION RULES (resume-driven sections)
═══════════════════════════════════════════════════

SKILLS — render ONLY items listed in `resume_facts.factual_profile.skills`.
  - Do NOT add a "Python" chip if Python isn't in the resume's skills list.
  - Do NOT add a "Communication" soft skill if it isn't stated.
  - Do NOT add a category that has zero items (e.g. if `programming_languages`
    is empty, omit the "Programming Languages" subgroup entirely).
  - Do NOT generalize ("MATLAB" → "Numerical Computing") — keep the exact term.
  - Do NOT split or merge entries to fill more chips. A single "React" item is one chip.

EDUCATION — render ONLY entries in `resume_facts.factual_profile.education[]`.
  - Use institution, degree, major, minor, graduation_date, gpa, honors as written.
  - Do NOT invent coursework, activities, awards, or thesis topics that aren't in
    that education entry.
  - If a field on an entry is empty, omit it from the card.

EXPERIENCE — render ONLY entries in `resume_facts.factual_profile.experience[]`.
  - Use company, title, dates, location, bullets as written.
  - Do NOT invent additional responsibilities, metrics, technologies, or
    accomplishments that aren't already in `bullets` or `technologies`.
  - The number of experience cards = the number of entries in the array. No more, no fewer.

PROJECTS, CERTIFICATIONS, PUBLICATIONS, LICENSES, PATENTS, HONORS, LEADERSHIP,
VOLUNTEER, ORGANIZATIONS, COURSES, TEST SCORES, LANGUAGES, PROFESSIONAL_INTERESTS:
  - Render exactly what's in the corresponding `resume_facts.factual_profile.*` array.
  - Omit the whole section if its source array is empty.

The only place creative writing is allowed is in the AI-generated `editorial_direction`
fields (headline, subheadline, core_story) and the section TITLES (e.g. "What I've Built"
instead of "Projects"). The actual factual content (names, dates, hex skills, bullets,
metrics) is verbatim from `resume_facts`.

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
  Project cards must also include a real project image area, not just an icon. Use an inline SVG illustration,
  data URI image, screenshot-style panel, mockup, chart, diagram, or other image-like visual that feels specific
  to that project. Do not render projects as icon-only cards.

Masthead illustration:
  Domain context for this candidate: {{DOMAIN_CONTEXT}}

  {{HERO_IMAGE_INSTRUCTION}}

Headshot placeholder monogram:
  When {{HEADSHOT_HTML}} is empty, render a circular monogram element that:
  - Displays the candidate's initials ({{CANDIDATE_INITIALS}}) in large, bold text.
  - Uses a radial-gradient background blending --primary and --accent.
  - Has a subtle dashed border: 2px dashed color-mix(in oklch, var(--primary) 50%, var(--background)).
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
  - Add subtle box-shadow depth to cards: box-shadow using color-mix() of --primary and --background.
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
  except the five semantic base variables and functional red/green.

═══════════════════════════════════════════════════
INPUTS
═══════════════════════════════════════════════════

resume_facts:
{{RESUME_FACTS_JSON}}

resolved_strategy:
{{RESOLVED_STRATEGY_JSON}}

{{COLOR_PREFERENCES_GUIDANCE}}

sample_website_html:
(The sample's existing `<style id="extracted-theme">` declares the full --c-1..--c-N palette.
Use those variables as-is; weave in user color preferences from above by overriding individual
--c-N values in :root — do NOT collapse the palette to a fixed number of slots.)

{{SAMPLE_HTML}}
