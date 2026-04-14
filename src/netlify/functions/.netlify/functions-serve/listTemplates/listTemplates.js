var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// listTemplates.mjs
var listTemplates_exports = {};
__export(listTemplates_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(listTemplates_exports);
var import_fs = require("fs");
var import_path = require("path");
function toLabel(keyword, variant) {
  const words = keyword.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return variant ? words.join(" ") + " " + variant.toUpperCase() : words.join(" ");
}
async function handler() {
  let files = [];
  try {
    files = (0, import_fs.readdirSync)((0, import_path.resolve)(process.cwd(), "html"));
  } catch {
  }
  const templates = [];
  for (const f of files) {
    let m = f.match(/^(.+)Grad_([A-Za-z])\.html$/i);
    if (m) {
      templates.push(toLabel(m[1], m[2]));
      continue;
    }
    m = f.match(/^(.+)Grad\.html$/i);
    if (m) {
      templates.push(toLabel(m[1], null));
    }
  }
  templates.sort((a, b) => a.localeCompare(b));
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ templates })
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=listTemplates.js.map
