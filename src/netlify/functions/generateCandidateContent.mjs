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
  const candidateData = {
    ...heroData,
    projects:       projectsData?.projects       ?? [],
    experience:     expSkillsData?.experience    ?? [],
    education:      expSkillsData?.education     ?? [],
    skill_groups:   expSkillsData?.skill_groups  ?? [],
    certifications: expSkillsData?.certifications ?? [],
    publications:   expSkillsData?.publications  ?? [],
    leadership:     expSkillsData?.leadership    ?? [],
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
