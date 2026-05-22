import { describe, expect, it } from "vitest";
import { renderPortfolio } from "../src/netlify/functions/renderPortfolio.mjs";

describe("renderPortfolio", () => {
  it("fills all status badges when the template uses card_label", () => {
    const html = `
      <ul data-section="status_badges">
        <li data-item="badge"><span>✓</span><span data-field="card_label">Sample first badge</span></li>
      </ul>
    `;

    const rendered = renderPortfolio(html, {
      status_badges: [
        { label: "Badge one" },
        { label: "Badge two" },
        { label: "Badge three" },
      ],
    });

    expect(rendered).toContain("Badge one");
    expect(rendered).toContain("Badge two");
    expect(rendered).toContain("Badge three");
    expect(rendered).not.toContain("Sample first badge");
    expect(rendered).not.toContain("data-section=");
    expect(rendered).not.toContain("data-item=");
  });

  it("uses the first repeated section item as the template and drops extra samples", () => {
    const html = `
      <div data-section="projects">
        <article data-item="projects">
          <h3 data-field="name">Sample project one</h3>
          <p data-field="description">Sample description</p>
          <div data-list="technologies"><span data-item="tech">Old tech</span></div>
        </article>
        <article data-item="projects">
          <h3>Sample project two should not leak</h3>
        </article>
      </div>
    `;

    const rendered = renderPortfolio(html, {
      projects: [
        { name: "Project Alpha", description: "Alpha description", technologies: ["React", "Vitest"] },
        { name: "Project Beta", description: "Beta description", technologies: ["Node"] },
      ],
    });

    expect(rendered).toContain("Project Alpha");
    expect(rendered).toContain("Project Beta");
    expect(rendered).toContain("React");
    expect(rendered).toContain("Vitest");
    expect(rendered).toContain("Node");
    expect(rendered).not.toContain("Sample project one");
    expect(rendered).not.toContain("Sample project two should not leak");
    expect(rendered).not.toContain("Old tech");
  });

  it("preserves indexed project template classes for repeated resume-driven sections", () => {
    const html = `
      <div data-section="projects">
        <article class="project-card" data-item="project">
          <div class="project-image translation" data-field="project_icon">🌐</div>
          <h3 data-field="name">Sample project one</h3>
        </article>
        <article class="project-card" data-item="project">
          <div class="project-image teaching" data-field="project_icon">👩‍🏫</div>
          <h3 data-field="name">Sample project two</h3>
        </article>
      </div>
    `;

    const rendered = renderPortfolio(html, {
      projects: [
        { name: "Project Alpha", project_icon: "A" },
        { name: "Project Beta", project_icon: "B" },
        { name: "Project Gamma", project_icon: "C" },
      ],
    });

    expect(rendered).toMatch(/class="project-image translation"[^>]*>A<\/div>[\s\S]*Project Alpha/);
    expect(rendered).toMatch(/class="project-image teaching"[^>]*>B<\/div>[\s\S]*Project Beta/);
    expect(rendered).toMatch(/class="project-image translation"[^>]*>C<\/div>[\s\S]*Project Gamma/);
    expect(rendered).not.toContain("Sample project one");
    expect(rendered).not.toContain("Sample project two");
  });

  it("uses indexed hero card bodies so link cards do not inherit skill chips", () => {
    const html = `
      <aside data-section="hero_cards">
        <div class="grid">
          <div class="card" data-item="hero_card">
            <div data-field="card_label">Core Focus</div>
            <div data-hero-body><div class="chip">Old core skill</div></div>
          </div>
          <div class="card" data-item="hero_card">
            <div data-field="card_label">Toolchain</div>
            <div data-hero-body><div class="chip">Old tool</div></div>
          </div>
          <div class="card" data-item="hero_card">
            <div data-field="card_label">Highlights</div>
            <div data-hero-body><ul><li>Old highlight</li></ul></div>
          </div>
          <div class="card" data-item="hero_card">
            <div data-field="card_label">Links</div>
            <div data-hero-body>
              <p style="margin:.3rem 0 0"><a href="https://www.linkedin.com/">LinkedIn</a> · <a href="https://github.com/">GitHub</a> · <a href="#resume">Resume</a></p>
            </div>
          </div>
        </div>
      </aside>
    `;

    const rendered = renderPortfolio(html, {
      hero_cards: [
        { card_label: "Core Focus", skills: ["Embedded systems"] },
        { card_label: "Toolchain", skills: ["KiCad"] },
        { card_label: "Highlights", highlights: ["Built a working prototype"], is_highlights: true },
        {
          card_label: "Links",
          is_links: true,
          linkedin: "https://linkedin.example/joel",
          github: "https://github.example/joel",
        },
      ],
    });

    expect(rendered).toContain("Embedded systems");
    expect(rendered).toContain("KiCad");
    expect(rendered).toContain("<li>Built a working prototype</li>");
    expect(rendered).toContain('href="https://linkedin.example/joel"');
    expect(rendered).toContain('href="https://github.example/joel"');
    expect(rendered).toContain('href="#resume"');
    expect(rendered).not.toContain("Old core skill");
    expect(rendered).not.toContain("Old tool");
    expect(rendered).not.toContain("Old highlight");
    expect(rendered).not.toContain("data-hero-body");
  });

  it("emits color overrides for new --c palette variables and legacy --color variables", () => {
    const html = `
      <html>
        <head>
          <style id="extracted-theme">
            :root {
              --c-1: oklch(50% 0.2 10);
              --c-2: oklch(60% 0.2 20);
              --c-3: oklch(70% 0.2 30);
              --c-4: oklch(80% 0.2 40);
              --c-5: oklch(90% 0.2 50);
              --c-6: oklch(30% 0 0);
              --color-primary: #111111;
            }
          </style>
          <script type="application/json" id="color-palette">
            {
              "scheme": {
                "--c-1": { "hex": "#ff0000" },
                "--c-2": { "hex": "#00ff00" },
                "--c-3": { "hex": "#0000ff" },
                "--c-4": { "hex": "#ffff00" },
                "--c-5": { "hex": "#111111" },
                "--c-6": { "hex": "#777777" }
              }
            }
          </script>
        </head>
        <body><h1 data-field="headline">Old headline</h1></body>
      </html>
    `;

    const rendered = renderPortfolio(html, { headline: "New headline" }, {
      primary: "#0b3dff",
      secondary: "#f23420",
      accent: "#10c850",
      quaternary: "#101010",
      quinary: "#f3d62b",
    });

    expect(rendered).toContain("--c-1: #f23420;");
    expect(rendered).toContain("--c-2: #10c850;");
    expect(rendered).toContain("--c-3: #0b3dff;");
    expect(rendered).toContain("--c-4: #f3d62b;");
    expect(rendered).toContain("--c-5: #101010;");
    expect(rendered).toMatch(/--c-6:\s*#[0-9a-f]{6};/i);
    expect(rendered).not.toContain("--c-6: #777777;");
    expect(rendered).toContain("--color-primary: #0b3dff;");
    expect(rendered).toContain("--color-quinary: #f3d62b;");
  });

  it("renders about_full as multiple paragraphs when a template marks one paragraph node", () => {
    const html = `
      <section class="about-section">
        <div class="about-text">
          <p class="about-copy" data-html-field="about_full">Old about text</p>
        </div>
      </section>
    `;

    const rendered = renderPortfolio(html, {
      about_full: [
        "I use statistical modeling to turn ambiguous questions into testable assumptions.",
        "In coursework and projects, I have built analyses that connect clean data preparation with clear interpretation.",
        "I am looking for analytics work where careful inference supports practical decisions.",
      ].join("\n\n"),
    });

    expect(rendered).toContain('<p class="about-copy">I use statistical modeling');
    expect(rendered).toContain('<p class="about-copy">In coursework and projects');
    expect(rendered).toContain('<p class="about-copy">I am looking for analytics work');
    expect(rendered).not.toContain("Old about text");
    expect(rendered).not.toContain("data-html-field");
  });

  it("constrains long field copy to the template data-word-count", () => {
    const html = `
      <section class="hero">
        <p data-field="about" data-word-count="18">Old short hero copy.</p>
      </section>
    `;

    const rendered = renderPortfolio(html, {
      about: [
        "I turn messy community research questions into structured evidence that teams can understand.",
        "My work connects interviews, archival context, and field observations with clear synthesis for public-facing decisions.",
        "I am especially interested in museums, policy teams, and research groups that need careful qualitative analysis.",
      ].join(" "),
    });

    expect(rendered).toContain("I turn messy community research questions");
    expect(rendered).not.toContain("I am especially interested");
  });

  it("honors short hero word-count hints", () => {
    const html = `
      <section class="hero">
        <h1 data-field="headline" data-word-count="2">Old headline</h1>
      </section>
    `;

    const rendered = renderPortfolio(html, {
      headline: "Language systems shaped by evidence",
    });

    expect(rendered).toContain(">Language systems...</h1>");
    expect(rendered).not.toContain("shaped by evidence");
  });

  it("adds a layout guard for accent-block hero templates", () => {
    const html = `
      <section class="hero">
        <div class="accent-block"></div>
        <div class="accent-block"></div>
        <div class="accent-block"></div>
        <div class="hero-card">
          <div class="hero-text"><h1 data-field="headline">Old headline</h1></div>
        </div>
      </section>
    `;

    const rendered = renderPortfolio(html, {
      headline: "Generated headline",
    });

    expect(rendered).toContain('id="iw-responsive-hero-layout-guard"');
    expect(rendered).toContain(".hero .hero-card");
  });

  it("uses a dedicated about subheadline when an about section is annotated as subheadline", () => {
    const html = `
      <section class="hero">
        <p data-field="subheadline">Old hero subheadline</p>
      </section>
      <section id="about">
        <h2>About Me</h2>
        <p data-field="subheadline">Old about subheadline</p>
      </section>
    `;

    const rendered = renderPortfolio(html, {
      subheadline: "Two summers at Raytheon put me on the bench.",
      about_section_subheadline: "What I've built and where I'm headed.",
    });

    expect(rendered).toContain(">Two summers at Raytheon put me on the bench.</p>");
    expect(rendered).toContain(">What I've built and where I'm headed.</p>");
    expect(rendered.match(/Two summers at Raytheon/g)).toHaveLength(1);
  });

  it("uses a dedicated about subheadline for subtitle-sized about value propositions", () => {
    const html = `
      <section class="hero">
        <p data-field="subheadline">Old hero subheadline</p>
      </section>
      <section id="about">
        <p class="section-subtitle" data-field="value_proposition" data-word-count="8">Old about subtitle</p>
      </section>
    `;

    const rendered = renderPortfolio(html, {
      subheadline: "Two summers at Raytheon put me on the bench.",
      value_proposition: "Two summers at Raytheon put me on the bench.",
      about_section_subheadline: "What I've built and where I'm headed.",
    });

    expect(rendered).toContain(">What I've built and where I'm headed.</p>");
    expect(rendered.match(/Two summers at Raytheon/g)).toHaveLength(1);
  });

  it("renders a section item that is also a data-list container", () => {
    const html = `
      <div data-section="skill_groups">
        <div class="skills-grid" data-item="skill_groups" data-list="skills">
          <span data-item="tag">Old skill</span>
        </div>
      </div>
    `;

    const rendered = renderPortfolio(html, {
      skill_groups: [
        { group_name: "Core", skills: ["Python", "SQL"] },
        { group_name: "Tools", skills: ["Figma"] },
      ],
    });

    expect(rendered).toContain("Python");
    expect(rendered).toContain("SQL");
    expect(rendered).toContain("Figma");
    expect(rendered).not.toContain("Old skill");
    expect(rendered).not.toContain("data-list=");
  });

  it("flattens data-section containers that are also data-list containers", () => {
    const html = `
      <div class="tagRow" data-section="skill_groups" data-list="skills">
        <span class="tag" data-item="tag">Old skill</span>
      </div>
    `;

    const rendered = renderPortfolio(html, {
      skill_groups: [
        { group_name: "Research", skills: ["Ethnography", "Interviewing"] },
        { group_name: "Tools", skills: ["NVivo"] },
      ],
    });

    expect(rendered).toContain("Ethnography");
    expect(rendered).toContain("Interviewing");
    expect(rendered).toContain("NVivo");
    expect(rendered).not.toContain("Old skill");
    expect(rendered).not.toContain("data-section=");
    expect(rendered).not.toContain("data-list=");
  });

  it("does not cap skill group cards or skill chips to the template count", () => {
    const html = `
      <section data-section="skill_groups">
        <article class="skill-card primary" data-item="skill_group">
          <h3 data-field="group_name">Old first group</h3>
          <div data-list="skills">
            <span data-item="tag">Old one</span>
            <span data-item="tag">Old two</span>
          </div>
        </article>
        <article class="skill-card secondary" data-item="skill_group">
          <h3 data-field="group_name">Old second group</h3>
          <div data-list="skills">
            <span data-item="tag">Old one</span>
            <span data-item="tag">Old two</span>
          </div>
        </article>
      </section>
    `;

    const rendered = renderPortfolio(html, {
      skill_groups: [
        { group_name: "Statistics", skills: ["R", "SPSS", "Survey design"] },
        { group_name: "Research", skills: ["Sampling", "Interview coding", "Data cleaning"] },
        { group_name: "Communication", skills: ["Technical writing", "Presentation"] },
      ],
    });

    expect(rendered).toContain(">Statistics</h3>");
    expect(rendered).toContain(">Research</h3>");
    expect(rendered).toContain(">Communication</h3>");
    expect(rendered).toContain(">Survey design</span>");
    expect(rendered).toContain(">Data cleaning</span>");
    expect(rendered).toContain(">Presentation</span>");
    expect(rendered).not.toContain("Old first group");
    expect(rendered).not.toContain("Old second group");
  });

  it("caps specialty sub-lists to the template's concrete item count", () => {
    const html = `
      <aside data-section="hero_cards">
        <div data-item="hero_card">
          <div data-list="status_badges">
            <span data-item="badge">Old one</span>
            <span data-item="badge">Old two</span>
            <span data-item="badge">Old three</span>
          </div>
          <ul data-list="bullets">
            <li data-item="bullet" data-word-count="7">Old bullet one</li>
            <li data-item="bullet" data-word-count="7">Old bullet two</li>
            <li data-item="bullet" data-word-count="7">Old bullet three</li>
          </ul>
        </div>
      </aside>
    `;

    const rendered = renderPortfolio(html, {
      hero_cards: [{
        status_badges: ["A", "B", "C", "D"],
        bullets: [
          "First generated bullet stays short.",
          "Second generated bullet stays short.",
          "Third generated bullet stays short.",
          "Fourth generated bullet should be removed.",
        ],
      }],
    });

    expect(rendered).toContain(">A</span>");
    expect(rendered).toContain(">B</span>");
    expect(rendered).toContain(">C</span>");
    expect(rendered).not.toContain(">D</span>");
    expect(rendered).toContain("Third generated bullet");
    expect(rendered).not.toContain("Fourth generated bullet");
  });

  it("does not cap resume-driven bullet lists to the template count", () => {
    const html = `
      <div data-section="experience">
        <article data-item="experience">
          <h3 data-field="title">Old title</h3>
          <ul data-list="bullets">
            <li data-item="bullet">Old bullet one</li>
            <li data-item="bullet">Old bullet two</li>
          </ul>
        </article>
      </div>
    `;

    const rendered = renderPortfolio(html, {
      experience: [{
        title: "Research Assistant",
        bullets: ["One", "Two", "Three"],
      }],
    });

    expect(rendered).toContain("<li>One</li>");
    expect(rendered).toContain("<li>Two</li>");
    expect(rendered).toContain("<li>Three</li>");
  });

  it("derives optional array flags before applying data-if", () => {
    const html = `
      <section data-if="has_publications">
        <div data-section="publications">
          <article data-item="publications">
            <h3 data-field="title">Sample publication</h3>
          </article>
        </div>
      </section>
    `;

    const rendered = renderPortfolio(html, {
      publications: [
        { title: "Generated publication" },
      ],
    });

    expect(rendered).toContain("Generated publication");
    expect(rendered).not.toContain("Sample publication");
    expect(rendered).not.toContain("data-if=");
  });
});
