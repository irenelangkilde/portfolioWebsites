var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// extractTemplate.mjs
var extractTemplate_exports = {};
__export(extractTemplate_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(extractTemplate_exports);
var import_fs = require("fs");
var import_path = require("path");
var import_https = __toESM(require("https"), 1);
var import_http = __toESM(require("http"), 1);
function fetchHtmlNode(url) {
  return new Promise((resolve2, reject) => {
    const mod = url.startsWith("https") ? import_https.default : import_http.default;
    const req = mod.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      rejectUnauthorized: false
      // tolerate self-signed / incomplete cert chains
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtmlNode(res.headers.location).then(resolve2, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve2(body));
    });
    req.setTimeout(2e4, () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.on("error", reject);
  });
}
async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" })
    };
  }
  const {
    templateUrl,
    templateHtmlBase64,
    templateImageBase64,
    templateImageMime = "image/png",
    provider = "claude"
  } = body;
  if (!templateUrl && !templateHtmlBase64 && !templateImageBase64) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "One of templateUrl, templateHtmlBase64, or templateImageBase64 is required" })
    };
  }
  const cwd = process.cwd();
  let promptTemplate;
  for (const candidate of [
    (0, import_path.resolve)(cwd, "src/netlify/functions/ExtractExampleWebsiteTemplate.md"),
    (0, import_path.resolve)(cwd, "netlify/functions/ExtractExampleWebsiteTemplate.md"),
    (0, import_path.resolve)(cwd, "ExtractExampleWebsiteTemplate.md")
  ]) {
    try {
      promptTemplate = (0, import_fs.readFileSync)(candidate, "utf-8");
      break;
    } catch {
    }
  }
  if (!promptTemplate) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Could not load ExtractExampleWebsiteTemplate.md" })
    };
  }
  let htmlText = null;
  let imageBase64 = null;
  let imageMime = null;
  if (templateUrl) {
    try {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2e4);
        const res = await fetch(templateUrl, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cache-Control": "no-cache"
          }
        });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        htmlText = await res.text();
      } catch {
        htmlText = await fetchHtmlNode(templateUrl);
      }
      if (!htmlText) throw new Error("Empty response from URL");
      const contentType = "";
      void contentType;
    } catch (e) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: `Could not fetch template URL (${templateUrl}): ${e.message}` })
      };
    }
  } else if (templateHtmlBase64) {
    htmlText = Buffer.from(templateHtmlBase64, "base64").toString("utf-8");
  } else {
    imageBase64 = templateImageBase64;
    imageMime = templateImageMime;
  }
  if (htmlText && htmlText.length > 12e4) {
    htmlText = htmlText.slice(0, 12e4) + "\n<!-- truncated -->";
  }
  let rawHtml;
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OPENAI_API_KEY is not set." })
      };
    }
    let oaiContent;
    if (imageBase64) {
      oaiContent = [
        { type: "input_image", image_url: `data:${imageMime};base64,${imageBase64}` },
        { type: "input_text", text: "Convert this website screenshot into a portfolio template following the instructions. Return valid HTML only." }
      ];
    } else {
      oaiContent = [
        { type: "input_text", text: htmlText },
        { type: "input_text", text: "Convert this into a portfolio template following the instructions. Return valid HTML only." }
      ];
    }
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          instructions: promptTemplate,
          input: [{ role: "user", content: oaiContent }],
          max_output_tokens: 16e3
        })
      });
      const json = await res.json();
      if (!res.ok) {
        return {
          statusCode: 502,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "OpenAI API error: " + JSON.stringify(json) })
        };
      }
      rawHtml = (json.output_text || "").trim();
    } catch (err) {
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "OpenAI fetch error: " + (err.message || String(err)) })
      };
    }
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set." })
      };
    }
    let messageContent;
    if (imageBase64) {
      messageContent = [
        { type: "image", source: { type: "base64", media_type: imageMime, data: imageBase64 } },
        { type: "text", text: "Convert this website screenshot into a portfolio template following the instructions. Return valid HTML only." }
      ];
    } else {
      messageContent = [
        { type: "text", text: htmlText },
        { type: "text", text: "Convert this into a portfolio template following the instructions. Return valid HTML only." }
      ];
    }
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 16e3,
          system: promptTemplate,
          messages: [{ role: "user", content: messageContent }]
        })
      });
      const json = await res.json();
      if (!res.ok) {
        return {
          statusCode: 502,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ error: "Claude API error: " + JSON.stringify(json) })
        };
      }
      rawHtml = (json.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
    } catch (err) {
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Claude fetch error: " + (err.message || String(err)) })
      };
    }
  }
  let embeddedJson = null;
  const commentMatch = rawHtml.match(/<!--\s*(\{[\s\S]*?\})\s*-->/);
  if (commentMatch) {
    try {
      embeddedJson = JSON.parse(commentMatch[1]);
    } catch {
    }
  }
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templateHtml: rawHtml, embeddedJson })
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=extractTemplate.js.map
