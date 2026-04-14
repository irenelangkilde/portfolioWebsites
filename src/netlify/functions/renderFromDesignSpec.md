Generate a complete single-file HTML portfolio website for a job-seeking graduate.

Inputs:
- major: {{MAJOR}}
- specialization: {{SPECIALIZATION}}
- resume facts JSON: {{RESUME_FACTS_JSON}}
- resolved content strategy JSON: {{RESOLVED_STRATEGY_JSON}}
- design spec JSON: {{DESIGN_SPEC_JSON}}
- color spec JSON: {{COLOR_SPEC_JSON}}
- headshot guidance: {{HEADSHOT}}
- year: {{YEAR}}

Requirements:
- Output only one complete HTML document starting with `<!DOCTYPE html>`.
- Do not output markdown, explanations, JSON, or commentary.
- Use the resume facts as the source of truth for factual content.
- Prioritize the resolved strategy JSON for what to emphasize, ordering, tone, and positioning.
- Follow the design spec closely for composition, style, density, render mode, emoji/icon usage, and section alternation.
- Use the provided five-color scheme directly for the core palette. Keep neutrals and utility colors hardcoded when needed.
- Declare the five supplied colors as semantic CSS variables in `:root`:
  `--background`, `--foreground`, `--primary`, `--secondary`, `--accent`.
- Build the rest of the color system from those variables using reusable derived tokens for surfaces,
  borders, muted text, shadows, chips, and overlays. Prefer `color-mix()`-based derived variables and
  mixin-like reusable classes/component recipes rather than ad hoc hardcoded colors throughout the stylesheet.
- Build a polished, editable portfolio website with real sections, not a wireframe.
- Include a clear hero, projects/work section, skills, about/profile, and contact/resume CTA.
- Include a headshot area that follows the headshot guidance.
- Prefer concise, strong copy. Do not invent employers, degrees, awards, metrics, links, or dates.
- If the resolved strategy conflicts with raw resume facts, keep the facts correct and use the strategy only for emphasis and organization.
- Make the result easy to edit later in the in-browser editor: use normal semantic HTML and CSS, avoid script-heavy behavior.
- Within any one section, repeated UI patterns must use a consistent color system.
  For example: cards in the same section should share the same surface/background treatment,
  border treatment, and title color role unless there is a deliberate semantic reason not to.
- Titles/headings and chips/tags must not compete for the same role by accident.
  If a section uses colored chips, keep chip text/background styling consistent across that
  section and keep section/card titles on a distinct, stable text role.
- Do not let one card in a repeated set use `primary` while a sibling card uses `accent`
  for the same kind of heading or chip. Repeated components should be visually systematic.

Implementation guidance:
- Let the design spec drive the overall composition.
- Let the resolved strategy drive narrative emphasis and section priority.
- Derive nearby colors with CSS functions from the five supplied colors when useful.
- Keep the palette architecture explicit and reusable:
  - base semantic variables in `:root`
  - derived component tokens from those base variables
  - shared classes/recipes for repeated card and chip patterns
- Prefer one section recipe per repeated pattern:
  - section title color = one role
  - card title color = one role
  - body text color = one role
  - chips/tags = one role family
  Then reuse that recipe consistently for all sibling cards in the section.
- Projects must include image-like visuals, not icon-only cards. Each project should have a substantial
  visual region such as a screenshot-style panel, mockup, diagram, chart, technical illustration, or
  other inline SVG/data-URI image treatment that feels specific to the project.
- Icons or emoji may be used as supporting accents, but they must not be the only project visual.
- If a fact is missing, omit it cleanly instead of inserting placeholders like "TBD".
- Keep the site self-contained: inline CSS and any lightweight JS in the HTML file.
