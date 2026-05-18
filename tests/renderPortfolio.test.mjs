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
