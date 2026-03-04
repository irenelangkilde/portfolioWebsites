export const SITE_JSON_SCHEMA = {
  name: "portfolio_site_draft",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          headline: { type: "string" },
          subtitle: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          linkedin: { type: "string" },
          major: { type: "string" },
          specialization: { type: "string" },
          theme: {
            type: "object",
            additionalProperties: false,
            properties: {
              primary: { type: "string" },
              secondary: { type: "string" },
              accent: { type: "string" },
              dark: { type: "string" },
              light: { type: "string" }
            },
            required: ["primary", "secondary", "accent", "dark", "light"]
          }
        },
        required: ["name", "headline", "subtitle", "email", "phone", "linkedin", "major", "specialization", "theme"]
      },
      sections: {
        type: "object",
        additionalProperties: false,
        properties: {
          about: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 },
          education: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                degree: { type: "string" },
                institution: { type: "string" },
                date: { type: "string" },
                details: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 }
              },
              required: ["degree", "institution", "date", "details"]
            },
            minItems: 1,
            maxItems: 2
          },
          experience: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                org: { type: "string" },
                date: { type: "string" },
                bullets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 }
              },
              required: ["title", "org", "date", "bullets"]
            },
            minItems: 1,
            maxItems: 3
          },
          projects: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                name: { type: "string" },
                link: { type: "string" },
                date: { type: "string" },
                bullets: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 }
              },
              required: ["name", "link", "date", "bullets"]
            },
            minItems: 1,
            maxItems: 3
          },
          skills: {
            type: "object",
            additionalProperties: {
              type: "array",
              items: { type: "string" },
              minItems: 2,
              maxItems: 10
            }
          },
          certifications: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8 },
          cta: {
            type: "object",
            additionalProperties: false,
            properties: {
              text: { type: "string" },
              button_label: { type: "string" },
              button_href: { type: "string" }
            },
            required: ["text", "button_label", "button_href"]
          }
        },
        required: ["about", "education", "experience", "projects", "skills", "certifications", "cta"]
      }
    },
    required: ["meta", "sections"]
  }
};