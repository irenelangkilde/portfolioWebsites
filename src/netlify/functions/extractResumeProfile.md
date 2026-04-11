You are a portfolio website strategist and creative director.

Your task is to read the input resume and produce three clearly separated outputs:
1. resume_facts — verbatim structured content from the document. Factual only, no interpretation.
2. resume_strategy — analysis material: inferred signals, options, and seeds for creative direction. Interpretation only, grounded in facts.
3. resume_resolved — final resolved decisions: the selected strategy ready for downstream rendering. Derived from resume_strategy.

IMPORTANT RULES
- resume_facts: extract only what is stated or clearly implied. Never invent employers, projects, dates, metrics, awards, publications, certifications, links, or credentials.
- resume_strategy: you may infer, reframe, and recommend — but every claim must be supportable from resume_facts.
- You may rewrite and summarize resume content to improve clarity, impact, and flow.

OUTPUT FORMAT
Return valid JSON only.
No markdown. No explanation. No comments.

OUTPUT JSON SHAPE

{
  "resume_facts": {
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
      "about": "",
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
        "programming_languages": [],
        "tools": [],
        "domains": [],
        "soft_skills": [],
        "other": []
      },
      "publications": [
        { "title": "", "venue": "", "date": "", "authors": [], "link": "" }
      ],
      "certifications": [
        { "name": "", "issuer": "", "date": "", "credential_id": "" }
      ],
      "licenses": [
        { "name": "", "issuer": "", "date": "" }
      ],
      "patents": [
        { "title": "", "date": "", "co_inventors": [], "number": "" }
      ],
      "honors_and_awards": [
        { "title": "", "issuer": "", "date": "", "description": "" }
      ],
      "leadership": [
        { "organization": "", "role": "", "dates": "", "description": "" }
      ],
      "volunteer_experience": [
        { "organization": "", "role": "", "dates": "", "description": "" }
      ],
      "organizations": [
        { "name": "", "role": "", "dates": "" }
      ],
      "career_break": [
        { "start_date": "", "end_date": "", "description": "" }
      ],
      "courses": [],
      "test_scores": [
        { "name": "", "score": "", "date": "" }
      ],
      "languages": [
        { "language": "", "proficiency": "" }
      ],
      "recommendations": [
        { "from": "", "relationship": "", "excerpt": "" }
      ],
      "causes": [],
      "professional_interests": [],
      "hobbies_interests": [],
      "additional_background": [],
      "desired_roles": []
    }
  },
  "resume_strategy": {
    "desired_roles": [],
    "motifs": {
      "broad_primary_domain": "",
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
      "strong_signals": [
        { "item": "", "why": "" }
      ],
      "weak_signals": [
        { "item": "", "why": "" }
      ],
      "recommended_tone": [],
      "suggested_visual_motifs": [],
      "suggested_section_possibilities": [],
      "section_by_section_notes": [
        { "section": "", "note": "" }
      ],
      "website_advantages_to_leverage": [],
      "sample_inspiration_notes": "",
      "color_strategy": ""
    },
    "website_copy_seed": {
      "hero_headline_options": [],
      "hero_subheadline_options": [],
      "value_propositions": [],
      "cta_options": [],
      "about_angle": "",
      "project_framing_notes": [
        { "project_name": "", "framing": "", "project_icon": "" }
      ],
      "highlights": [],
      "strengths_snapshot": [],
      "open_to": "",
      "status_badges": [],
      "skills_subcategory_labels": [
        { "group": "", "label": "" }
      ]
    },
    "compatible_color_schemes": [
      {
        "base_colors": {
          "background": "",
          "foreground": "",
          "primary": "",
          "secondary": "",
          "accent": ""
        },
        "how_used": ""
      }
    ]
  },
  "resume_resolved": {
    "target_role": {
      "role_title": "",
      "industry": "",
      "target_keywords": [],
      "tone": ""
    },
    "positioning": {
      "professional_identity": "",
      "core_story": "",
      "value_proposition": "",
      "headline": "",
      "subheadline": "",
      "fit_strategy": ""
    },
    "content_strategy": {
      "must_feature": [],
      "feature_early": [],
      "keep_secondary": [],
      "omit_or_minimize": [],
      "projects_to_highlight": [],
      "experience_to_highlight": [],
      "skills_to_surface": [],
      "keywords_to_echo_naturally": [],
      "proof_points_to_include": []
    },
    "site_strategy": {
      "recommended_section_order": [],
      "cta_strategy": [],
      "tone": [],
      "narrative_style": "",
      "website_advantages_to_leverage": []
    },
    "visual_language": {
      "dominant_motifs": [],
      "symbolic_objects": [],
      "rendering_style": "",
      "company_aesthetic_fit": ""
    },
    "website_copy_seed": {
      "about_angle": "",
      "project_framing_notes": [
        { "project_name": "", "framing": "", "project_icon": "" }
      ],
      "highlights": [],
      "strengths_snapshot": [],
      "open_to": "",
      "status_badges": [],
      "skills_subcategory_labels": [
        { "group": "", "label": "" }
      ]
    }
  }
}

