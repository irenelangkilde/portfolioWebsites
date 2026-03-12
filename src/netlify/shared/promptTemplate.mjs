// Auto-synced from: src/Prompt for Portfolio Website Generation-Claude.txt
// Edit the .txt file and re-run: node src/netlify/shared/syncPrompt.mjs
// This module is imported by the background function so esbuild bundles it directly,
// avoiding file-system read issues in the production Lambda environment.

export const PROMPT_TEMPLATE = `Portfolio Website Generation Prompt
I need you to create a full-fledged, production-ready portfolio website. You will receive:

Contact information JSON (name, email, phone, LinkedIn, GitHub, etc.)
Major and specialization (e.g., "Data Science" with specialization in "Machine Learning")
Resume PDF content (education, experience, skills, projects)
Sample website HTML (use this as your layout template)
Color scheme (hex codes for primary, secondary, accent colors)


Instructions
1. Structure & Layout

Use the sample website HTML as your template for style, navigation structure, and overall layout
Maintain the responsive design patterns from the sample.
Preserve any unique design elements (hero sections, grid layouts, card designs)
If no photo is provided, put monogram initials instead.

2. Color Scheme Integration

Replace ALL colors in the sample with the provided color scheme
Apply colors consistently
Try to use all the colors.

Primary color: Main headings, primary buttons, key branding elements
Secondary color: Subheadings, links, secondary buttons
Accent color: Highlights, hover states, call-to-action elements
Dark color: paragraph text
Light color: background

Ensure sufficient contrast for accessibility (text must be readable)

3. Content Transformation (CRITICAL)
Do NOT just copy resume text to the website. Transform it to leverage website advantages:
From Resume → To Website
Education Section:

Resume: "B.S. Computer Science, University Name, GPA 3.8"
Website: Expand with relevant coursework, thesis/capstone details, academic honors with context, any notable professors or research groups

Experience Section:

Resume: Bullet points of responsibilities
Website: Transform into narrative paragraphs that tell the story of each role. Include:

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
Visuals: Suggest where screenshots, diagrams, or charts should go
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

Write a compelling 2-3 paragraph narrative
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

8. Any augmentation or enhancement not supported (directly or indirectly) by the resume should be marked with a triple asterisk (***) and an index number counting the number of asterisk groups in the page so far.

9. Quality Checks
Before finalizing, ensure:

 All colors from the color scheme are used consistently
 No Lorem ipsum or placeholder text
 Contact information is accurate and formatted correctly
 All sections from the resume are represented and expanded
 The layout matches the sample website's structure
 Code is clean, indented, and commented
 Mobile responsiveness is maintained
 No broken links or missing assets


Output Format
Provide the complete HTML file only (ready to save and deploy). No summary, no suggestions after the HTML — just the file.


INPUT DATA

Contact JSON:
{{CONTACT_INFO_JSON}}

Name: {{NAME}}
Email: {{EMAIL}}

Headshot photo: {{HEADSHOT_PHOTO}}

Major: {{MAJOR}}
Specialization: {{SPECIALIZATION}}

Resume Content:
{{RESUME_TEXT}}

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
