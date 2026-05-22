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

function splitSentences(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g)
    ?.map(sentence => sentence.trim())
    .filter(Boolean) || [];
}

function firstSentence(value) {
  return splitSentences(value)[0] || String(value || "").trim();
}

function normalizeCopy(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function copyRepeats(a, b) {
  const left = normalizeCopy(a);
  const right = normalizeCopy(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (Math.min(left.length, right.length) >= 32 && (left.includes(right) || right.includes(left))) return true;

  const leftTokens = new Set(left.split(" ").filter(token => token.length > 2));
  const rightTokens = new Set(right.split(" ").filter(token => token.length > 2));
  if (leftTokens.size < 4 || rightTokens.size < 4) return false;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap++;
  return overlap / Math.min(leftTokens.size, rightTokens.size) >= 0.72;
}

function pickDistinctCopy(candidates = [], avoid = [], fallback = "") {
  const avoidTexts = avoid.flatMap(value => [value, firstSentence(value)]).filter(Boolean);
  for (const candidate of candidates) {
    const text = String(candidate || "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (avoidTexts.some(other => copyRepeats(text, other))) continue;
    return text;
  }
  return fallback;
}

function removeRepeatedLeadSentence(body, avoid = []) {
  const text = String(body || "").trim();
  if (!text) return text;
  const avoidTexts = avoid.flatMap(value => [value, firstSentence(value)]).filter(Boolean);
  const paragraphs = text.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
  if (!paragraphs.length) return text;

  const leadSentences = splitSentences(paragraphs[0]);
  const lead = leadSentences[0] || paragraphs[0];
  if (!avoidTexts.some(other => copyRepeats(lead, other))) return text;

  const remainingLead = leadSentences.slice(1).join(" ").trim();
  const nextParagraphs = remainingLead ? [remainingLead, ...paragraphs.slice(1)] : paragraphs.slice(1);
  return nextParagraphs.length ? nextParagraphs.join("\n\n") : text;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function cleanSkillLabel(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;|•/&]+|[\s,;|•/&]+$/g, "")
    .trim();
}

function normalizeSkillKey(value) {
  return cleanSkillLabel(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\+/g, " plus ")
    .replace(/#/g, " sharp ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function skillText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string" || typeof value === "number") return cleanSkillLabel(value);
  if (!isRecord(value)) return "";
  for (const key of ["skill", "technology", "tool", "name", "label", "title", "value"]) {
    const text = cleanSkillLabel(value[key]);
    if (text) return text;
  }
  return "";
}

function splitCompositeSkill(value) {
  return cleanSkillLabel(value)
    .split(/\s*(?:,|;|\||•|\n|&)\s*/i)
    .map(cleanSkillLabel)
    .filter(Boolean);
}

function skillLabelVariants(value) {
  const label = cleanSkillLabel(value);
  if (!label) return [];

  const variants = new Set([label]);
  const withoutParentheticals = cleanSkillLabel(label.replace(/\s*\([^)]*\)/g, " "));
  if (withoutParentheticals) variants.add(withoutParentheticals);

  for (const match of label.matchAll(/\(([^)]*)\)/g)) {
    for (const part of splitCompositeSkill(match[1])) variants.add(part);
  }

  for (const part of splitCompositeSkill(label)) {
    variants.add(part);
    if (part.includes("/") && !/^https?:\/\//i.test(part)) {
      for (const slashPart of part.split(/\s*\/\s*/).map(cleanSkillLabel).filter(Boolean)) {
        variants.add(slashPart);
      }
    }
  }

  return [...variants].filter(Boolean);
}

function addAllowedSkill(allowed, value) {
  const label = cleanSkillLabel(value);
  if (!label) return;
  for (const variant of skillLabelVariants(label)) {
    const key = normalizeSkillKey(variant);
    if (key && !allowed.has(key)) allowed.set(key, variant);
  }
}

function collectSkillValues(value, add) {
  if (!value) return;
  if (typeof value === "string" || typeof value === "number") {
    add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectSkillValues(item, add));
    return;
  }
  if (!isRecord(value)) return;

  const direct = skillText(value);
  if (direct) add(direct);

  for (const key of [
    "skills",
    "technologies",
    "technology",
    "tools",
    "programming_languages",
    "technical",
    "domains",
    "soft_skills",
    "other",
    "items",
  ]) {
    if (value[key] !== undefined) collectSkillValues(value[key], add);
  }
}