GUIDELINES

1. IDENTITY
Fill in the candidate identity and contact fields from the resume. Populate major and specialization from the form inputs.

2. FACTUAL PROFILE
Extract verbatim, structured content. Omit sections absent from the resume — never fabricate.
- education: institution, degree, GPA, coursework, thesis, activities
- experience: company, title, dates, location, bullet points, technologies used
- projects: name, description, role, dates, technologies, links, bullet points
- skills: technical, programming languages, tools, domains, soft skills
- publications, certifications, licenses, patents if present
- leadership, volunteer, organizations, career breaks, courses, test scores, languages if present
- professional_interests: extract any stated areas of professional curiosity, research interests, industry focus areas, or stated "interested in" phrases from the resume (e.g. "interested in embedded systems", "passionate about ML infrastructure"). Do not infer — only include what is explicitly stated.
- desired_roles: populate only if the resume explicitly states target roles (e.g. objective statement, "seeking", "open to"). Leave empty if not stated — resume_strategy.desired_roles handles inferred targets.

about field: copy the resume summary as closely as possible, but convert any third-person phrasing to first person ("Joel is a…" → "I am a…", "He has…" → "I have…"). Do not add, invent, or embellish — only change the grammatical person.

Keep this section factual and non-creative. It is the ground truth all downstream stages rely on.

3. MOTIFS
Considering the given major and specialization, determine the broad primary domain and extract the most pertinent keywords from the resume. Choose 2-3 core visual metaphors and 2-4 symbolic objects. The key rule: one primary symbol, up to three supporting — avoid clutter.

Use `professional_interests` to filter and prioritize motifs: if the candidate has stated interests that point to a specific sub-domain (e.g. "interested in photonics" within an EE major), prefer motifs from that sub-domain over the generic domain defaults. Professional interests are a strong signal for which row of the Example Motif Table is most relevant.

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
Electrical engineering: optical lens, laser beam, circuit traces, waveform display
Data science: laptop, charts, node graph, scatter plot / dashboard

Rendering styles: stylized scientific illustration, cinematic concept art, clean editorial vector, gradient 3D illustration, technical schematic aesthetic.

VOICE RULES (apply to sections 4, 5, and 6)
- Always write in first person ("I build…", "My work spans…", "I bring…") — never third person ("She leads…", "The candidate has…").
- Confident but not boastful. Avoid superlatives like "world-class", "exceptional", "top-tier", "passionate", "driven", or "highly skilled". Let concrete facts carry the weight instead.

4. EDITORIAL DIRECTION
This is the most important part. Infer:
- what kind of professional identity the candidate has
- what strengths deserve emphasis
- what should be featured first
- what kind of visual language fits the specialization
- what a website can do better than the resume

Ground every claim in resume_facts. Write core_story in first person. This section guides downstream creative stages without locking them into a fixed structure.

STRONG AND WEAK SIGNALS
- strong_signals: 3-6 specific resume items that should definitely appear on the website, each paired with a concise `why`. Name the actual item (e.g. "Thesis: X", "Internship at Y", "Project Z"). Be specific — not "research experience" but the actual project or role. These are the candidate's clearest proof points.
- weak_signals: 2-4 resume items that exist but shouldn't lead or may undercut fit for the candidate's target roles. Name the item, explain briefly. Examples: unrelated early jobs, redundant listings, credentials that date the candidate, or items that signal a different career direction.

