import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the openai module before importing the handler so the module-level
// `new OpenAI(...)` call doesn't fail with a missing API key.
const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class {
      constructor() {
        this.responses = { create: mockCreate };
      }
    },
  };
});

// Import after mock is established
const { handler } = await import("../src/netlify/shared/generatePreview.mjs");

function makeEvent(overrides = {}) {
  return {
    httpMethod: "POST",
    body: JSON.stringify({
      page1: { name: "Jane Smith", email: "jane@example.com" },
      page2: {
        theme: {
          primary: "#111111",
          secondary: "#222222",
          tertiary: "#333333",
          accent2: "#444444",
          accent1: "#555555",
        },
      },
    }),
    ...overrides,
  };
}

describe("generatePreview handler — HTTP method", () => {
  it("returns 405 for GET requests", async () => {
    const res = await handler({ httpMethod: "GET" });
    expect(res.statusCode).toBe(405);
  });

  it("returns 405 for PUT requests", async () => {
    const res = await handler({ httpMethod: "PUT" });
    expect(res.statusCode).toBe(405);
  });
});

describe("generatePreview handler — input validation", () => {
  it("returns 400 when name is missing", async () => {
    const event = makeEvent({
      body: JSON.stringify({ page1: { email: "jane@example.com" }, page2: {} }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/name/i);
  });

  it("returns 400 when email is missing", async () => {
    const event = makeEvent({
      body: JSON.stringify({ page1: { name: "Jane" }, page2: {} }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/email/i);
  });

  it("returns 400 when body is empty", async () => {
    const event = makeEvent({ body: "{}" });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when body is malformed JSON (parse error hits outer catch)", async () => {
    const event = makeEvent({ body: "not json" });
    const res = await handler(event);
    expect(res.statusCode).toBe(500);
    expect(res.statusCode).not.toBe(200);
  });
});

const MINIMAL_SITE = {
  meta: {
    name: "Jane Smith", headline: "Engineer", subtitle: "Sub",
    email: "jane@example.com", phone: "", linkedin: "", major: "", specialization: "",
    theme: { primary: "#4E70F1", secondary: "#FBAB9C", tertiary: "#8DE0FF", accent2: "#0b1220", accent1: "#eaf0ff" },
  },
  sections: {
    about: ["About me."],
    education: [{ degree: "B.S.", institution: "Uni", date: "2024", details: [] }],
    experience: [{ title: "Intern", org: "Co", date: "2023", bullets: ["Did work", "Did more"] }],
    projects: [{ name: "Proj", link: "", date: "2023", bullets: ["A", "B"] }],
    skills: [{ category: "Languages", items: ["Python", "JS"] }],
    certifications: [],
    cta: { text: "Contact me", button_label: "Email", button_href: "mailto:jane@example.com" },
  },
};

describe("generatePreview handler — AI success path", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue({ output_text: JSON.stringify(MINIMAL_SITE) });
  });

  it("returns 200 with site_json and site_html on success", async () => {
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload).toHaveProperty("site_json");
    expect(payload).toHaveProperty("site_html");
  });

  it("applies default theme when page2 is absent", async () => {
    const event = makeEvent({
      body: JSON.stringify({ page1: { name: "Jane Smith", email: "jane@example.com" } }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const { site_json } = JSON.parse(res.body);
    expect(site_json.meta.theme.primary).toBe("#4E70F1");
  });

  it("overrides theme from page2 when provided", async () => {
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const { site_json } = JSON.parse(res.body);
    expect(site_json.meta.theme.primary).toBe("#111111");
  });

  it("site_html contains the candidate name", async () => {
    const res = await handler(makeEvent());
    const { site_html } = JSON.parse(res.body);
    expect(site_html).toContain("Jane Smith");
  });
});

describe("generatePreview handler — AI error path", () => {
  it("returns 500 when the AI call throws", async () => {
    mockCreate.mockRejectedValue(new Error("OpenAI timeout"));
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/OpenAI timeout/i);
  });
});
