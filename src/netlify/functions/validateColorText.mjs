/**
 * Netlify Function: validateColorText
 * POST /.netlify/functions/validateColorText
 * Body: { text: string }
 * Returns: { valid: boolean, reason: string }
 *
 * Uses Claude Haiku for a quick coherence check on user-supplied color descriptions.
 * Fails open (returns { valid: true }) on any infrastructure error so a transient
 * Anthropic outage does not block portfolio generation.
 */

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 120;

const SYSTEM_PROMPT =
  "You judge whether a short user-supplied text is a coherent description of color " +
  "preferences for a website palette. Return strict JSON only: " +
  '{"valid": true|false, "reason": "one short sentence"}. ' +
  'A description is "valid" when it conveys at least one color, mood, or palette ' +
  'intent (e.g. "deep navy with warm copper accents", "muted earth tones", ' +
  '"#2a3a5c with bright accents"). It is "invalid" when it is gibberish, off-topic, ' +
  "empty, or describes something other than colors.";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function stripFence(text = "") {
  return String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseJsonLoose(raw) {
  const clean = stripFence(raw);
  try { return JSON.parse(clean); } catch {}
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch {}
  }
  return null;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return jsonResponse(400, { error: "Invalid JSON body" }); }

  const text = String(body.text || "").trim();
  if (!text) return jsonResponse(200, { valid: false, reason: "Empty description." });
  if (text.length > 500) return jsonResponse(200, { valid: false, reason: "Description too long (max 500 chars)." });

  const apiKey = process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return jsonResponse(200, { valid: true, reason: "Validator unavailable; accepted." });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `User color description:\n"""${text}"""` }],
      }),
    });
    const raw = await res.text();
    let json;
    try { json = JSON.parse(raw); } catch { json = {}; }
    if (!res.ok) return jsonResponse(200, { valid: true, reason: "Validator unavailable; accepted." });

    const responseText = (json.content || [])
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("")
      .trim();

    const parsed = parseJsonLoose(responseText);
    if (parsed && typeof parsed.valid === "boolean") {
      return jsonResponse(200, {
        valid: parsed.valid,
        reason: String(parsed.reason || "").slice(0, 200),
      });
    }
    return jsonResponse(200, { valid: true, reason: "Validator response unparseable; accepted." });
  } catch (err) {
    return jsonResponse(200, { valid: true, reason: "Validator unavailable; accepted." });
  }
}
