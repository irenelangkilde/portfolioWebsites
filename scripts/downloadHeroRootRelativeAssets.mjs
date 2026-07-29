import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";

const DEFAULT_BASE_URL = "https://webresu.me";
const DEFAULT_HTML_DIR = "html-actual-output/deployed";
const DEFAULT_ASSET_DIR = "html-actual-output/deployed-assets";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) continue;
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) {
    args.set(key, true);
  } else {
    args.set(key, next);
    i += 1;
  }
}

const htmlDir = String(args.get("dir") || DEFAULT_HTML_DIR);
const assetRoot = String(args.get("assets") || DEFAULT_ASSET_DIR);
const baseUrl = String(args.get("base") || process.env.BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
const dryRun = args.has("dry-run");
const rewriteHtml = !args.has("no-rewrite");

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isHeroContext(html, index) {
  const start = Math.max(0, index - 1800);
  const end = Math.min(html.length, index + 1800);
  const context = html.slice(start, end).toLowerCase();
  return /hero|masthead|monogram|scene-hero|--hero-bg-image/.test(context);
}

function collectRootRelativeHeroUrls(html) {
  const matches = [];
  const seen = new Set();
  const patterns = [
    /url\(\s*(["']?)(\/(?!\/)[^"')\s]+)\1\s*\)/gi,
    /\b(?:src|href|poster)=["'](\/(?!\/)[^"']+)["']/gi,
    /\bsrcset=["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (!isHeroContext(html, match.index || 0)) continue;

      const rawValues = pattern.source.includes("srcset")
        ? match[1].split(",").map(part => part.trim().split(/\s+/)[0]).filter(Boolean)
        : [match[2] || match[1]];

      for (const rawValue of rawValues) {
        if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) continue;
        const raw = rawValue;
        const normalized = decodeHtmlAttribute(raw);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        matches.push({ raw, normalized });
      }
    }
  }

  return matches;
}

function extensionFromContentType(contentType) {
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  if (type === "image/svg+xml") return ".svg";
  if (type === "text/css") return ".css";
  if (type === "application/javascript" || type === "text/javascript") return ".js";
  return "";
}

function safePart(value) {
  return String(value || "")
    .replace(/%3A/gi, "-")
    .replace(/%2F/gi, "-")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "asset";
}

function localFileName(urlPath, contentType) {
  const url = new URL(urlPath, baseUrl);
  const params = url.searchParams;
  const asset = params.get("asset");
  if (asset) return safePart(asset);

  const slug = params.get("slug");
  const key = params.get("key");
  const kind = params.get("kind");
  const pathName = basename(url.pathname) || "asset";
  const base = safePart([pathName, slug, kind, key].filter(Boolean).join("-"));
  const currentExt = extname(base);
  const inferredExt = extensionFromContentType(contentType);
  return currentExt ? base : `${base}${inferredExt || ".bin"}`;
}

function toPosixPath(value) {
  return value.split(sep).join("/");
}

function replaceAllUrlForms(html, original, replacement) {
  const escaped = original.replace(/&/g, "&amp;");
  const forms = new Set([original, escaped, decodeHtmlAttribute(original)]);
  let next = html;
  for (const form of forms) {
    next = next.replace(new RegExp(escapeRegExp(form), "g"), replacement);
  }
  return next;
}

async function downloadOne(urlPath, outputDir) {
  const absoluteUrl = new URL(decodeHtmlAttribute(urlPath), baseUrl).toString();
  const res = await fetch(absoluteUrl);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") || "";
  const fileName = localFileName(urlPath, contentType);
  const outputPath = join(outputDir, fileName);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, bytes);
  return { absoluteUrl, outputPath, bytes: bytes.length };
}

async function main() {
  const files = (await readdir(htmlDir))
    .filter(file => file.endsWith(".html"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  let found = 0;
  let downloaded = 0;
  let rewritten = 0;

  for (const file of files) {
    const htmlPath = join(htmlDir, file);
    const originalHtml = await readFile(htmlPath, "utf8");
    const urls = collectRootRelativeHeroUrls(originalHtml);
    if (!urls.length) continue;

    const slug = file.replace(/\.html$/i, "");
    const outputDir = join(assetRoot, slug);
    let nextHtml = originalHtml;
    found += urls.length;

    if (!dryRun) {
      await mkdir(outputDir, { recursive: true });
    }

    console.log(`\n${file}`);
    for (const { raw, normalized } of urls) {
      const absoluteUrl = new URL(normalized, baseUrl).toString();
      if (dryRun) {
        console.log(`  would download ${absoluteUrl}`);
        continue;
      }

      try {
        const result = await downloadOne(normalized, outputDir);
        const replacement = toPosixPath(relative(htmlDir, result.outputPath));
        nextHtml = replaceAllUrlForms(nextHtml, raw, replacement);
        downloaded += 1;
        console.log(`  ${result.absoluteUrl} -> ${replacement} (${result.bytes} bytes)`);
      } catch (error) {
        console.warn(`  failed ${absoluteUrl}: ${error?.message || error}`);
      }
    }

    if (!dryRun && rewriteHtml && nextHtml !== originalHtml) {
      await writeFile(htmlPath, nextHtml, "utf8");
      rewritten += 1;
    }
  }

  const rewriteText = rewriteHtml ? "rewrote" : "left HTML unchanged for";
  console.log(`\nFound ${found} root-relative hero URL(s).`);
  if (dryRun) {
    console.log("Dry run only; no files downloaded or rewritten.");
  } else {
    console.log(`Downloaded ${downloaded} asset(s) and ${rewriteText} ${rewritten} HTML file(s).`);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
