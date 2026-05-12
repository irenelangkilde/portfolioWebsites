#!/usr/bin/env node
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, stat, writeFile } from "fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_FIXTURE = "harness/generation-input.local.json";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_POLL_MS = 1000;
const DEFAULT_WATCH_POLL_MS = 1500;

const HARNESS_KEYS = new Set([
  "name",
  "description",
  "outputDir",
  "watch",
  "files",
  "assertions",
  "steps",
  "timeoutMs",
  "pollMs"
]);

const FILE_FIELDS = {
  sampleHtmlFile: ["sampleHtml", "text"],
  templateHtmlFile: ["templateHtml", "text"],
  jobAdTextFile: ["jobAdText", "text"],
  resumePdfFile: ["resumePdfBase64", "base64"],
  templateScreenshotFile: ["templateScreenshotBase64", "base64"],
  resumeAnalysisJsonFile: ["resumeAnalysisJson", "json"],
  templateAnalysisJsonFile: ["templateAnalysisJson", "json"],
  strategyJsonFile: ["strategyJson", "json"],
  resolvedStrategyFile: ["resolvedStrategy", "json"],
  resumeFactsFile: ["resumeFacts", "json"],
  resumeStrategyFile: ["resumeStrategy", "json"],
  jobAdJsonFile: ["jobAdJson", "json"],
  bridgeJsonFile: ["bridgeJson", "json"],
  contentJsonFile: ["contentJson", "json"],
  colorSpecFile: ["colorSpec", "json"],
  imageContextFile: ["imageContext", "json"],
  page1File: ["page1", "json"],
  page2File: ["page2", "json"],
  page3File: ["page3", "json"]
};

const JSON_TARGETS = new Set([
  "resumeAnalysisJson",
  "templateAnalysisJson",
  "strategyJson",
  "resolvedStrategy",
  "resumeFacts",
  "resumeStrategy",
  "jobAdJson",
  "bridgeJson",
  "contentJson",
  "colorSpec",
  "imageContext",
  "page1",
  "page2",
  "page3"
]);

const TEXT_TARGETS = new Set(["sampleHtml", "templateHtml", "jobAdText"]);
const BASE64_TARGETS = new Set(["resumePdfBase64", "templateScreenshotBase64"]);
const WATCH_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".toml",
  ".txt"
]);
const WATCH_SKIP_DIRS = new Set([
  ".git",
  ".netlify",
  "node_modules",
  "runs",
  "dist",
  "build"
]);

function parseArgs(argv) {
  const args = {
    fixture: DEFAULT_FIXTURE,
    watch: false,
    once: false,
    chargeCredits: false,
    timeoutMs: null,
    pollMs: null,
    watchPollMs: DEFAULT_WATCH_POLL_MS
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture" || arg === "-f") {
      args.fixture = argv[++i];
    } else if (arg === "--watch" || arg === "-w") {
      args.watch = true;
    } else if (arg === "--once") {
      args.once = true;
    } else if (arg === "--charge-credits") {
      args.chargeCredits = true;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[++i]);
    } else if (arg === "--poll-ms") {
      args.pollMs = Number(argv[++i]);
    } else if (arg === "--watch-poll-ms") {
      args.watchPollMs = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/generationHarness.mjs --fixture harness/generation-input.local.json
  node scripts/generationHarness.mjs --fixture harness/generation-input.local.json --watch

Options:
  --fixture, -f       Fixture JSON file. Default: ${DEFAULT_FIXTURE}
  --watch, -w         Rerun after fixture, code, or watched template files change.
  --charge-credits    Let usageQuota increment Supabase credits. Default is to skip counters.
  --timeout-ms        Per-step timeout. Default: ${DEFAULT_TIMEOUT_MS}
  --poll-ms           Preview result poll interval. Default: ${DEFAULT_POLL_MS}
  --watch-poll-ms     File watcher poll interval. Default: ${DEFAULT_WATCH_POLL_MS}
`);
}

function absPath(p, base = ROOT) {
  return isAbsolute(p) ? p : resolve(base, p);
}

function inputPath(p, base = ROOT) {
  if (isAbsolute(p)) return p;
  const fromRoot = resolve(ROOT, p);
  if (existsSync(fromRoot)) return fromRoot;
  return resolve(base, p);
}

function slugify(value, fallback = "generation") {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function timestampForPath(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

async function loadLocalEnv() {
  for (const candidate of [resolve(ROOT, ".env"), resolve(ROOT, "../.env")]) {
    try {
      const raw = await readFile(candidate, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!match) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!(match[1] in process.env)) process.env[match[1]] = value;
      }
      return candidate;
    } catch {}
  }
  return null;
}

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${relative(ROOT, filePath)} is not valid JSON: ${err.message}`);
  }
}

