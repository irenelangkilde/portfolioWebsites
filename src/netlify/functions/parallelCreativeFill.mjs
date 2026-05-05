/**
 * parallelCreativeFill.mjs
 *
 * Fires two small LLM calls in parallel to generate the creative content slots
 * that go beyond what flattenToMustacheData() can produce deterministically:
 *
 *   creativeCopyPack  → section_arc titles, section bridge copy, about_full, cta_tagline
 *   projectAugment    → job-targeted rewrites of the top-N most relevant projects
 *
 * Usage (from buildWebsite-background.mjs):
 *
 *   import { parallelCreativeFill } from "./parallelCreativeFill.mjs";
 *
 *   const callAIFn = (opts) => callAI(provider, creds, opts);
 *   const { creativePack, augmentedProjects, tokenReports } =
 *     await parallelCreativeFill(callAIFn, {
 *       resolvedStrategy, resumeFacts, templateMeta, jobContext
 *     });
 */

import { readFileSync } from "fs";
import { resolve }      from "path";
import { fileURLToPath } from "url";

const __dir = fileURLToPath(new URL(".", import.meta.url));

function loadPrompt(filename) {
  return readFileSync(resolve(__dir, filename), "utf-8");
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

function resumeFactsExcerpt(resumeFacts) {
  if (!resumeFacts) return {};
  return {
    personal:   resumeFacts.personal   || {},
    education: (resumeFacts.education  || []).map(e => ({
      institution:     e.institution,
      degree:          e.degree,
      major:           e.major,
      graduation_date: e.graduation_date,
    })),
    experience: (resumeFacts.experience || []).map(e => ({
      title: e.title, company: e.company,
      start_date: e.start_date, end_date: e.end_date,
    })),
    projects: (resumeFacts.projects || []).map(p => ({
      name: p.name, technologies: p.technologies, summary: p.summary,
    })),
    skills: resumeFacts.skills || {},
  };
}

const SYSTEM = "Return only a valid JSON object. No markdown. No explanation.";

/**
 * @param {Function} callAIFn  - bound callAI: (opts) => Promise<{text, model, usage}>
 * @param {object}   options
 * @param {object}   options.resolvedStrategy
 * @param {object}   options.resumeFacts
 * @param {object}   options.templateMeta   - { has_about, major, tone }
 * @param {string}   options.jobContext     - brief job ad context, or ""
 * @returns {Promise<{ creativePack, augmentedProjects, tokenReports }>}
 */
export async function parallelCreativeFill(callAIFn, {
  resolvedStrategy,
  resumeFacts,
  templateMeta,
  jobContext = "",
}) {
  const projects = resumeFacts?.projects || [];
  const topN     = Math.min(3, projects.length);

  const creativePrompt = loadPrompt("creativeCopyPack.md")
    .replace("{{TEMPLATE_META_JSON}}",        JSON.stringify(templateMeta,                   null, 2))
    .replace("{{RESOLVED_STRATEGY_JSON}}",    JSON.stringify(resolvedStrategy,               null, 2))
    .replace("{{RESUME_FACTS_EXCERPT_JSON}}", JSON.stringify(resumeFactsExcerpt(resumeFacts), null, 2))
    .replace("{{JOB_CONTEXT}}",               jobContext || "");

  const augmentPrompt = loadPrompt("projectAugment.md")
    .replace("{{TOP_N}}",                  String(topN))
    .replace("{{PROJECTS_JSON}}",          JSON.stringify(projects,          null, 2))
    .replace("{{RESOLVED_STRATEGY_JSON}}", JSON.stringify(resolvedStrategy,  null, 2))
    .replace("{{JOB_CONTEXT}}",            jobContext || "");

  const [packResult, augResult] = await Promise.allSettled([
    callAIFn({ system: SYSTEM, userText: creativePrompt, maxTokens: 2000 }),
    topN > 0
      ? callAIFn({ system: SYSTEM, userText: augmentPrompt,  maxTokens: 1500 })
      : Promise.resolve({ text: '{"augmented_projects":[]}', model: "none", usage: {} }),
  ]);

  const pack     = packResult.status === "fulfilled" ? parseJson(packResult.value.text) : null;
  const augments = augResult.status  === "fulfilled" ? parseJson(augResult.value.text)  : null;

  if (packResult.status === "rejected")
    console.warn("[parallelCreativeFill] creativeCopyPack failed:", packResult.reason?.message);
  if (augResult.status === "rejected")
    console.warn("[parallelCreativeFill] projectAugment failed:",   augResult.reason?.message);

  // Merge augmented descriptions back onto the projects list
  const augmentedProjects = projects.map((p, i) => {
    const hit = augments?.augmented_projects?.find(a => a.index === i);
    return hit?.description ? { ...p, description: hit.description } : p;
  });

  const tokenReports = [
    packResult.status === "fulfilled"
      ? { stage: "creativeCopyPack", model: packResult.value.model, ...packResult.value.usage }
      : { stage: "creativeCopyPack", error: String(packResult.reason?.message) },
    augResult.status  === "fulfilled" && topN > 0
      ? { stage: "projectAugment",   model: augResult.value.model,  ...augResult.value.usage }
      : null,
  ].filter(Boolean);

  return { creativePack: pack, augmentedProjects, tokenReports };
}
