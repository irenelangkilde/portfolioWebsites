import { handler as backgroundHandler } from "./buildWebsite-background.mjs";

function isLocalDev(event) {
  const host = String(event?.headers?.host || event?.headers?.Host || "");
  return process.env.NETLIFY_DEV === "true" ||
    /^localhost(?::\d+)?$/i.test(host) ||
    /^127\.0\.0\.1(?::\d+)?$/.test(host) ||
    /^\[?::1\]?(?::\d+)?$/.test(host);
}

export async function handler(event, context) {
  if (!isLocalDev(event)) {
    return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) };
  }

  backgroundHandler(event, context).catch((err) => {
    console.error("[buildWebsite local wrapper] background handler failed:", err?.stack || err?.message || err);
  });

  return { statusCode: 202, body: "" };
}