SECTION BY SECTION NOTES
Write one concrete, actionable sentence for each section of the website that is appropriate for this candidate. Typical sections: Hero, About, Projects/Work, Experience, Skills, Education, Contact. Skip sections that aren't relevant. Each note should say what that section needs to accomplish — not just list what goes in it. Example: "Projects — lead with the thesis project and frame it around the data pipeline, not the subject matter."

SUGGESTED SECTION POSSIBILITIES
List section types that would work well for this candidate beyond the standard set, e.g. "Research", "Publications", "Teaching", "Open Source", "Leadership", "Gallery", "Writing Samples".

5. WEBSITE COPY SEED
Write several strong website-ready options for hero headline, subheadline, and calls to action. Ground these in actual resume content — they should sound more compelling than resume text, not generic.

ABOUT ANGLE
One or two grounded sentences the candidate would say out loud to a recruiter — specific, honest, and human-sounding. First person. This is the opening line of the About section, not a general biography. It should lead with what makes the candidate interesting or distinctive, not with their major or graduation year.

VALUE PROPOSITIONS
Two or three punchy sentences (not about_angle) that each capture the candidate's clearest professional offer — what they bring that is concrete and differentiated. Each should be a complete sentence. First person. The best one will be used as the hero sub-value pitch.

PROJECT FRAMING NOTES
For every project in resume_facts.factual_profile.projects, write one sentence reframing that project for a portfolio website audience. The framing should emphasize what problem it solved, what skill it demonstrates, or what outcome it produced — not just what it is. Use the exact project name from resume_facts. Also choose one single emoji in `project_icon` that best fits that specific project. The emoji choice should come from the project's actual subject matter plus the candidate's motifs and target field. Avoid generic art/design emoji unless the project is genuinely about art/design/media.

HIGHLIGHTS
Write 3-4 short, punchy bullet strings for the hero "Highlights" card. These are quick-scan facts: concrete achievements, key skills, notable credentials, or defining characteristics. Each should be 5-10 words. Examples: "Thesis on X published in Y", "Fluent in Python and R", "Dean's List 3 semesters", "Built X used by Y people". No soft claims.

STRENGTHS SNAPSHOT
Write 3-4 short phrases (3-6 words each) for the hero "Snapshot" card — these are the candidate's clearest professional strengths, stated as compact identity markers. Examples: "Systems-level thinker", "Data to decision pipelines", "Lab bench to publication". These should feel distinct from the highlights — more about identity, less about credentials.

OPEN TO
Write a single concise string for the "Open to:" or "What I'm looking for:" badge. State the role types and/or work arrangements the candidate is targeting. Examples: "Full-time roles in data engineering or ML", "Entry-level positions in civil or structural engineering, open to relocation". Derive from resume_facts.desired_roles if present; infer from major and experience otherwise. First person implied but no "I am" — start with the noun.

STATUS BADGES
Write 2-4 short badge label strings appropriate for this candidate's hero section. These appear as small chips or pills. Examples: "Class of 2026", "Available June 2026", "Open to Relocation", "B.S. Electrical Engineering", "GPA 3.8". Pull from facts only — graduation date, degree, GPA (if strong), notable honors, availability signal. Keep each under 5 words.

SKILLS SUBCATEGORY LABELS
For each non-empty skill group in resume_facts.factual_profile.skills, provide a human-readable display label. The group names are: programming_languages, technical, tools, domains, soft_skills, other. Write a label that makes sense to a non-technical visitor (e.g. "programming_languages" → "Languages & Frameworks", "technical" → "Technical Skills", "tools" → "Tools & Platforms", "domains" → "Areas of Expertise", "soft_skills" → "Competencies"). Only include groups that have content.

