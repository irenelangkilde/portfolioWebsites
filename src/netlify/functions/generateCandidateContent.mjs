/**
 * generateCandidateContent.mjs
 *
 * Three-prompt sequential content generation pipeline.
 * Converts resume_facts + resolved strategy → candidate JSON for the cheerio renderer.
 *
 * Call order:
 *   1. fillHero    — identity, hero copy, section titles, bridge copy, badges
 *   2. fillProjects + fillExperienceSkills  (parallel, both use hero output for consistency)
 *   3. Merge all three into a single candidate JSON
 *
 * Usage:
 *   import { generateCandidateContent } from "./generateCandidateContent.mjs";
 *
 *   const { candidateData, tokenReports } = await generateCandidateContent(callAIFn, {
 *     resumeFacts,
 *     resolved,     // resume_resolved or job_resolved
 *     jobContext,   // job ad text, or ""
 *   });
 */

import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

function loadPrompt(filename) {
  const cwd  = process.cwd();
  let here = null;
  try { here = dirname(fileURLToPath(import.meta.url)); } catch {}
  const candidates = [
    resolve(cwd, `src/netlify/functions/${filename}`),
    resolve(cwd, `netlify/functions/${filename}`),
    resolve(cwd, filename),
  ];
  if (here) candidates.unshift(resolve(here, filename));
  for (const p of candidates) {
    try { return readFileSync(p, "utf-8"); } catch {}
  }
  throw new Error(`Could not load ${filename}`);
}

function parseJson(raw) {
  if (!raw) return null;
  const cleaned = raw.trim()
    .replace(/^```[a-zA-Z]*\r?\n?/, "").replace(/\r?\n?```\s*$/, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function normalizeLabelArray(values) {
  if (typeof values === "string") {
    values = values.split(/[•|]/).map(s => s.trim()).filter(Boolean);
  }
  if (!Array.isArray(values)) return [];
  return values
    .map(value => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const label = String(value.label ?? value.card_label ?? value.name ?? value.title ?? "").trim();
        return label ? { ...value, label } : value;
      }
      const label = String(value || "").trim();
      return label ? { label } : null;
    })
    .filter(Boolean);
}

