/**
 * GET /.netlify/functions/healthCheck
 *
 * Diagnostic: verifies that the imports used by buildWebsite-background can be
 * loaded on the deployed runtime. Returns a JSON summary of which modules
 * loaded successfully vs failed. Sharp is deliberately checked via a lazy
 * import (matching buildWebsite-background's pattern) so a native-binary
 * failure is caught here instead of taking down the whole endpoint.
 */
export async function handler() {
  const results = { runtime: {}, modules: {} };
  try {
    results.runtime = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      env_has_openai_key: !!process.env.OPENAI_API_KEY,
      env_has_openai_local: !!process.env.OPENAI_API_KEY_LOCAL,
      env_has_anthropic_key: !!process.env.ANTHROPIC_API_KEY,
      env_has_netlify_site_id: !!process.env.NETLIFY_SITE_ID,
    };
  } catch (err) {
    results.runtime = { error: err?.message || String(err) };
  }

  const checks = [
    ["openai",         async () => (await import("openai")).default],
    ["cheerio",        async () => (await import("cheerio")).load],
    ["@netlify/blobs", async () => (await import("@netlify/blobs")).getStore],
    ["sharp",          async () => (await import("sharp")).default],
  ];
  for (const [name, load] of checks) {
    try {
      const val = await load();
      results.modules[name] = val ? "OK" : "loaded-but-empty";
    } catch (err) {
      results.modules[name] = `FAIL: ${err?.message || String(err)}`;
    }
  }

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(results, null, 2)
  };
}