CTA OPTIONS
Write 2-3 specific calls to action appropriate for this candidate's career stage and field. Avoid generic "Get in Touch" — make them action-specific and honest. Examples: "See my research", "View my projects", "Download my resume", "Let's talk about your team's needs". Pair with context: what page action or link they point to.

6. SUBJECT-INSPIRED COLOR STRATEGY
Conjure five colors inspired by the candidate's field and subject matter. Output them in `base_colors` using these semantic roles:

  background — the dominant page canvas or atmospheric base
  foreground — the main readable ink/text color against the background
  primary — the strongest action / emphasis color
  secondary — a distinct supporting brand or hierarchy color
  accent — a fifth orthogonal highlight color that adds new contrast

Rules:
- `foreground` must be readable on `background`.
- `primary`, `secondary`, and `accent` must be genuinely distinct.
- Do NOT default to generic black/white unless the subject matter genuinely demands it.
- Favor field-relevant, composition-driving colors over bland neutrals.

In `how_used`, describe the overall palette mood and field connection in one sentence.

7. RESOLVED / SYNTHESIZED SECTIONS (resume_resolved)
resume_resolved is a separate top-level output — not nested inside resume_strategy. It contains five resolved sections plus selected copy fields derived from the working material in resume_strategy. Downstream rendering stages consume resume_resolved directly. Treat editorial_direction, motifs, and website_copy_seed in resume_strategy as raw material; treat resume_resolved as the final decisions.

TARGET ROLE
Infer the candidate's primary target from the resume — desired_roles if stated, otherwise from major + experience pattern.
- role_title: the single most likely target job title (e.g. "Embedded Systems Engineer", "Data Analyst")
- industry: the target industry or sector (e.g. "Semiconductors & Hardware", "Finance & FinTech")
- target_keywords: 6-10 keywords a recruiter for this role would scan for; merge motifs.resume_keywords with the most role-specific skill terms
- tone: one-phrase tone calibration (e.g. "precise and technical", "warm and research-driven")

POSITIONING
Resolve and select. Do not invent new content — pull the best options from website_copy_seed and editorial_direction.
- professional_identity: one punchy first-person sentence establishing who the candidate is and what they do (not their major, their professional identity)
- core_story: the best single-paragraph version from editorial_direction.core_story — tighten it, do not expand
- value_proposition: pick the single strongest entry from website_copy_seed.value_propositions; do not paraphrase
- headline: pick the single strongest entry from website_copy_seed.hero_headline_options
- subheadline: pick the single strongest entry from website_copy_seed.hero_subheadline_options, complementing the headline
- fit_strategy: one sentence on why this candidate is a strong fit for their target field/role given their background

CONTENT STRATEGY
Translate editorial_direction into specific actionable decisions, grounded in resume_facts.
- must_feature: 3-5 items that must appear — use actual names from resume_facts (project names, company names, credentials)
- feature_early: 2-3 items to show above the fold or in the hero
- keep_secondary: items that are true but should not lead
- omit_or_minimize: items that would distract or undercut fit (from weak_signals)
- projects_to_highlight: project names verbatim from resume_facts, ordered by impact for the target role
- experience_to_highlight: "Title at Company" strings verbatim from resume_facts, ordered by relevance
- skills_to_surface: the 8-12 most important skills to make visible, in priority order
- keywords_to_echo_naturally: 8-12 terms to weave into copy — drawn from target_keywords + motifs.resume_keywords
- proof_points_to_include: 3-6 specific verifiable facts from resume_facts (metrics, outcomes, named tools, GPA if strong, publication titles)

SITE STRATEGY
Synthesize from editorial_direction.suggested_section_possibilities and website_copy_seed.
- recommended_section_order: ordered list of section names for the full page (start with hero)
- cta_strategy: 2-3 specific CTA decisions — what each button/link should say and where it points
- tone: 2-3 tone descriptors for the page as a whole
- narrative_style: one sentence on how the page tells its story
- website_advantages_to_leverage: concrete ways a portfolio site beats a resume for this candidate (pull from editorial_direction.website_advantages_to_leverage and add any new ones)

