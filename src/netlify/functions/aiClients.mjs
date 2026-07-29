// Shared provider-SDK factories. Handler-less helper module (same pattern as
// blobStore.mjs) — not a function endpoint.
//
// WHY THIS EXISTS — Netlify's AI Gateway
// --------------------------------------
// When AI Gateway is active, Netlify injects into the function runtime:
//   ANTHROPIC_BASE_URL / OPENAI_BASE_URL  → <site>/.netlify/ai
//   ANTHROPIC_API_KEY / OPENAI_API_KEY    → a per-invocation gateway JWT
// and wraps global fetch. Both SDKs read *_BASE_URL from the environment by
// default, so `new Anthropic({ apiKey })` sends our *real* provider key to the
// gateway, which rejects it — surfacing as an opaque "401 status code (no body)"
// that looks exactly like an expired key. It also routes traffic through
// Netlify's servers, which breaks keys that use an IP allowlist.
//
// Pinning baseURL defeats both (verified in-runtime: pinned client streams OK,
// unpinned client 401s). baseURL is applied *after* caller opts so it cannot be
// overridden by accident — going through the gateway must be a deliberate choice
// made here, not an oversight at a call site.
//
// Prefer these factories over constructing SDK clients directly, so a new call
// site can't silently reintroduce the gateway path.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com";
export const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

// *_LOCAL wins so a developer's .env key beats the gateway JWT that Netlify
// injects as the bare *_API_KEY.
export function resolveAnthropicKey() {
  return process.env.ANTHROPIC_API_KEY_LOCAL || process.env.ANTHROPIC_API_KEY;
}

export function resolveOpenAIKey() {
  return process.env.OPENAI_API_KEY_LOCAL || process.env.OPENAI_API_KEY;
}

export function makeAnthropic(opts = {}) {
  return new Anthropic({ apiKey: resolveAnthropicKey(), ...opts, baseURL: ANTHROPIC_API_BASE_URL });
}

export function makeOpenAI(opts = {}) {
  return new OpenAI({ apiKey: resolveOpenAIKey(), ...opts, baseURL: OPENAI_API_BASE_URL });
}
