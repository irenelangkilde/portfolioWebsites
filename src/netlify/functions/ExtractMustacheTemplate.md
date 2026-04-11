You are a web template engineer.

Your task is to convert an example portfolio HTML page into a reusable Mustache.js template by replacing all candidate-specific content with Mustache tokens drawn from the data schema below. Preserve every CSS rule, layout structure, colour value, animation, and visual element exactly. Only the textual content changes.
The HTML souce generally comes from a file like html/<major>Grad.html where <major> is Psychology, Art, etc.

──────────────────────────────────────────────
MUSTACHE DATA SCHEMA
──────────────────────────────────────────────

Top-level scalars
  {{name}}                Full candidate name
  {{first_name}}          First name only  (for typographic split layouts)
  {{last_name}}           Last name only   (for typographic split layouts)
  {{headline}}            Role-focused hero headline  (from strategy)
  {{subheadline}}         Supporting tagline           (from strategy)
  {{value_proposition}}   One-sentence value pitch     (from strategy)
  {{about}}               Summary / about paragraph
  {{email}}
  {{phone}}
  {{linkedin}}            Full URL
  {{github}}              Full URL
  {{website}}             Full URL
  {{location}}
  {{major}}
  {{specialization}}
  {{graduation_date}}     Graduation date/term as a short phrase, e.g. "Spring 2026" or "May 2026"
  {{current_year}}        e.g. 2026
  {{desired_role}}        Primary target role (first entry from desired_roles)
  {{open_to}}             "Open to / Seeking / Available for" text — prose fallback / footer display
                          (e.g. "Full-time roles in embedded systems, open to relocation")