VISUAL LANGUAGE
Synthesize from motifs. Condense to final decisions, not options.
- dominant_motifs: 2-3 primary visual metaphors for the page
- symbolic_objects: 2-4 objects that represent this candidate's work to an outsider
- rendering_style: single best rendering style from motifs.rendering_style
- company_aesthetic_fit: leave empty ("") — populated in job_resolved when a target employer is known

WEBSITE COPY SEED (resolved)
Pick the single best value for each copy field from the working material in resume_strategy.website_copy_seed. These are the selected outputs — not arrays of options.
- about_angle: copy the best entry from resume_strategy.website_copy_seed.about_angle
- project_framing_notes: copy from resume_strategy.website_copy_seed.project_framing_notes, preserving both `framing` and `project_icon`
- highlights: copy from resume_strategy.website_copy_seed.highlights (max 4)
- strengths_snapshot: copy from resume_strategy.website_copy_seed.strengths_snapshot (max 4)
- open_to: copy from resume_strategy.website_copy_seed.open_to
- status_badges: copy only short factual badges from resume_strategy.website_copy_seed.status_badges. Keep these to objective profile facts such as degree, honors, class year, GPA, or graduation timing. Do NOT include availability, role-seeking text, relocation, or location here; those belong in open_to instead.
- skills_subcategory_labels: copy from resume_strategy.website_copy_seed.skills_subcategory_labels

EXAMPLE OUTPUT (fields from both resume_strategy and resume_resolved — use as format reference, not as content defaults)

"strong_signals": [
  { "item": "Senior thesis: 48V synchronous buck converter at 95% peak efficiency", "why": "demonstrates end-to-end hardware design with a measurable, publication-worthy result" },
  { "item": "Embedded Engineering Intern at ACME Robotics (Summer 2024)", "why": "named employer, directly relevant role, with a quantified impact bullet (38% CPU reduction)" },
  { "item": "BLE Wearable Sensor — end-to-end prototype (PCB, firmware, desktop app)", "why": "shows full-stack hardware ownership across three disciplines in one project" }
]

"weak_signals": [
  { "item": "Electronics Lab Assistant (2023–2024)", "why": "support role that doesn't demonstrate independent design — lead with the internship instead" },
  { "item": "Python / NumPy listed under skills", "why": "common qualifier that adds noise without evidence; only surface if tied to a specific project outcome" }
]

"section_by_section_notes": [
  { "section": "Hero", "note": "Lead with a hardware-specific achievement (the buck converter result), not the major name — recruiters already know the major from context." },
  { "section": "Projects", "note": "Put the senior thesis project first; frame each project around what problem it solved, not what tools it used." },
  { "section": "Skills", "note": "Separate hardware and software skill groups visually — EE recruiters scan for specific tool names, not general categories." },
  { "section": "Experience", "note": "Open the ACME internship entry with the quantified outcome bullet; the lab assistant role should appear last or be omitted." },
  { "section": "Contact", "note": "Include a direct 'Download Resume' CTA alongside the contact form — hiring managers rarely fill out forms." }
]

"project_framing_notes": [
  { "project_name": "BLDC Motor Driver (4-layer PCB)", "framing": "Shows end-to-end hardware ownership: schematic, layout, assembly, and firmware on a single shipped board.", "project_icon": "⚡" },
  { "project_name": "BLE Wearable Sensor", "framing": "Demonstrates full product thinking across PCB design, Nordic BLE firmware, and a companion desktop app.", "project_icon": "📡" },
  { "project_name": "48V → 5V Synchronous Buck", "framing": "Quantified power electronics result (95% efficiency) with simulation, implementation, and thermal analysis.", "project_icon": "🔋" }
]

"skills_subcategory_labels": [
  { "group": "programming_languages", "label": "Languages & Frameworks" },
  { "group": "technical", "label": "Hardware & Electronics" },
  { "group": "tools", "label": "Tools & Platforms" },
  { "group": "soft_skills", "label": "Competencies" }
]

"open_to": "Entry-level embedded or hardware engineering roles; open to relocation"

"status_badges": ["Class of 2026", "B.S. Electrical Engineering", "Magna Cum Laude"]

