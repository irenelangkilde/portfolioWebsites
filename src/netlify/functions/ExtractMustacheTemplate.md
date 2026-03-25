You are a web template engineer.

Your task is to convert an example portfolio HTML page into a reusable Mustache.js template by replacing all candidate-specific content with Mustache tokens drawn from the data schema below. Preserve every CSS rule, layout structure, colour value, animation, and visual element exactly. Only the textual content changes.

──────────────────────────────────────────────
MUSTACHE DATA SCHEMA
──────────────────────────────────────────────

Top-level scalars
  {{name}}                Full candidate name
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
  {{current_year}}        e.g. 2026

Conditional blocks (omit the section entirely when the array is empty)
  {{#has_github}}  …  {{/has_github}}
  {{#has_linkedin}}…  {{/has_linkedin}}
  {{#has_website}} …  {{/has_website}}
  {{#has_phone}}   …  {{/has_phone}}

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

Skill groups  (e.g. Languages / Tools / Domains)
  {{#skill_groups}}
    {{group_name}}
    {{#skills}}{{.}}{{/skills}}
  {{/skill_groups}}

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

──────────────────────────────────────────────
CONVERSION RULES
──────────────────────────────────────────────

1. IDENTIFY repeated card/row patterns in the HTML (experience cards, project cards, skill tags, etc.) and wrap the single-item template with the appropriate Mustache section tag.

2. REPLACE every piece of candidate-specific text with the matching token. This includes:
   - Names, job titles, company names, school names
   - Dates, locations, GPA values
   - Bullet point text
   - Hero headline, subheadline, about paragraph
   - Email addresses, phone numbers, URLs
   - Skill tag labels
   - Footer copyright name

3. PRESERVE completely:
   - All <style> blocks and CSS rules
   - All class names and id attributes
   - All layout, flexbox/grid structures
   - All colours, gradients, shadows, animations
   - All SVG thumbnails and decorative elements (leave them as-is; new thumbnails will be generated at render time)
   - All <script> blocks
   - Semantic structure (nav, header, section, footer)

4. OPTIONAL SECTIONS: wrap any section whose data array may be empty in a Mustache conditional so it disappears cleanly when the data is absent. Certifications, publications, and leadership sections are typically optional.

5. NAVIGATION LINKS: keep href="#section-id" anchors intact. Replace only the visible link label text if it is candidate-specific.

6. DO NOT add, remove, or restructure any HTML elements beyond what is required for the token substitution and section wrapping.

7. OUTPUT a single complete HTML file. No markdown. No explanation. No comments outside of Mustache tokens.

──────────────────────────────────────────────
INPUT
──────────────────────────────────────────────

example_html:
{{EXAMPLE_HTML}}
