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
- Build a polished, editable portfolio website with real sections, not a wireframe.
- Include a clear hero, projects/work section, skills, about/profile, and contact/resume CTA.
- Include a headshot area that follows the headshot guidance.
- Prefer concise, strong copy. Do not invent employers, degrees, awards, metrics, links, or dates.
- If the resolved strategy conflicts with raw resume facts, keep the facts correct and use the strategy only for emphasis and organization.
- Make the result easy to edit later in the in-browser editor: use normal semantic HTML and CSS, avoid script-heavy behavior.

Implementation guidance:
- Let the design spec drive the overall composition.
- Let the resolved strategy drive narrative emphasis and section priority.
- Derive nearby colors with CSS functions from the five supplied colors when useful.
- If a fact is missing, omit it cleanly instead of inserting placeholders like "TBD".
- Keep the site self-contained: inline CSS and any lightweight JS in the HTML file.