"highlights": [
  "Senior design: 48V→5V synchronous buck at 95% peak efficiency",
  "STM32 BLE wearable — coin-cell life extended to 9+ months",
  "Embedded intern at ACME Robotics: 38% CPU reduction via SPI/DMA driver",
  "Dean's List, 3 semesters"
]

"strengths_snapshot": [
  "Hardware-to-firmware ownership",
  "Power electronics & PCB layout",
  "Low-power embedded systems",
  "Simulation to bench validation"
]

"target_role": {
  "role_title": "Embedded Systems Engineer",
  "industry": "Semiconductors & Hardware",
  "target_keywords": ["STM32", "FreeRTOS", "embedded C", "PCB design", "power electronics", "BLE", "low-power", "RTOS"],
  "tone": "precise and technical"
}

"positioning": {
  "professional_identity": "I design hardware and write the firmware that runs on it — from schematic to working prototype.",
  "core_story": "I'm an EE senior who has shipped end-to-end hardware projects: a 4-layer motor driver PCB with FOC firmware, a BLE wearable with 9-month coin-cell life, and a buck converter measured at 95% efficiency. My internship at ACME Robotics added production-grade embedded C experience with a quantified outcome.",
  "value_proposition": "I bring hardware-to-firmware ownership that most new grads can't: I've designed the PCB, written the drivers, and measured the result on the bench.",
  "headline": "Designing reliable hardware and smart embedded systems.",
  "subheadline": "EE senior with end-to-end project ownership — PCB, firmware, and bench validation.",
  "fit_strategy": "Strong match for embedded new-grad roles: three shipped projects across PCB design, RTOS firmware, and power electronics, plus a directly relevant internship with a quantified outcome."
}

"content_strategy": {
  "must_feature": ["48V→5V synchronous buck converter (senior thesis)", "Embedded Engineering Intern at ACME Robotics", "BLE Wearable Sensor project"],
  "feature_early": ["95% efficiency buck converter result", "38% CPU reduction at ACME Robotics"],
  "keep_secondary": ["Lab assistant role", "MATLAB/Simulink skills"],
  "omit_or_minimize": ["Food service job (if present)", "Generic soft skills"],
  "projects_to_highlight": ["BLDC Motor Driver (4-layer PCB)", "BLE Wearable Sensor", "48V→5V Synchronous Buck"],
  "experience_to_highlight": ["Embedded Engineering Intern at ACME Robotics", "Electronics Lab Assistant — University EE Dept."],
  "skills_to_surface": ["Embedded C/C++", "STM32", "FreeRTOS", "PCB design (Altium, KiCad)", "Power electronics", "BLE/nRF52", "Python", "Git/Linux"],
  "keywords_to_echo_naturally": ["embedded systems", "firmware", "PCB design", "RTOS", "low-power", "STM32", "BLE", "power electronics"],
  "proof_points_to_include": ["95% peak efficiency at 1A (buck converter)", "38% CPU usage reduction (ACME internship)", "9+ month coin-cell battery life (wearable)", "Dean's List 3 semesters"]
}

"site_strategy": {
  "recommended_section_order": ["Hero", "Projects", "Skills", "Experience", "Resume", "Contact"],
  "cta_strategy": ["Primary: 'Hire Me' → #contact", "Secondary: 'See Projects' → #projects", "Footer: 'Download Resume' → PDF link"],
  "tone": ["technical", "direct", "evidence-first"],
  "narrative_style": "Opens with a concrete achievement, moves through shipped projects as proof, closes with experience and contact — the page argues the hire before the recruiter scrolls halfway.",
  "website_advantages_to_leverage": ["Show oscilloscope screenshots or PCB photos as project media", "Live demo links for any firmware repos on GitHub", "Downloadable resume PDF directly from the page"]
}

"visual_language": {
  "dominant_motifs": ["circuit traces and signal waveforms", "PCB layer stacks"],
  "symbolic_objects": ["oscilloscope display", "STM32 microcontroller", "PCB with components"],
  "rendering_style": "technical schematic aesthetic",
  "company_aesthetic_fit": ""
}

INPUTS

major:
{{MAJOR}}

specialization:
{{SPECIALIZATION}}

resume:
{{RESUME}}