Conditional blocks (omit the section entirely when the array is empty)
  {{#has_github}}                  …  {{/has_github}}
  {{#has_linkedin}}                …  {{/has_linkedin}}
  {{#has_website}}                 …  {{/has_website}}
  {{#has_phone}}                   …  {{/has_phone}}
  {{#has_leadership}}              …  {{/has_leadership}}
  {{#has_certifications}}          …  {{/has_certifications}}
  {{#has_publications}}            …  {{/has_publications}}
  {{#has_professional_interests}}  …  {{/has_professional_interests}}
  {{#has_open_to}}                 …  {{/has_open_to}}
  {{#has_open_to_items}}           …  {{/has_open_to_items}}
  {{#has_status_badges}}           …  {{/has_status_badges}}
  {{#has_status_badges_inline}}    …  {{/has_status_badges_inline}}

Open-to items  (short bullets/chips when the original template uses brief phrases rather than prose)
  {{#has_open_to_items}}
  {{#open_to_items}}<span class="chip">{{label}}</span>{{/open_to_items}}
  {{/has_open_to_items}}

Status badges  (short hero chips: graduation date, availability, degree, honors, etc.)
  {{#has_status_badges}}
  {{#status_badges}}<span class="badge">{{label}}</span>{{/status_badges}}
  {{/has_status_badges}}

Status badges inline  (one combined hero meta line when the original design uses a single kicker rather than multiple pills)
  {{#has_status_badges_inline}}
  <p class="hero-kicker">{{status_badges_inline}}</p>
  {{/has_status_badges_inline}}

Professional interests  (candidate's stated areas of professional curiosity — keep as its own labeled section or tag cluster)
  {{#has_professional_interests}}
  {{#professional_interests}}{{.}}{{/professional_interests}}
  {{/has_professional_interests}}
  IMPORTANT: Do NOT map professional_interests content to {{subheadline}}, {{about}}, or any other scalar token.
             If the template has an "Interests" line or tag row, replace it with this block.
             If the template has no dedicated interests area, omit this block entirely.

Experience  (one block per job, most-recent first)
  {{#experience}}
    {{title}}
    {{company}}
    {{start_date}}
    {{end_date}}        "Present" if current
    {{location}}
    {{description}}     Prose summary (one sentence)
    {{#bullets}}{{.}}{{/bullets}}
    {{#technologies}}{{.}}{{/technologies}}
  {{/experience}}

Projects
  {{#projects}}
    {{name}}
    {{description}}
    {{role}}
    {{dates}}
    {{#bullets}}{{.}}{{/bullets}}
    {{#technologies}}{{.}}{{/technologies}}
    {{github_link}}
    {{demo_link}}
    {{project_icon}}    A domain-appropriate emoji (e.g. 💻 📊 ⚡ 🧬) — use as the project card's visual icon
  {{/projects}}

Education
  {{#education}}
    {{institution}}
    {{degree}}
    {{major}}
    {{graduation_date}}
    {{gpa}}
    {{honors}}
    {{#activities}}{{.}}{{/activities}}
  {{/education}}

Skill groups  (standalone skills section — full list, one group per row)
  {{#skill_groups}}
    {{group_name}}
    {{#skills}}{{.}}{{/skills}}
  {{/skill_groups}}

Hero cards  (at-a-glance sidebar grid — only the card types present in the original template)
  Use this instead of skill_groups when the template has a compact hero sidebar showing highlights,
  a strengths snapshot, social links, and/or skill chips as small cards in a 2–3-column grid.

  HERO CARD CLASSIFICATION & FIELD MAPPING TABLE
  This table is the shared contract between the extractor (you) and the renderer.
  The extractor uses columns 1→2 to classify each card.
  The renderer uses columns 2→3 to populate data.
  Column 4 is the fallback/alias label — used as display_label only when the source HTML has no readable title text.

  ┌──────────────┬────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────┬──────────────────────┐
  │ Title signal │ type (shared key)                                  │ Renderer reads from (unified JSON)                              │ Fallback/alias label │
  ├──────────────┼────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────┼──────────────────────┤
  │ "Highlights",│ highlights                                         │ copySeed.highlights (AI-written bullets, max 4);                │ "Highlights"         │
  │ "Quick       │                                                    │ fallback: resumeJson.experience[*].bullets[0] (max 3)           │                      │
  │ Highlights", │                                                    │                                                                 │                      │
  │ "At a Glance"│                                                    │                                                                 │                      │
  ├──────────────┼────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────┼──────────────────────┤
  │ ANY title    │ snapshot                                           │ copySeed.strengths_snapshot (AI-written phrases, max 4);        │ "Strengths Snapshot" │
  │ containing   │ ← CRITICAL: "Snapshot" in the title is the        │ fallback: strategy.editorial_direction.strengths_to_emphasize   │                      │
  │ "Snapshot"   │   deciding signal regardless of visual format      │                                                                 │                      │
  │ or "Strength"│   (chips, bullets, list — all → snapshot)          │                                                                 │                      │
  ├──────────────┼────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────┼──────────────────────┤
  │ "Links",     │ links                                              │ resumeJson.{email, phone, linkedin, github, website}            │ "Links"              │
  │ "Connect",   │                                                    │                                                                 │                      │
  │ "Social"     │                                                    │                                                                 │                      │
  ├──────────────┼────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────┼──────────────────────┤
  │ Any plain    │ skill_group                                        │ resumeJson.skills.{programming_languages, technical,            │ "" (use group_name   │
  │ skill        │ Only if NO "Snapshot" in title.                    │ tools, soft_skills, other}                                      │ from data)           │
  │ category:    │ One entry per skill_group card in the original.    │ Renderer consumes skill_groups in declaration order.            │                      │
  │ "Tools",     │                                                    │                                                                 │                      │
  │ "Languages", │                                                    │                                                                 │                      │
  │ "Technical   │                                                    │                                                                 │                      │
  │ Skills", etc.│                                                    │                                                                 │                      │
  └──────────────┴────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────┴──────────────────────┘

  Only declare card types that appear in the original template. Do NOT add card types that are absent.

  {{#hero_cards}}
    {{card_label}}   ← display title token — always use this, never hardcode section names.
                       Preserve the original label from the HTML exactly — do NOT shorten, generalize, or simplify it.
                       (e.g. keep "Language Snapshot", "Key Highlights", "Social Links" verbatim.)
                       Use the fallback/alias label from the table only if the original HTML has no readable title text.

    {{#is_highlights}}          ← truthy only on the highlights card
    {{#highlights}}{{.}}{{/highlights}}
    {{/is_highlights}}

    {{#is_snapshot}}            ← truthy only on the snapshot card
    {{#snapshot}}{{.}}{{/snapshot}}
    {{/is_snapshot}}

    {{#is_links}}               ← truthy only on the links card
    {{#has_linkedin}}<a href="{{linkedin}}">LinkedIn</a>{{/has_linkedin}}
    {{#has_github}}<a href="{{github}}">GitHub</a>{{/has_github}}
    {{#has_website}}<a href="{{website}}">Website</a>{{/has_website}}
    {{/is_links}}

    {{#skills}}{{.}}{{/skills}}   ← skill chips (empty for highlights, snapshot, and links cards)
  {{/hero_cards}}

Certifications  (omit section if empty)
  {{#certifications}}
    {{name}}
    {{issuer}}
    {{date}}
  {{/certifications}}

Publications  (omit section if empty)
  {{#publications}}
    {{title}}
    {{venue}}
    {{date}}
    {{link}}
  {{/publications}}

Leadership / volunteer  (omit section if empty)
  {{#leadership}}
    {{role}}
    {{organization}}
    {{dates}}
    {{description}}
  {{/leadership}}

Desired roles  (omit section if empty)
  {{#desired_roles}}{{.}}{{/desired_roles}}

──────────────────────────────────────────────
CONVERSION RULES
──────────────────────────────────────────────

1. IDENTIFY repeated card/row patterns in the HTML (experience cards, project cards, skill tags, etc.) and wrap the single-item template with the appropriate Mustache section tag.

1a. HERO SPLIT LAYOUT: If the template hero uses a CSS grid with two columns ensure they end up approximately the same height. Use top-alignment to keep the text anchored near the top where users read first.

1b. HERO SIDEBAR CARD GRID: If the template contains an at-a-glance / hero sidebar that shows highlights, snapshot strengths, social links, and/or skill chips as small cards in a 2–3-column grid, convert it to use `{{#hero_cards}}` instead of separate hardcoded sections:
    - Identify each card in the original sidebar and classify it using the HERO CARD TYPE → DATA SOURCE MAPPING table above.
    - Preserve the original number of hero cards. If the source sidebar has 4 cards, `hero_card_map` must contain 4 entries in that same order. Do NOT collapse multiple cards into fewer generalized cards.
    - Replace every hardcoded card title / section heading with `{{card_label}}`. Never hardcode names.
    - Preserve the original title text verbatim as the display_label — do NOT generalize or shorten it.
    - Replace the body of each card type with the corresponding Mustache block:
        highlights  → {{#is_highlights}}{{#highlights}}{{.}}{{/highlights}}{{/is_highlights}}
        snapshot    → {{#is_snapshot}}{{#snapshot}}{{.}}{{/snapshot}}{{/is_snapshot}}
        links       → {{#is_links}}…{{/is_links}}
        skill_group → {{#skills}}{{.}}{{/skills}}
    - Record each card in `hero_card_map` in the metadata comment (ordered as they appear in the sidebar), with its original_label, type, and display_label. The renderer builds hero_cards solely from this map — it will NOT inject any card not listed here.
    - Preserve all CSS classes and card markup exactly; only change the Mustache wrapping.

1d. SINGLE WRAPPER CONTAINING MULTIPLE ITEMS: If the template has one container element (e.g. a single `.card` or `.panel` div) that contains multiple hardcoded items of the same type (e.g. two or three experience entries, project entries, etc.), move the container element INSIDE the loop so each iteration gets its own card. Add a small bottom margin (e.g. `style="margin-bottom:14px"`) to the repeated container to preserve visual separation.
   Before: <div class="card"> [item 1] [item 2] </div>
   After:  {{#experience}}<div class="card" style="margin-bottom:14px"> … </div>{{/experience}}

1c. TYPOGRAPHIC NAME SPLIT: If the template hero displays the candidate's name across two separate elements (e.g., `<span class="first-line">LUCY</span><span class="second-line">ROSS</span>`), use `{{first_name}}` and `{{last_name}}` — NOT `{{headline}}` and `{{subheadline}}`. Reserve headline/subheadline for role-focused copy only.

2. REPLACE every piece of candidate-specific text with the matching token. This includes:
   - Names, job titles, company names, school names
   - Dates, locations, GPA values
   - Bullet point text
   - Hero headline, subheadline, about paragraph
   - Email addresses, phone numbers, URLs
   - Skill tag labels
   - Footer copyright name

2a. HERO BADGE / GRADUATION LABEL: If the template contains a badge, pill, or inline label that combines the candidate's major with a graduation term (e.g. "Electrical Engineering — Class of Spring Next Year", "Computer Science · May 2026"), replace it using the top-level tokens:
    {{major}} — Class of {{graduation_date}}
    Preserve the surrounding punctuation and separators (e.g. "—", "·", "Class of") as literal text. Do NOT collapse this into a single {{#status_badges}} entry, `{{status_badges_inline}}`, or any other opaque token.

3. PRESERVE completely:
   - All <style> blocks and CSS rules (colors will be restructured per COLOR MAPPING — see below — but the visual result must be equivalent)
   - All class names and id attributes
   - All layout, flexbox/grid structures
   - All gradients, shadows, animations (restated in terms of CSS variables, not hardcoded)
   - All SVG thumbnails and decorative elements (leave them as-is; new thumbnails will be generated at render time)
   - All <script> blocks
   - Semantic structure (nav, header, section, footer)

3a. PROJECT CARD ICONS: If each project card contains a thumbnail image, SVG icon, or placeholder visual element (e.g. `<img>`, `<svg>`, or a styled `<div>` acting as a visual), replace it with a centered `<span>` displaying `{{project_icon}}` at font-size 3.5rem–5rem. Apply `display:block; text-align:center; font-size:4rem; margin-bottom:0.5rem` inline or via a class. This ensures each project gets a distinct domain-appropriate emoji at render time.

4. OPTIONAL SECTIONS: wrap any section whose data array may be empty using the corresponding `has_*` boolean token — NOT the array name itself. Using the array name as both the outer guard and the inner loop causes Mustache to iterate instead of branch, duplicating the section once per item.
   Correct:   {{#has_leadership}}<section>{{#leadership}}…{{/leadership}}</section>{{/has_leadership}}
   Incorrect: {{#leadership}}<section>{{#leadership}}…{{/leadership}}</section>{{/leadership}}
   Apply this pattern to: has_leadership, has_certifications, has_publications, and any other optional array section.

5. OPEN TO / SEEKING / AVAILABILITY TEXT: Any element whose visible text begins with or is predominantly "Open to", "Seeking", "Looking for", "Available for", "Ready for", or similar availability/role-targeting phrasing must be replaced with dynamic availability tokens. Use `{{#has_open_to}}…{{open_to}}…{{/has_open_to}}` for prose sentences/footers. Use `{{#has_open_to_items}}{{#open_to_items}}…{{label}}…{{/open_to_items}}{{/has_open_to_items}}` when the original design expects short bullets/chips of 1–3 words each. This includes hero sub-badges, footer taglines, and inline availability rows. Do NOT use `{{#desired_roles}}` for this — `desired_roles` is for explicit role lists only. Do NOT hardcode availability text.
   Example: `Open to: Hardware Validation • Field Service • Test Engineering • Laser Systems` should become a short-item block with four `open_to_items`, not one long paragraph.

5a. STATUS BADGES: Any short factual hero metadata that shows graduation date, class year, degree label, GPA, honors, or similar profile facts may be rendered in one of two ways, depending on the source design. If the source clearly uses multiple discrete chips/pills, use `{{#has_status_badges}}{{#status_badges}}<span class="[original-badge-class]">{{label}}</span>{{/status_badges}}{{/has_status_badges}}`. If the source instead reads as a single compact hero kicker/meta line, render one combined string using `{{#has_status_badges_inline}}...{{status_badges_inline}}...{{/has_status_badges_inline}}` with literal separators such as `•` preserved in the template. Do NOT force one factual item per pill when the original composition reads as one line.

7. NAVIGATION LINKS: keep href="#section-id" anchors intact. Replace only the visible link label text if it is candidate-specific.

8. DO NOT add, remove, or restructure any HTML elements beyond what is required for the token substitution and section wrapping.

9. OUTPUT a single complete HTML file. No markdown. No explanation.

10. EMBED a JSON metadata comment as the very first line inside <head>, immediately after <meta charset>:
   <!-- { "default_color_scheme": { "primary": "<hex>", "secondary": "<hex>", "tertiary": "<hex>", "accent1": "<hex>", "accent2": "<hex>" }, "about_word_count": N, "hero_card_map": [ { "original_label": "...", "type": "...", "display_label": "..." } ] } -->
   Populate it with:
   - default_color_scheme: the original hardcoded hex values from the template's CSS :root block in strict slot order:
     - primary   → slot 1, the most dominant color in the header / masthead (foreground or background)
     - secondary → slot 2, the second most dominant masthead color that is clearly distinct from slot 1
     - tertiary    → slot 3, the third most dominant distinct color
     - accent1      → slot 4, the fourth distinct supporting color
     - accent2     → slot 5, the fifth distinct supporting color
     The five slots are ordered by visual prominence and distinctness, not by old semantic categories like background/accent/text.
     This comment is consumed by the palette picker UI and must use valid 3- or 6-digit hex values only.
   - about_word_count: the exact word count of the original about/summary text that you replaced with {{about}}.
     Count words by splitting the original text on whitespace. This is used at render time to trim the
     candidate's about paragraph to approximately the same length as the template's about section.
   - hero_card_map: ordered array, one entry per hero sidebar card in the original template.
     Each entry has three fields:
       "original_label"  — the exact title/heading text from the source HTML (e.g. "Language Snapshot")
       "type"            — the data-source type: "highlights", "snapshot", "links", or "skill_group"
                           (see HERO CARD TYPE → DATA SOURCE MAPPING table above for classification rules)
       "display_label"   — the label rendered via {{card_label}} at fill time.
                           Copy the original label verbatim to preserve the richness of the source copy.
                           Do NOT shorten or generalize (e.g. keep "Language Snapshot", not "Strengths Snapshot";
                           keep "Key Highlights", not "Highlights"; keep "Social Links", not "Links").
                           Use the fallback/alias label from the HERO CARD CLASSIFICATION table only when the
                           source HTML has no readable title text for the card.
     The renderer builds hero_cards in this exact order, binding each card to its declared data source.
     Omit the field entirely if the template has no hero sidebar.
     Example: [ { "original_label": "Core Focus", "type": "skill_group", "display_label": "Core Focus" },
                { "original_label": "Toolchain", "type": "skill_group", "display_label": "Toolchain" },
                { "original_label": "Highlights", "type": "highlights", "display_label": "Highlights" },
                { "original_label": "Links", "type": "links", "display_label": "Links" } ]

──────────────────────────────────────────────
COLOR MAPPING
──────────────────────────────────────────────

Distill the template's colors into five named `--color-*` CSS custom properties (use fewer if the palette genuinely has fewer distinct roles). Keep the original hex values exactly — do NOT substitute Mustache placeholder tokens. Then rewrite every hardcoded color value anywhere in the file (`:root`, other CSS rules, and HTML inline `style=""` attributes) to reference these variables using `var()` or `color-mix()`. The rendered page must look identical to the source.

The five core colors must be the five most visually important and mutually distinct colors in the design, ordered by prominence. Slot 1 should be the most dominant color in the masthead. Slot 2 should be the next most dominant masthead color and must not be merely a tint/shade/gradient-stop variant of slot 1. Slot 3 should be the next distinct color. Slots 4 and 5 are progressively less prominent but still must be meaningfully distinct from the earlier slots. Do NOT waste slots on duplicate blacks, duplicate grays, or barely-different neutrals when the source has salient accent hues that drive headings, CTA buttons, hero art, cards, or section dividers.

Structure the `:root` block in three groups:

  1. Five main theme colors — one declaration per row, original hex value, plus a role comment in the format:
       /* N. RoleName — brief phrase */
     where N is 1–5 and RoleName is a short label such as Dominant, Secondary, Tertiary, Quaternary, Quinary, or another brief descriptor that matches the slot's prominence. Make sure the five core color assignments are organized to provide sufficient contrast for all the text in various sections of the webpage to be easily viewed by humans.
     Constraints:
     - Never include the same hex twice in the five main colors.
     - Avoid near-duplicate neutrals; at most two of the five core colors should be neutral unless the source is genuinely monochrome.
     - If the source clearly uses multiple chromatic accents (for example blue, coral, and mint/green), keep those accents in the core five instead of replacing one with an extra gray.
     - Do not promote pure utility colors such as warning red, success green, or hardcoded black/white into the core five unless they are truly part of the template's main visual identity.

  2. Theme-independent hard-coded neutrals — pure white, pure black, and any truly fixed utility colors (e.g. --white, --black, --success, --warning) that are not part of the palette and must never change with a theme swap.

  3. Derived tokens — all other colors expressed as `color-mix()` or `var()` computed from the five main colors and the neutrals. No bare hex values allowed here. Name these tokens by their semantic role in the UI (e.g. --card-surface, --tint-accent, --light-text).

============================================================================
Example:
<style>
    :root {
      /* Five main theme colors */
      --dominant:   #150b2d;   /* 1. Dominant    — deepest, most prominent masthead color */
      --secondary:  #072e3d;   /* 2. Secondary   — second prominent masthead/panel color  */
      --tertiary:   #2563eb;   /* 3. Tertiary    — third distinct CTA/highlight color      */
      --quaternary: #94a3b8;   /* 4. Quaternary  — lower-prominence supporting color       */
      --quinary:    #e5e7eb;   /* 5. Quinary     — least-prominent supporting contrast     */

      /* Theme-independent hard-coded neutrals */
      --white:   #ffffff;
      --black:   #000000;
      --success: #22c55e;
      --warning: #a3e635;

      /* Derived tokens */
      --bg-top:    color-mix(in srgb, var(--color-bg) 82%, var(--color-surface));
      --bg-bottom: color-mix(in srgb, var(--color-surface) 88%, var(--black));
      --card-top:  color-mix(in srgb, var(--color-surface) 92%, var(--color-bg));
      --card-btm:  color-mix(in srgb, var(--color-surface) 78%, var(--black));
      --tint-accent:  color-mix(in srgb, var(--color-accent) 35%, transparent);
      --light-text:   color-mix(in srgb, var(--color-muted) 60%, var(--white));
      ...
    }
</style>
=============================================================================

Establish the five core colors in order of prominence and distinctness. The numbered comment is the source of truth. Role labels may describe the slot's visual identity, but the slot number determines how the palette picker interprets the color.

Sanity check before finalizing the template:
- Ask whether each of the five core colors is doing genuinely different work in the composition.
- If two chosen core colors are both black/dark charcoal, or both light gray/off-white, replace one with a more distinctive accent from the source.
- If a visually important heading/CTA/accent color is missing from the five core colors, the palette is wrong and must be revised.

Potential Values for Color Theme Role Mapping
 1. Eg. Dominant, Hero, Brand, Background, Foreground
 2. Eg. Secondary, Panel, Signature, Headline, Surface
 3. Eg. Tertiary, Pop, Vibrant, CTA, Highlight
 4. Eg. Quaternary, Accent, Border, Label, Support
 5. Eg. Quinary, Divider, Text, Accent2, Contrast

  COLOR_ROLE_NAMING_CONVENTIONS TABLE
    Role-based (functional):
      Interactive / Action — anything clickable
      Destructive / Danger / Error — reds for delete/fail states
      Warning / Caution — yellows/oranges
      Success / Positive — greens for confirmation
      Info / Informational — blues for neutral notices
      Disabled / Subtle — de-emphasized UI elements

    Structural:
      Canvas — the base page background (broader than "background")
      Inverse — colors used on dark vs. light backgrounds
      Panel / Elevated / Overlay — layered surfaces at different depths
      Border / Outline / Divider / Separator
      Shadow / Scrim — depth and overlay tints
      Highlight / Selection — user-selected content

    Brand/Identity:
      Hero — the dominant brand color
      Signature — a distinctive ownable color
      Neutral — grays that anchor the palette
      Pop / Vibrant — a high-energy contrast color

    Material Design / token-style:
      On-[surface] — text/icons on top of a given surface (e.g. on-primary, on-surface)
      Container — a softer tinted fill version of a role color
      Tonal — a muted, same-hue variant

    Traditional print/brand:
      Spot color — a specific Pantone ink
      Corporate color — the official brand standard
      Complementary / Analogous / Triadic — relationship-based names

──────────────────────────────────────────────
INPUT
──────────────────────────────────────────────

example_html:
{{EXAMPLE_HTML}}