async function readInputFile(target, filePath, explicitType = "") {
  const type = explicitType || inferInputType(target, filePath);
  if (type === "json") return readJsonFile(filePath);
  if (type === "base64") return (await readFile(filePath)).toString("base64");
  return readFile(filePath, "utf8");
}

function inferInputType(target, filePath) {
  const ext = extname(filePath).toLowerCase();
  if (JSON_TARGETS.has(target) || ext === ".json") return "json";
  if (BASE64_TARGETS.has(target) || ext === ".pdf" || ext === ".png" || ext === ".jpg" || ext === ".jpeg") return "base64";
  if (TEXT_TARGETS.has(target) || ext === ".html" || ext === ".md" || ext === ".txt") return "text";
  return "text";
}

async function applyNamedFiles(payload, files = {}, baseDir, inputFiles) {
  for (const [target, spec] of Object.entries(files || {})) {
    const fileSpec = typeof spec === "string" ? { path: spec } : spec;
    if (!fileSpec?.path) throw new Error(`Invalid files.${target}; expected a path.`);
    const filePath = inputPath(fileSpec.path, baseDir);
    payload[target] = await readInputFile(target, filePath, fileSpec.type || "");
    inputFiles.add(filePath);
  }
}

async function applyPayloadFileFields(payload, baseDir, inputFiles) {
  for (const [field, mapping] of Object.entries(FILE_FIELDS)) {
    if (!(field in payload)) continue;
    const [target, type] = mapping;
    const filePath = inputPath(payload[field], baseDir);
    payload[target] = await readInputFile(target, filePath, type);
    inputFiles.add(filePath);
    delete payload[field];
  }
}

function rawPayloadFromFixture(fixture) {
  const payload = {};
  for (const [key, value] of Object.entries(fixture)) {
    if (!HARNESS_KEYS.has(key)) payload[key] = value;
  }
  return payload;
}

function normalizeSteps(fixture) {
  if (Array.isArray(fixture.steps) && fixture.steps.length) {
    return fixture.steps.map((step, index) => ({
      name: step.name || `step-${index + 1}`,
      payload: structuredClone(step.payload || step.body || rawPayloadFromFixture(step)),
      files: step.files || {},
      assertions: step.assertions || fixture.assertions || {},
      timeoutMs: step.timeoutMs,
      pollMs: step.pollMs
    }));
  }

  return [{
    name: fixture.name || "generation",
    payload: structuredClone(fixture.payload || fixture.body || rawPayloadFromFixture(fixture)),
    files: {},
    assertions: fixture.assertions || {},
    timeoutMs: fixture.timeoutMs,
    pollMs: fixture.pollMs
  }];
}

async function materializeFixture(fixturePath) {
  const fixture = await readJsonFile(fixturePath);
  const baseDir = dirname(fixturePath);
  const inputFiles = new Set([fixturePath]);
  const steps = [];

  for (const step of normalizeSteps(fixture)) {
    const payload = structuredClone(step.payload || {});
    await applyNamedFiles(payload, fixture.files || {}, baseDir, inputFiles);
    await applyNamedFiles(payload, step.files || {}, baseDir, inputFiles);
    await applyPayloadFileFields(payload, baseDir, inputFiles);
    steps.push({ ...step, payload });
  }

  return { fixture, steps, inputFiles: [...inputFiles] };
}

