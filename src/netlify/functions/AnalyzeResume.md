You are a portfolio website strategist and creative director.

Your task is to read the input resume and produce a structured brief that will facilitate the design of a personal portfolio website.

IMPORTANT RULES
- Surmise only facts supported by the provided inputs.
- Do not invent employers, projects, dates, metrics, awards, publications, certifications, links, or credentials.
- You may rewrite, summarize, and augument to improve clarity, impact, and flow.

OUTPUT FORMAT
Return valid JSON only.
No markdown.
No explanation.
No comments.

OUTPUT JSON SHAPE

{
  "identity": {
    "name": "",
    "major": "",
    "specialization": "",
    "contact": {
      "email": "",
      "phone": "",
      "linkedin": "",
      "other_links": []
    }
  },
  "factual_profile": {
    "education": [],
    "experience": [],
    "projects": [],
    "skills": {
      "languages": [],
      "tools": [],
      "domains": [],
      "other": []
    },
    "publications": [],
    "leadership": [],
    "about": "",
    "core": [],
    "position": [],
    "services": [],
    "career break": [],
    "skills": [],
    "featured": [],
    "licenses": [],
    "certifications": [],
    "projects": [],
    "courses": [],
    "recommendations": [],
    "volunteer experience": [],
    "publications": [],
    "patents": [],
    "honors and awards": [],
    "test scores": [],
    "languages": [],
    "organizations": [],
    "causes": [],
    "hobbies/interests": [],
    "additional_background": []
  },
  "motifs": {
    "broad_primary_domain": ""
    "resume_keywords": [],
    "project_titles": [],
    "research_terms": [],
    "potential_visual_motifs": [],
    "symbolic_objects": [],
    "rendering_style": []
  },
  "editorial_direction": {
    "core_story": "",
    "strengths_to_emphasize": [],
    "content_to_feature_prominently": [],
    "content_to_keep_secondary": [],
    "recommended_tone": [],
    "suggested_visual_motifs": [],
    "suggested_section_possibilities": [],
    "website_advantages_to_leverage": [],
    "sample_inspiration_notes": "",
    "color_strategy": "",
  }
  "website_copy_seed": {
    "hero_headline_options": [],
    "hero_subheadline_options": [],
    "cta_options": [],
    "project_framing_notes": [],
    "about_angle": ""
  },
  "compatible_color_scheme": {
    "five_key_colors": [],
    "how_used": ""
  }
}

GUIDELINES

1. IDENTITY
Fill in the candidate identity and contact fields from the input.

2. FACTUAL PROFILE
Extract the factual content cleanly:
- education
- work/research/teaching experience
- projects
- skills
- publications
- leadership
- other relevant background

Keep this factual and non-creative.


3. MOTIFS
  Considering the given major and specialization, determine the broad primary domain and extract the most pertinent keywords from the resume.  Using these terms and concepts, choose 2-3 core visual metaphors, as illustrated in the Example Motif Table below.  Add 2-4 symbolic objects tied to the field to make the image readable.  See examples of this in the Symbolic Objects Table below. The key rule is to choose one primary symbol and up to three supporting symbols in order to avoid clutter. The render style is most often one of stylized scientific illustration, cinematic concept art, clean editorial vector, gradient 3D illustration, technical schematic aesthetic.

Example Motif Table
_Life science_
-biology + ecology → tree of life / root networks / forest canopy
-biology + genetics → DNA helix / branching cells / genomic strands
-biology + marine → coral / wave ecology / aquatic forms
-biology + microbiology → petri dish / cellular forms / microscopic textures

_Physical science_
-chemistry + organic → molecular bonds / hex grids / reaction flows
-chemistry + analytical → glassware / spectra / calibration curves
-physics + optics → light beams / lens rings / diffraction
-physics + astronomy → star fields / orbital arcs / cosmic geometry

_Engineering_
-EE + lasers → laser beams / optical rings / photonic paths
-EE + RF → wave propagation / antenna arcs / circuit traces
-mechanical + manufacturing → gears / machined parts / exploded assemblies
-civil + structures → bridges / load grids / architectural framing

_Computing_
-CS + software → modular blocks / interface layers / logic flows
-data science + ML → node networks / data streams / chart fields
-cybersecurity → lock circuits / shields / network grids
-AI → neural constellations / layered abstract networks

_Business_
-accounting → ledgers / geometric bar grids / structured lines
-finance → market curves / signal charts / strategic geometry
-marketing → audience waves / campaign pathways / connection nodes

_Education / social science_
-education → pathways / lightbulb motifs / layered growth
-psychology → neural/cognitive maps / conversation circles / patterns
-communications → sound waves / message paths / connection lines

Symbolic Objects Table
Biology example: microscope, petri dish, leaf or plant specimen, DNA strand
Electrical engineering: optical lens, laser beam,circuit traces, waveform display
Data science: laptop, charts, node graph, scatter plot / dashboard

4. EDITORIAL DIRECTION
This is the most important part.
Infer:
- what kind of professional identity the candidate has
- what strengths deserve emphasis
- what should be featured first
- what kind of visual language fits the specialization
- what a website can do better than the resume

This section should guide a creative renderer without forcing it into a fixed structure.

5. WEBSITE COPY SEED
Write several strong website-ready options for:
- hero headline
- subheadline
- calls to action

These should be grounded in the actual input and should sound more compelling than resume text.

5. SUBJECT-INSPIRED COLOR STRATEGY
Conjure a set of five main colors inspired by the subject matter of the resume to use as a default palette in portfolio website generation later. The primary color is to be used for headings, btoons Describe how the inferred palette is to be used emotionally and visually across the new site.

Example palette assignment rules:
Primary → Headings, buttons, key branding
Secondary → Subheadings, links, secondary buttons
Accent → Highlights, hover states, calls to action

INPUTS

contact_info_json:
{{CONTACT_INFO_JSON}}

major:
{{MAJOR}}

specialization:
{{SPECIALIZATION}}

resume_text:
{{RESUME_TEXT}}

sample_website_html_or_image:
{{COPY_OKAY}}
{{SAMPLE_WEBSITE}}

color_scheme_json:
{{COLOR_SCHEME_JSON}}


I'm going to make some big changes.  First, generate a function called that sends the AnalyzeResume.md prompt 

The debug mode should include a radio button menu for choosing either Claude or ChatGPT as the AI for all the prompts in this app.  The default should be Claude.