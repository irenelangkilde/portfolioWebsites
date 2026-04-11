import { describe, it, expect } from "vitest";
import { renderHTML } from "../src/netlify/shared/siteRender.mjs";

// Minimal valid site fixture
function makeSite(overrides = {}) {
  return {
    meta: {
      name: "Jane Smith",
      headline: "Software Engineer",
      subtitle: "Building things that matter",
      email: "jane@example.com",
      phone: "555-1234",
      linkedin: "https://linkedin.com/in/janesmith",
      major: "Computer Science",
      specialization: "Machine Learning",
      theme: {
        primary: "#4E70F1",
        secondary: "#FBAB9C",
        tertiary: "#8DE0FF",
        accent2: "#0b1220",
        accent1: "#eaf0ff",
      },
    },
    sections: {
      about: ["I build software.", "I care about users."],
      education: [
        {
          degree: "B.S. Computer Science",
          institution: "State University",
          date: "2024",
          details: ["GPA 3.9", "Dean's List"],
        },
      ],
      experience: [
        {
          title: "Software Intern",
          org: "Acme Corp",
          date: "Summer 2023",
          bullets: ["Built API", "Improved latency by 40%"],
        },
      ],
      projects: [
        {
          name: "My Project",
          link: "https://github.com/jane/proj",
          date: "2023",
          bullets: ["Feature A", "Feature B"],
        },
      ],
      skills: [
        { category: "Languages", items: ["Python", "JavaScript"] },
      ],
      certifications: ["AWS Certified Developer"],
      cta: {
        text: "Let's connect!",
        button_label: "Email me",
        button_href: "mailto:jane@example.com",
      },
    },
    ...overrides,
  };
}

describe("renderHTML", () => {
  it("returns a complete HTML document", () => {
    const html = renderHTML(makeSite());
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("</html>");
  });

  it("includes the candidate name in the title and header", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("<title>Jane Smith — Portfolio</title>");
    expect(html).toContain('<h1 class="name">Jane Smith</h1>');
  });

  it("includes all five CSS custom properties from the theme", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("--primary:#4E70F1");
    expect(html).toContain("--secondary:#FBAB9C");
    expect(html).toContain("--tertiary:#8DE0FF");
    expect(html).toContain("--accent2:#0b1220");
    expect(html).toContain("--accent1:#eaf0ff");
  });

  it("renders about paragraphs", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("<p>I build software.</p>");
    expect(html).toContain("<p>I care about users.</p>");
  });

  it("renders education cards", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("B.S. Computer Science");
    expect(html).toContain("State University");
    expect(html).toContain("Dean&#39;s List");
  });

  it("renders experience cards with bullets", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("Software Intern");
    expect(html).toContain("Acme Corp");
    expect(html).toContain("<li>Built API</li>");
    expect(html).toContain("<li>Improved latency by 40%</li>");
  });

  it("renders project cards with a View link when link is provided", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("My Project");
    expect(html).toContain('href="https://github.com/jane/proj"');
    expect(html).toContain(">View</a>");
  });

  it("renders project cards with [Add link] placeholder when link is empty", () => {
    const site = makeSite();
    site.sections.projects[0].link = "";
    const html = renderHTML(site);
    expect(html).toContain("[Add link]");
    expect(html).not.toContain(">View</a>");
  });

  it("renders skill categories and items", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("Languages");
    expect(html).toContain("<li>Python</li>");
    expect(html).toContain("<li>JavaScript</li>");
  });

  it("renders certifications list", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("<li>AWS Certified Developer</li>");
  });

  it("renders the fallback message when certifications are empty", () => {
    const site = makeSite();
    site.sections.certifications = [];
    const html = renderHTML(site);
    expect(html).toContain("[Add certifications if applicable]");
  });

  it("renders the CTA section", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("Let&#39;s connect!");
    expect(html).toContain("Email me");
    expect(html).toContain('href="mailto:jane@example.com"');
  });

  it("renders the footer with the candidate name", () => {
    const html = renderHTML(makeSite());
    expect(html).toContain("Jane Smith");
    expect(html).toMatch(/©\s*\d{4}/);
  });
});

describe("renderHTML — HTML escaping", () => {
  it("escapes < > & in candidate name", () => {
    const site = makeSite();
    site.meta.name = '<script>alert("xss")</script>';
    const html = renderHTML(site);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes special characters in about paragraphs", () => {
    const site = makeSite();
    site.sections.about = ['She said "hello" & waved'];
    const html = renderHTML(site);
    expect(html).toContain("She said &quot;hello&quot; &amp; waved");
  });

  it("escapes single quotes in experience bullets", () => {
    const site = makeSite();
    site.sections.experience[0].bullets = ["It's working"];
    const html = renderHTML(site);
    expect(html).toContain("It&#39;s working");
  });

  it("does not double-escape already-escaped content", () => {
    const site = makeSite();
    site.meta.headline = "A & B";
    const html = renderHTML(site);
    // Should appear exactly once as &amp;, not &&amp; or &amp;amp;
    expect(html).toContain("A &amp; B");
    expect(html).not.toContain("&amp;amp;");
  });

  it("escapes link hrefs to prevent attribute injection", () => {
    const site = makeSite();
    site.sections.projects[0].link = 'https://evil.com/" onclick="steal()';
    const html = renderHTML(site);
    expect(html).not.toContain('onclick="steal()"');
  });
});

describe("renderHTML — edge cases", () => {
  it("handles multiple education entries", () => {
    const site = makeSite();
    site.sections.education.push({
      degree: "M.S. Data Science",
      institution: "Tech University",
      date: "2026",
      details: [],
    });
    const html = renderHTML(site);
    expect(html).toContain("B.S. Computer Science");
    expect(html).toContain("M.S. Data Science");
  });

  it("handles multiple skill categories", () => {
    const site = makeSite();
    site.sections.skills.push({ category: "Frameworks", items: ["React", "FastAPI"] });
    const html = renderHTML(site);
    expect(html).toContain("Languages");
    expect(html).toContain("Frameworks");
    expect(html).toContain("<li>React</li>");
  });

  it("handles empty optional fields gracefully", () => {
    const site = makeSite();
    site.meta.phone = "";
    site.meta.linkedin = "";
    const html = renderHTML(site);
    expect(html).toContain("</html>");
  });

  it("renders multiple experience entries in order", () => {
    const site = makeSite();
    site.sections.experience.push({
      title: "Senior Engineer",
      org: "BigCo",
      date: "2024–present",
      bullets: ["Led team", "Shipped product"],
    });
    const html = renderHTML(site);
    const internPos = html.indexOf("Software Intern");
    const seniorPos = html.indexOf("Senior Engineer");
    expect(internPos).toBeGreaterThan(-1);
    expect(seniorPos).toBeGreaterThan(-1);
    expect(internPos).toBeLessThan(seniorPos);
  });
});