function scrubForDisk(value) {
  if (Array.isArray(value)) return value.map(scrubForDisk);
  if (!value || typeof value !== "object") return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && /(base64|datauri|pdf)/i.test(key) && item.length > 200) {
      out[key] = `[${key}: ${item.length} chars]`;
    } else if (typeof item === "string" && item.length > 5000) {
      out[key] = `${item.slice(0, 5000)}\n...[truncated ${item.length - 5000} chars]`;
    } else {
      out[key] = scrubForDisk(item);
    }
  }
  return out;
}

async function invokeBackgroundHandler(payload, timeoutMs, pollMs) {
  const { handler } = await import(`${pathToFileURL(resolve(ROOT, "src/netlify/functions/buildWebsite-background.mjs")).href}?run=${Date.now()}`);
  const response = await handler({
    httpMethod: "POST",
    method: "POST",
    path: "/.netlify/functions/buildWebsite-background",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (response?.statusCode && response.statusCode >= 400) {
    throw new Error(`buildWebsite-background returned ${response.statusCode}: ${response.body || ""}`);
  }

  return pollPreviewResult(payload.jobId, timeoutMs, pollMs);
}

async function pollPreviewResult(jobId, timeoutMs, pollMs) {
  const { getPreviewResultsStore } = await import(`${pathToFileURL(resolve(ROOT, "src/netlify/functions/blobStore.mjs")).href}?run=${Date.now()}`);
  const started = Date.now();
  let lastStatus = "";

  while (Date.now() - started < timeoutMs) {
    const { store, configError } = getPreviewResultsStore();
    if (!store) throw new Error(configError || "Preview result store is unavailable.");
    const raw = await store.get(jobId);
    if (raw) {
      const result = JSON.parse(raw);
      if (result.status !== lastStatus) {
        lastStatus = result.status || "";
        const stage = result.stage ? ` (${result.stage})` : "";
        console.log(`[harness] ${jobId}: ${result.status || "unknown"}${stage}`);
      }
      if (result.status && result.status !== "pending") return result;
    }
    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting for preview result for ${jobId}.`);
}

function assertResult(result, assertions = {}) {
  const failures = [];
  const expectedStatus = assertions.status || "done";
  const html = result.site_html || result.normalizedHtml || "";
  const include = assertions.siteHtmlMustInclude || assertions.mustInclude || [];
  const exclude = assertions.siteHtmlMustNotInclude || assertions.mustNotInclude || [];

  if (expectedStatus && result.status !== expectedStatus) {
    failures.push(`Expected status "${expectedStatus}", got "${result.status || "missing"}".`);
  }
  if (assertions.minSiteHtmlLength && html.length < assertions.minSiteHtmlLength) {
    failures.push(`Expected site HTML length >= ${assertions.minSiteHtmlLength}, got ${html.length}.`);
  }
  for (const needle of include) {
    if (!html.includes(needle)) failures.push(`Expected site HTML to include: ${needle}`);
  }
  for (const needle of exclude) {
    if (html.includes(needle)) failures.push(`Expected site HTML not to include: ${needle}`);
  }
  for (const key of assertions.resultMustHave || []) {
    if (!(key in result)) failures.push(`Expected result to contain key: ${key}`);
  }

  return failures;
}

async function writeArtifacts({ outputDir, runDir, stepDir, stepSlug, payload, result, failures }) {
  await mkdir(stepDir, { recursive: true });
  await writeFile(join(stepDir, "request.json"), JSON.stringify(scrubForDisk(payload), null, 2), "utf8");
  await writeFile(join(stepDir, "result.json"), JSON.stringify(scrubForDisk(result), null, 2), "utf8");

  if (result.site_html) {
    await writeFile(join(stepDir, "site.html"), result.site_html, "utf8");
    await writeFile(join(outputDir, `latest-${stepSlug}.html`), result.site_html, "utf8");
    await writeFile(join(outputDir, "latest.html"), result.site_html, "utf8");
  }
  if (result.normalizedHtml) {
    await writeFile(join(stepDir, "normalized.html"), result.normalizedHtml, "utf8");
    await writeFile(join(outputDir, `latest-${stepSlug}.html`), result.normalizedHtml, "utf8");
  }
  if (result.image_prompt) {
    await writeFile(join(stepDir, "image-prompt.txt"), result.image_prompt, "utf8");
  }
  if (failures.length) {
    await writeFile(join(stepDir, "assertion-failures.txt"), `${failures.join("\n")}\n`, "utf8");
  }
  await writeFile(join(stepDir, "path.txt"), `${relative(ROOT, stepDir)}\n`, "utf8");
  await mkdir(runDir, { recursive: true });
}

async function runOnce(args) {
  const fixturePath = absPath(args.fixture);
  if (!existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${relative(ROOT, fixturePath)}. Copy harness/generation-input.example.json to ${DEFAULT_FIXTURE} and add your inputs.`);
  }

  await loadLocalEnv();
  process.env.NETLIFY_DEV ||= "true";
  if (!args.chargeCredits) process.env.PORTFOLIO_SKIP_USAGE_QUOTA = "true";

  const startedAt = new Date();
  const runStamp = timestampForPath(startedAt);
  const { fixture, steps } = await materializeFixture(fixturePath);
  const fixtureSlug = slugify(fixture.name || basename(fixturePath, extname(fixturePath)));
  const outputDir = absPath(fixture.outputDir || join("harness", "runs", fixtureSlug));
  const runDir = join(outputDir, runStamp);
  const summary = {
    fixture: relative(ROOT, fixturePath),
    startedAt: startedAt.toISOString(),
    outputDir: relative(ROOT, outputDir),
    chargeCredits: !!args.chargeCredits,
    steps: []
  };
  let failed = false;

  await mkdir(runDir, { recursive: true });

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const stepSlug = `${String(index + 1).padStart(2, "0")}-${slugify(step.name, "step")}`;
    const jobId = step.payload.jobId || `harness_${fixtureSlug}_${stepSlug}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const payload = { ...step.payload, jobId };
    const stepStarted = Date.now();
    const timeoutMs = Number(args.timeoutMs || step.timeoutMs || fixture.timeoutMs || DEFAULT_TIMEOUT_MS);
    const pollMs = Number(args.pollMs || step.pollMs || fixture.pollMs || DEFAULT_POLL_MS);
    const stepDir = join(runDir, stepSlug);

    console.log(`[harness] Running ${step.name} (${payload.mode || "full"}) as ${jobId}`);
    let result;
    let failures = [];
    try {
      result = await invokeBackgroundHandler(payload, timeoutMs, pollMs);
      failures = assertResult(result, step.assertions || fixture.assertions || {});
      if (failures.length) failed = true;
    } catch (err) {
      failed = true;
      result = { status: "harness-error", error: err.message || String(err) };
      failures = [result.error];
    }

    await writeArtifacts({ outputDir, runDir, stepDir, stepSlug, payload, result, failures });
    const durationMs = Date.now() - stepStarted;
    summary.steps.push({
      name: step.name,
      mode: payload.mode || "full",
      jobId,
      status: result.status,
      durationMs,
      artifactDir: relative(ROOT, stepDir),
      failures
    });

    const resultLabel = failures.length ? "failed" : "passed";
    console.log(`[harness] ${step.name}: ${resultLabel} in ${Math.round(durationMs / 1000)}s -> ${relative(ROOT, stepDir)}`);
    for (const failure of failures) console.error(`[harness] assertion: ${failure}`);
  }

  summary.finishedAt = new Date().toISOString();
  summary.durationMs = Date.now() - startedAt.getTime();
  summary.status = failed ? "failed" : "passed";
  await writeFile(join(runDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(join(outputDir, "latest-summary.json"), JSON.stringify(summary, null, 2), "utf8");

  console.log(`[harness] Run ${summary.status}: ${relative(ROOT, runDir)}`);
  if (failed) process.exitCode = 1;
}

async function listWatchFiles(paths, ignoreRoots) {
  const files = new Map();

  async function walk(p) {
    const real = absPath(p);
    for (const ignore of ignoreRoots) {
      if (real === ignore || real.startsWith(`${ignore}/`)) return;
    }
    let s;
    try {
      s = await stat(real);
    } catch {
      return;
    }
    if (s.isFile()) {
      if (WATCH_EXTENSIONS.has(extname(real).toLowerCase()) || real.endsWith(".local.json")) {
        files.set(real, `${s.mtimeMs}:${s.size}`);
      }
      return;
    }
    if (!s.isDirectory()) return;
    if (WATCH_SKIP_DIRS.has(basename(real))) return;
    const entries = await readdir(real, { withFileTypes: true });
    for (const entry of entries) {
      await walk(join(real, entry.name));
    }
  }

  for (const p of paths) await walk(p);
  return files;
}

function snapshotsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a.entries()) {
    if (b.get(key) !== value) return false;
  }
  return true;
}

async function watchFixture(args) {
  const fixturePath = absPath(args.fixture);
  const { fixture, inputFiles } = existsSync(fixturePath)
    ? await materializeFixture(fixturePath)
    : { fixture: {}, inputFiles: [fixturePath] };
  const fixtureSlug = slugify(fixture.name || basename(fixturePath, extname(fixturePath)));
  const outputDir = absPath(fixture.outputDir || join("harness", "runs", fixtureSlug));
  const watchPaths = [
    fixturePath,
    ...inputFiles,
    ...(fixture.watch || []).map(p => inputPath(p, dirname(fixturePath))),
    "src/netlify/functions",
    "src/netlify/shared",
    "src/form.js",
    "src/overview.html",
    "templates"
  ].map(p => absPath(p));
  const uniqueWatchPaths = [...new Set(watchPaths)];
  const ignoreRoots = [outputDir].map(p => absPath(p));
  let snapshot = await listWatchFiles(uniqueWatchPaths, ignoreRoots);
  let running = false;
  let queued = false;

  const runChild = () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    queued = false;
    const childArgs = [
      SCRIPT_PATH,
      "--fixture",
      fixturePath,
      "--once",
      ...(args.chargeCredits ? ["--charge-credits"] : []),
      ...(args.timeoutMs ? ["--timeout-ms", String(args.timeoutMs)] : []),
      ...(args.pollMs ? ["--poll-ms", String(args.pollMs)] : [])
    ];
    const child = spawn(process.execPath, childArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit"
    });
    child.on("close", code => {
      running = false;
      if (code) console.error(`[harness] Child run exited with ${code}.`);
      if (queued) runChild();
    });
  };

  console.log(`[harness] Watching ${uniqueWatchPaths.length} path(s). Polling every ${args.watchPollMs}ms.`);
  console.log(`[harness] Output: ${relative(ROOT, outputDir)}`);
  runChild();

  setInterval(async () => {
    try {
      const next = await listWatchFiles(uniqueWatchPaths, ignoreRoots);
      if (!snapshotsEqual(snapshot, next)) {
        snapshot = next;
        console.log("[harness] Change detected; rerunning generation.");
        runChild();
      }
    } catch (err) {
      console.error(`[harness] Watch error: ${err.message || err}`);
    }
  }, Number(args.watchPollMs || DEFAULT_WATCH_POLL_MS));
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.watch && !args.once) {
    await watchFixture(args);
  } else {
    await runOnce(args);
  }
} catch (err) {
  console.error(`[harness] ${err.message || err}`);
  process.exit(1);
}
