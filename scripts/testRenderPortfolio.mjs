#!/usr/bin/env node
/**
 * Smoke-test for renderPortfolio: loads templates/sarah/annotated.html,
 * injects synthetic candidate data, writes output to harness/runs/test-render-psychology.html.
 *
 * Usage:
 *   node scripts/testRenderPortfolio.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { renderPortfolio } from "../src/netlify/functions/renderPortfolio.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const annotatedHtml = readFileSync(
  join(ROOT, "templates/sarah/annotated.html"), "utf-8"
);

// Synthetic candidateData matching the schema from generateCandidateContent
const candidateData = {
  // Identity
  name:            "Alex Rivera",
  first_name:      "Alex",
  last_name:       "Rivera",
  email:           "alex.rivera@example.com",
  phone:           "(510) 555-0182",
  linkedin:        "https://linkedin.com/in/alexrivera",
  github:          "",
  website:         "",
  location:        "Oakland, CA",
  major:           "Psychology",
  specialization:  "Clinical & Community",
  graduation_date: "May 2025",
  current_year:    "Class of 2025",
  desired_role:    "Mental Health Case Manager",

  // Hero copy
  headline:          "Turning research into real support for people in crisis.",
  subheadline:       "Psychology graduate with 200+ hours of clinical placement and a published honours thesis on trauma-informed practice.",
  value_proposition: "I bring documented clinical training alongside research experience — most new graduates have one or the other, not both.",
  about:             "My work sits at the intersection of evidence-based research and face-to-face support. I spent two years assisting in a trauma-focused CBT lab, then took that knowledge into a community mental health placement where I worked directly with adults navigating crisis.",
  about_full:        "<p>What drew me to psychology wasn't a single moment — it was the repeated realisation that most people struggling with mental health are not lacking willpower; they're lacking access to someone who actually knows how to help. I wanted to be that person.</p><p>During my research assistant role in the Cognitive & Affective Neuroscience Lab, I coordinated three longitudinal studies tracking anxiety and depression biomarkers across 180 participants. That work taught me to handle sensitive data carefully, communicate complex findings to non-specialist audiences, and spot gaps between what research assumes about people and what clinical settings actually look like. My honours thesis — comparing trauma-informed screening tools across two county clinics — was accepted for presentation at the 2025 Western Psychological Association conference.</p><p>I'm looking for roles in community mental health or clinical case management where I can put both halves of that background to work. I want to contribute to teams that take outcome measurement seriously, not just as a compliance exercise but as a genuine tool for improving care.</p>",
  open_to:           "Full-time mental health case manager and clinical research roles at community health organisations or research-based clinics; open to remote and Bay Area positions.",
  cta_tagline:       "Mental health case manager — Oakland and remote.",

  // Section titles
  projects_section_title:   "Research & Projects",
  skills_section_title:     "Clinical Skills & Tools",
  experience_section_title: "Where I've Worked",
  contact_section_title:    "Let's Talk",
  about_section_title:      "My Background",

  // Bridge copy
  projects_intro:   "The projects below are where I moved from coursework into original inquiry — designing the studies, collecting the data, and drawing the conclusions myself.",
  experience_intro: "My placements covered both research and direct-service settings, which gave me a working vocabulary in both.",

  // Flags
  has_github:           false,
  has_linkedin:         true,
  has_website:          false,
  has_phone:            true,
  has_open_to:          true,
  has_projects_intro:   true,
  has_experience_intro: true,
  cta_tagline:          true,

  // Chips
  status_badges: [
    { label: "B.A. Psychology" },
    { label: "May 2025" },
    { label: "GPA 3.82" },
  ],
  open_to_roles: [
    { label: "Mental Health Case Manager" },
    { label: "Research Coordinator" },
    { label: "Behavioural Health Tech" },
  ],
  work_domains: [
    { label: "Community Health" },
    { label: "Research-Based Clinics" },
    { label: "Remote-Friendly" },
  ],

  // Projects
  projects: [
    {
      name:        "Trauma-Informed Screening Tools: A Comparative Study",
      description: "Two county-run clinics were using different intake screening tools with no shared outcome data — this study asked whether one was meaningfully more effective for trauma-exposed adults. I designed the comparison protocol, trained three volunteer data collectors, and ran the statistical analysis in R. The primary finding — that tool selection interacted significantly with prior trauma disclosure — was presented at WPA 2025.",
      role:        "Principal Investigator (Honours Thesis)",
      dates:       "Sep 2024 – May 2025",
      project_icon: "🧠",
      github_link: "",
      demo_link:   "",
      bullets: [
        "Recruited and consented 94 adult participants across two clinical sites, meeting IRB requirements for vulnerable populations.",
        "Built the data collection instrument in REDCap and trained volunteer RAs to 92% inter-rater reliability.",
        "Ran mixed-model ANOVA in R, identifying a significant tool × trauma-disclosure interaction (F=4.71, p=.03).",
        "Presented findings to a 60-person conference session — first undergraduate paper accepted to WPA from our department in three years.",
      ],
      technologies: ["R", "REDCap", "SPSS", "ANOVA", "IRB protocol design"],
    },
    {
      name:        "Longitudinal Anxiety-Depression Biomarker Study",
      description: "A three-year study tracking biological and self-report markers of anxiety and depression in college students required someone to keep 180 participants engaged, data clean, and the lab's IRB protocol current. I stepped into that coordination role as a sophomore and held it for two years.",
      role:        "Research Coordinator (Lab Assistant)",
      dates:       "Jan 2023 – Dec 2024",
      project_icon: "📊",
      github_link: "",
      demo_link:   "",
      bullets: [
        "Managed participant scheduling and follow-up communications for 180 enrolled participants, maintaining an 84% retention rate across three waves.",
        "Cleaned and validated six waves of combined cortisol and PHQ-9 data, catching three data-entry anomalies before they reached analysis.",
        "Prepared the IRB renewal documentation for years two and three — approved without revision on both occasions.",
      ],
      technologies: ["REDCap", "SPSS", "Excel", "IRB documentation"],
    },
  ],

  // Experience
  experience: [
    {
      title:       "Clinical Placement Student",
      company:     "Alameda County Behavioural Health Services",
      start_date:  "Jan 2025",
      end_date:    "May 2025",
      location:    "Oakland, CA",
      description: "",
      bullets: [
        "Conducted initial intake screenings and safety assessments under supervision for adults presenting in acute mental health crisis.",
        "Co-facilitated a weekly psychoeducation group for 8–12 adults managing anxiety and mood disorders; adapted materials when two non-native-English speakers joined mid-cycle.",
        "Documented 120+ case notes in the county EHR system (Netsmart myAvatar) to state-required standards — zero corrections requested by my supervisor.",
        "Learned to hold a non-directive therapeutic stance under pressure: when a client escalated during my third session, I applied de-escalation techniques from training and brought the session to a safe close without calling for support.",
      ],
      technologies: ["Netsmart myAvatar", "Safety assessment protocols", "Psychoeducation facilitation"],
    },
    {
      title:      "Research Assistant",
      company:    "Cognitive & Affective Neuroscience Lab, UC Berkeley",
      start_date: "Jan 2023",
      end_date:   "Dec 2024",
      location:   "Berkeley, CA",
      description: "",
      bullets: [
        "Coordinated data collection for a longitudinal anxiety biomarker study across 180 participants over three waves.",
        "Trained two new RAs on cortisol sample collection protocol, cutting collection-error rate from 8% to under 2%.",
        "Wrote the participant-facing plain-language summaries for the consent documents — the PI adopted my drafts as the lab's standard template.",
      ],
      technologies: ["REDCap", "SPSS", "cortisol assay protocol"],
    },
  ],

  // Education
  education: [
    {
      institution:     "University of California, Berkeley",
      degree:          "B.A.",
      major:           "Psychology",
      graduation_date: "May 2025",
      gpa:             "3.82 / 4.0",
      honors:          "Honours Thesis with Distinction",
      activities:      ["Counselling Peer Educators", "Psychology Undergraduate Research Network"],
    },
  ],

  // Skills
  skill_groups: [
    {
      group_name: "Clinical & Assessment",
      skills: ["Trauma-informed care", "Safety assessment", "Crisis de-escalation", "CBT psychoeducation", "Motivational interviewing (training)", "Mental Status Exam"],
    },
    {
      group_name: "Research Methods",
      skills: ["IRB protocol design", "REDCap", "Longitudinal data collection", "Inter-rater reliability", "ANOVA / mixed models"],
    },
    {
      group_name: "Data & Reporting",
      skills: ["R", "SPSS", "Excel", "Netsmart myAvatar EHR", "Clinical documentation"],
    },
  ],

  // Certifications
  certifications: [
    { name: "Mental Health First Aid", issuer: "National Council for Mental Wellbeing", date: "2024" },
    { name: "Applied Suicide Intervention Skills Training (ASIST)", issuer: "LivingWorks", date: "2025" },
  ],
};

const colorSpec = {
  primary:    "#5b6abf",
  secondary:  "#8e9ad4",
  accent:     "#e8c84a",
  background: "#fafbff",
  text:       "#1e2044",
};

const rendered = renderPortfolio(annotatedHtml, candidateData, colorSpec);

const outDir = join(ROOT, "harness/runs");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "test-render-psychology.html");
writeFileSync(outPath, rendered, "utf-8");

// Quick smoke checks
const checks = [
  ["name injected",       rendered.includes("Alex Rivera")],
  ["headline injected",   rendered.includes("Turning research")],
  ["about_full injected", rendered.includes("willpower")],
  ["section title",       rendered.includes("Where I've Worked")],
  ["experience bullet",   rendered.includes("intake screenings")],
  ["project name",        rendered.includes("Trauma-Informed Screening")],
  ["skill tag",           rendered.includes("Trauma-informed care")],
  ["certification",       rendered.includes("ASIST")],
  ["color override",      rendered.includes("color-override")],
  ["no data-field left",  !rendered.includes("data-field=")],
  ["no data-section left",!rendered.includes("data-section=")],
  ["no data-if left",     !rendered.includes("data-if=")],
];

let allPassed = true;
for (const [label, passed] of checks) {
  console.log(`${passed ? "✓" : "✗"} ${label}`);
  if (!passed) allPassed = false;
}

console.log(`\nOutput: ${outPath} (${(rendered.length / 1024).toFixed(1)} KB)`);
process.exit(allPassed ? 0 : 1);
