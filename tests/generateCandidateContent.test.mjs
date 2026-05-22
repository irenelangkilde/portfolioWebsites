import { describe, expect, it } from "vitest";
import { generateCandidateContent } from "../src/netlify/functions/generateCandidateContent.mjs";

describe("generateCandidateContent", () => {
  it("filters AI-invented skills against resume facts", async () => {
    const resumeFacts = {
      identity: {
        name: "Test Candidate",
        contact: { email: "test@example.com" },
      },
      factual_profile: {
        skills: {
          technical: ["Survey design"],
          tools: ["R", "SPSS"],
          other: ["Interview coding"],
        },
        experience: [
          { title: "Research Assistant", company: "Campus Lab", technologies: ["Qualtrics"] },
        ],
        projects: [],
        education: [],
      },
    };

    const callAIFn = async ({ userText }) => {
      if (userText.includes("rewriting project entries")) {
        return { text: JSON.stringify({ projects: [] }), model: "test", usage: {} };
      }

      if (userText.includes("experience, skills, and structured data entries")) {
        return {
          text: JSON.stringify({
            experience: [],
            education: [],
            skill_groups: [
              {
                group_name: "Statistics",
                skills: ["R", "Python", "SPSS", "Machine Learning", "Survey design"],
              },
              {
                group_name: "Research Tools",
                skills: ["Interview coding", "Qualtrics", "Tableau"],
              },
            ],
          }),
          model: "test",
          usage: {},
        };
      }

      return {
        text: JSON.stringify({
          name: "Test Candidate",
          headline: "Research shaped by evidence",
          subheadline: "Statistics student with survey and coding experience.",
          status_badges: [],
          open_to_roles: [],
          work_domains: [],
        }),
        model: "test",
        usage: {},
      };
    };

    const { candidateData } = await generateCandidateContent(callAIFn, {
      resumeFacts,
      resolved: {},
    });

    const skills = candidateData.skill_groups.flatMap(group => group.skills);
    expect(skills).toEqual(["R", "SPSS", "Survey design", "Interview coding", "Qualtrics"]);
    expect(skills).not.toContain("Python");
    expect(skills).not.toContain("Machine Learning");
    expect(skills).not.toContain("Tableau");
    expect(candidateData.hero_skills).toEqual(["R", "SPSS", "Survey design"]);
  });
});
