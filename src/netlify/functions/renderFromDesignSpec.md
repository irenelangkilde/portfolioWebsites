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
- Use the provided color scheme as key colors. Feel free to add complementary shades, neutrals and utility colors as needed.
- USER COLOR PREFERENCES: {{COLOR_PREFERENCES_GUIDANCE}}
  When the block above contains guidance, treat it as the authoritative color direction from the user. Interpret their mood or hue words into the semantic CSS variables (--c-1 … --c-5) and any derived tokens. The color spec JSON above already reflects this interpretation, so honor those hex values exactly.
- HERO IMAGE: {{SCENE_HERO_IMAGE_INSTRUCTION}}
- Regardless of composition, ALWAYS declare `--hero-bg-image: none;` in `:root` and use `background-image: var(--hero-bg-image)` on the hero section, layered over the color gradient (e.g. `background: linear-gradient(...), var(--hero-bg-image) center/cover no-repeat`). A separate AI image call may or may not supply an image; when it does, we override the `--hero-bg-image` variable client-side. When it doesn't, `none` renders as a no-op and the gradient shows alone.
- Declare the supplied colors as semantic CSS variables in `:root`:
  `--c-1`, `--c-2`, `--c-3`, `--c-4`, `--c-5`, and so forth.
- Build the rest of the color system from those variables using reusable derived tokens for surfaces,
  borders, muted text, shadows, chips, and overlays. Use only `color-mix()`-based derived variables and
  mixin-like reusable classes/component recipes rather than ad hoc hardcoded colors throughout the stylesheet.
- Build a polished, editable portfolio website with real sections, not a wireframe.
- Respect the design spec's `main_section_mode`. It sets the BASELINE for the hero and the primary
  content sections: "light" → they must use a light canvas with dark text; "dark" → a dark canvas
  with light text. Pick whichever palette slots give you that pairing. This is a deliberate user
  choice — do not start dark because the palette looks better dark, or because the style token
  suggests it.
- CANVAS: {{CANVAS_GUIDANCE}}
  This is computed from the actual palette hexes, so it already accounts for whether the supplied
  colours can carry the requested mode. Follow it literally. A palette is a set of key colours, not
  a restriction to only those colours — neutrals and surfaces may always be added to satisfy
  `main_section_mode`.
- Respect the design spec's `alternate_sections`, which is a separate axis from the baseline above.
  When true, sections alternate between contrasting light and dark treatments, STARTING from the
  `main_section_mode` baseline. When false, every section keeps the baseline treatment throughout.
- Include a clear hero, about/profile, projects/work section, skills, and contact/resume CTA.
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

Design vocabulary:
The design spec's `composition` and `style` values are TOKENS, and these are their definitions.
They come from a dropdown the user picked from, so they are deliberate choices, not hints —
match the definition even when another arrangement would look good to you.

COMPOSITION — governs the hero layout:
- "central" — symmetric centered hero. Headline, subheadline and CTAs sit on the page's
  vertical axis; any visual (monogram, motif, scene) is centered above, below or behind them.
  This is NOT a two-column split: do not place the visual in a column beside the copy.
- "split-left" — two-column hero: content on the LEFT, visual on the RIGHT.
- "split-right" — two-column hero: visual on the LEFT, content on the RIGHT.
- "scene-based" — hero built around a photographic or illustrated scene (lab, desk, workshop,
  field) sitting behind or beside the copy.
- "abstract_layered" — layered abstract composition built from motifs, rings, grids and
  overlapping shapes rather than a single figure or a two-column split.

STYLE — governs typography, texture and visual treatment:
- "clean-minimal" — whitespace-first, restrained hierarchy, single focus per section
- "elegant"       — refined typography, generous pacing, subtle textures
- "modern"        — contemporary sans-serif hierarchy, 3D or gradient hero visuals
- "classic"       — conventional, brand-led business layout: structured sections, a small
                    disciplined palette, nothing experimental
- "fun"           — playful cartoon accents and illustrative flourishes
- "bold"          — oversized display type, high-impact composition
- "glassmorphism" — frosted-glass cards, blurred backdrop layering
- "brutalist"     — industrial capitals, raw grids, coarse textures
- "terminal"      — monospace typography and terminal-chrome layout
- "editorial"     — serif-forward with magazine-style hierarchy
- "swiss-grid"    — visible grid system, systematic sans-serif composition (see note below)
- "neon-tech"     — saturated accents, futuristic technical vibe
- "other"         — no fixed meaning. The style arrives as free text instead: either the
                    token is "other" and the description sits beside it, or the style value is
                    itself a phrase not in this list. Either way, follow that wording literally
                    rather than substituting the nearest token above.

Style and colour are SEPARATE axes. A vivid or dark palette does not make the style "neon-tech",
and a muted palette does not make it "clean-minimal" — the style token alone decides typography
and treatment. Render the requested style using whatever colours the colour spec supplies.

`render_mode` — governs how illustrations, hero art and project visuals are drawn. It is an art
direction for imagery only; it does not override `style` or `composition`. Values are descriptive
phrases the user picked, e.g. "cinematic technical minimalism", "3D scientific elegance",
"bold futuristic", "technical schematic aesthetic", "stylized scientific illustration",
"cinematic concept art", "clean editorial vector", "gradient 3D illustration". Render every inline
SVG, diagram and hero visual in the named manner. Empty means you choose.

`density` — "compact" → tighter section padding and 3-column grids; "medium" → balanced;
"spacious" → generous padding and 1–2-column grids.

`use_emoji_icons` — when true, emoji or icon glyphs may be used for section icons and skill badges.
When FALSE, use no emoji and no icon glyphs anywhere, including in headings, chips, list bullets,
badges and contact rows. Substitute typographic or CSS-drawn marks instead.

Style-specific notes:
Apply only the note matching the design spec's style token; ignore the others.
- "swiss-grid" — the visible grid IS the style, so it must read as a deliberate design element
  rather than a subliminal texture. Draw real 1px solid rules on the column boundaries and
  section divisions of the layout you actually use, and align content to them so the system
  reads as intentional. Strength: roughly 28–35% of the body-text colour against the page
  background, e.g. `color-mix(in oklch, <your body text colour> 30%, transparent)`; never go
  below 22%. The grid should be plainly legible at a glance on a normal display without leaning
  in — err on the side of too strong rather than too subtle, since anything under ~20% reads as
  screen dirt rather than as a design system. It should still sit behind the content in the
  hierarchy: visible structure, not a foreground element competing with text. On dark sections
  invert: a light rule at the same strength. Keep rules crisp and orthogonal — no diagonals, no
  blur, no gradients applied to the rules themselves. Use a heavier rule (2px, or a step up in
  strength) for major section divisions so the grid reads as hierarchical rather than uniform.

Implementation guidance:
- Let the design spec drive the overall composition.
- Let the resolved strategy drive narrative emphasis and section priority.
- Derive nearby colors with CSS functions from the supplied colors when useful.
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
- Keep the site self-contained except for images: inline CSS and any lightweight JS in the HTML file.  Insert "a href" placeholders for png/jpg images.