function firstNonEmpty(...values) {
  return values.find(value => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

const SYSTEM = "Return only a valid JSON object. No markdown. No explanation. No code fences.";

/**
 * @param {Function} callAIFn   (opts) => Promise<{ text, model, usage }>
 * @param {object}   options
 * @param {object}   options.resumeFacts   full resume_facts object
 * @param {object}   options.resolved      resume_resolved or job_resolved
 * @param {string}   options.jobContext    job ad text, or ""
 * @returns {Promise<{ candidateData, tokenReports }>}
 */
export async function generateCandidateContent(callAIFn, {
  resumeFacts,
  resolved,
  jobContext = "",
}) {
  const resolvedJson   = JSON.stringify(resolved,              null, 2);
  const resumeFactsJson = JSON.stringify(resumeFacts,          null, 2);
  const projectsJson   = JSON.stringify(
    resumeFacts?.factual_profile?.projects ?? resumeFacts?.projects ?? [], null, 2
  );

  // ── Step 1: Hero ──────────────────────────────────────────────────────────
  const heroPrompt = loadPrompt("fillHero.md")
    .replace("{{RESOLVED_JSON}}",    resolvedJson)
    .replace("{{RESUME_FACTS_JSON}}", resumeFactsJson)
    .replace("{{JOB_CONTEXT}}",      jobContext);

  let heroResult, heroData;
  try {
    heroResult = await callAIFn({ system: SYSTEM, userText: heroPrompt, maxTokens: 2500 });
    heroData   = parseJson(heroResult.text);
    if (!heroData) throw new Error("fillHero returned unparseable output");
  } catch (err) {
    console.error("[generateCandidateContent] fillHero failed:", err.message);
    heroData = {};
    heroResult = { model: "error", usage: {}, text: "" };
  }

  const heroOutputJson = JSON.stringify(heroData, null, 2);

  // ── Step 2: Projects + Experience/Skills (parallel) ───────────────────────
  const projectsPrompt = loadPrompt("fillProjects.md")
    .replace("{{RESOLVED_JSON}}",    resolvedJson)
    .replace("{{PROJECTS_JSON}}",    projectsJson)
    .replace("{{HERO_OUTPUT_JSON}}", heroOutputJson)
    .replace("{{JOB_CONTEXT}}",      jobContext);

  const expSkillsPrompt = loadPrompt("fillExperienceSkills.md")
    .replace("{{RESOLVED_JSON}}",    resolvedJson)
    .replace("{{RESUME_FACTS_JSON}}", resumeFactsJson)
    .replace("{{HERO_OUTPUT_JSON}}", heroOutputJson)
    .replace("{{JOB_CONTEXT}}",      jobContext);

  const [projectsResult, expSkillsResult] = await Promise.allSettled([
    callAIFn({ system: SYSTEM, userText: projectsPrompt,  maxTokens: 3000 }),
    callAIFn({ system: SYSTEM, userText: expSkillsPrompt, maxTokens: 3500 }),
  ]);

  const projectsData = projectsResult.status === "fulfilled"
    ? parseJson(projectsResult.value.text) : null;
  const expSkillsData = expSkillsResult.status === "fulfilled"
    ? parseJson(expSkillsResult.value.text) : null;

  if (projectsResult.status === "rejected")
    console.warn("[generateCandidateContent] fillProjects failed:", projectsResult.reason?.message);
  if (expSkillsResult.status === "rejected")
    console.warn("[generateCandidateContent] fillExperienceSkills failed:", expSkillsResult.reason?.message);

  // ── Step 3: Merge ─────────────────────────────────────────────────────────
  const sg = expSkillsData?.skill_groups ?? [];
  const projects = projectsData?.projects ?? [];
  const experience = expSkillsData?.experience ?? [];
  const education = expSkillsData?.education ?? [];
  const certifications = expSkillsData?.certifications ?? [];
  const publications = expSkillsData?.publications ?? [];
  const leadership = expSkillsData?.leadership ?? [];
  const statusBadges = normalizeLabelArray(firstNonEmpty(heroData.status_badges, heroData.status_badges_inline));
  const openToRoles = normalizeLabelArray(firstNonEmpty(heroData.open_to_roles, heroData.open_to_items));
  const workDomains = normalizeLabelArray(heroData.work_domains);
  const candidateData = {
    ...heroData,
    projects,
    experience,
    education,
    skill_groups:   sg,
    certifications,
    publications,
    leadership,
    status_badges:  statusBadges,
    open_to_roles:  openToRoles,
    open_to_items:  openToRoles,
    work_domains:   workDomains,
    has_status_badges: statusBadges.length > 0,
    has_open_to_roles: openToRoles.length > 0,
    has_open_to_items: openToRoles.length > 0,
    has_work_domains:  workDomains.length > 0,
    has_certifications: certifications.length > 0,
    has_publications:   publications.length > 0,
    has_leadership:     leadership.length > 0,
    has_projects_intro: Boolean(heroData.projects_intro && String(heroData.projects_intro).trim()),
    has_experience_intro: Boolean(heroData.experience_intro && String(heroData.experience_intro).trim()),
    has_open_to: Boolean(heroData.open_to && String(heroData.open_to).trim()),
    // Flat hero card aliases for templates with fixed (non-section) hero card layouts.
    // hero_skills / hero_toolchain map to the first two skill groups (e.g. EE template).
    // hero_highlights derives the lead bullet from each top experience entry.
    hero_skills:    (sg[0]?.skills ?? []).slice(0, 4),
    hero_toolchain: (sg[1]?.skills ?? []).slice(0, 4),
    hero_highlights: experience
      .map(e => (e.bullets ?? [])[0])
      .filter(Boolean)
      .slice(0, 3),
  };

  // ── Token accounting ──────────────────────────────────────────────────────
  const tokenReports = [
    { stage: "fillHero",
      model: heroResult.model, ...heroResult.usage },
    projectsResult.status === "fulfilled"
      ? { stage: "fillProjects",
          model: projectsResult.value.model, ...projectsResult.value.usage }
      : { stage: "fillProjects", error: String(projectsResult.reason?.message) },
    expSkillsResult.status === "fulfilled"
      ? { stage: "fillExperienceSkills",
          model: expSkillsResult.value.model, ...expSkillsResult.value.usage }
      : { stage: "fillExperienceSkills", error: String(expSkillsResult.reason?.message) },
  ];

  return { candidateData, tokenReports };
}