function resumeProfile(resumeFacts) {
  const facts = resumeFacts?.resume_facts ?? resumeFacts ?? {};
  return facts.factual_profile ?? facts;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildAllowedSkillMap(resumeFacts) {
  const profile = resumeProfile(resumeFacts);
  const allowed = new Map();
  const add = value => addAllowedSkill(allowed, value);

  collectSkillValues(profile.skills, add);
  for (const entry of asArray(profile.experience)) collectSkillValues(entry.technologies, add);
  for (const project of asArray(profile.projects)) collectSkillValues(project.technologies, add);

  return allowed;
}

function groupLabelMap(resolved) {
  return Object.fromEntries(
    (resolved?.website_copy_seed?.skills_subcategory_labels || [])
      .map(({ group, label }) => [group, cleanSkillLabel(label)])
      .filter(([group, label]) => group && label)
  );
}

function uniqueSkillLabels(values) {
  const seen = new Set();
  const labels = [];
  collectSkillValues(values, value => {
    const label = cleanSkillLabel(value);
    const key = normalizeSkillKey(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  });
  return labels;
}

function deterministicResumeSkillGroups(resumeFacts, resolved) {
  const profile = resumeProfile(resumeFacts);
  const skills = isRecord(profile.skills) ? profile.skills : {};
  const labels = groupLabelMap(resolved);
  const defaultLabels = {
    programming_languages: "Programming Languages",
    technical: "Technical Skills",
    tools: "Tools",
    domains: "Domains",
    soft_skills: "Soft Skills",
    other: "Other",
  };
  const used = new Set();
  const groups = Object.keys(defaultLabels)
    .map(key => {
      const groupSkills = uniqueSkillLabels(skills[key]).filter(skill => {
        const skillKey = normalizeSkillKey(skill);
        if (!skillKey || used.has(skillKey)) return false;
        used.add(skillKey);
        return true;
      });
      return groupSkills.length ? {
        group_name: labels[key] || defaultLabels[key],
        skills: groupSkills,
      } : null;
    })
    .filter(Boolean);

  const technologies = uniqueSkillLabels([
    ...asArray(profile.experience).flatMap(entry => entry.technologies || []),
    ...asArray(profile.projects).flatMap(project => project.technologies || []),
  ]).filter(skill => {
    const key = normalizeSkillKey(skill);
    if (!key || used.has(key)) return false;
    used.add(key);
    return true;
  });
  if (technologies.length) groups.push({ group_name: "Tools & Technologies", skills: technologies });

  return groups;
}

function matchAllowedSkill(value, allowed) {
  const text = skillText(value);
  for (const variant of skillLabelVariants(text)) {
    const key = normalizeSkillKey(variant);
    if (key && allowed.has(key)) return { key, label: allowed.get(key) };
  }
  return null;
}

function sanitizeSkillGroups(skillGroups, resumeFacts, resolved) {
  const allowed = buildAllowedSkillMap(resumeFacts);
  if (!allowed.size) return [];

  const used = new Set();
  const sanitized = (Array.isArray(skillGroups) ? skillGroups : [])
    .map(group => {
      const skills = Array.isArray(group?.skills)
        ? group.skills
        : Array.isArray(group?.items)
          ? group.items
          : [];
      const filteredSkills = [];
      for (const skill of skills) {
        const match = matchAllowedSkill(skill, allowed);
        if (!match || used.has(match.key)) continue;
        used.add(match.key);
        filteredSkills.push(match.label);
      }
      return filteredSkills.length
        ? { ...(isRecord(group) ? group : {}), skills: filteredSkills }
        : null;
    })
    .filter(Boolean);

  return sanitized.length ? sanitized : deterministicResumeSkillGroups(resumeFacts, resolved);
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
  const sg = sanitizeSkillGroups(expSkillsData?.skill_groups, resumeFacts, resolved);
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

  const aboutSectionSubheadline = pickDistinctCopy([
    heroData.about_section_subheadline,
    heroData.value_proposition,
    resolved?.positioning?.value_proposition,
    resolved?.website_copy_seed?.about_angle,
    heroData.about,
    "What I've built and where I'm headed."
  ], [
    heroData.subheadline,
    firstSentence(heroData.about_full),
    heroData.headline,
  ], "What I've built and where I'm headed.");

  candidateData.about_section_subheadline = aboutSectionSubheadline;
  candidateData.about_full = removeRepeatedLeadSentence(candidateData.about_full, [
    candidateData.subheadline,
    candidateData.about_section_subheadline,
    candidateData.value_proposition,
    candidateData.about,
    candidateData.headline,
  ]);
  if (copyRepeats(firstSentence(candidateData.about), candidateData.subheadline)) {
    candidateData.about = pickDistinctCopy([
      resolved?.positioning?.core_story,
      resolved?.positioning?.value_proposition,
      candidateData.value_proposition,
    ], [
      candidateData.subheadline,
      candidateData.about_section_subheadline,
      firstSentence(candidateData.about_full),
    ], candidateData.about);
  }

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
