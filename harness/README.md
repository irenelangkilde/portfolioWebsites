# Generation Harness

This harness reruns website generation from a saved JSON fixture.

## Setup

Copy the example fixture and replace the payload with the exact inputs to rerun:

```sh
cp harness/generation-input.example.json harness/generation-input.local.json
```

Run once:

```sh
npm run generate:harness
```

Watch mode:

```sh
npm run generate:harness:watch
```

The harness loads `.env`, calls `src/netlify/functions/buildWebsite-background.mjs` directly, polls the preview result store, and writes artifacts under `harness/runs/`.

By default it sets `PORTFOLIO_SKIP_USAGE_QUOTA=true`, so Supabase membership credits are not incremented during repeated local runs. It still calls the configured AI provider. To exercise quota behavior too, run:

```sh
npm run generate:harness -- --charge-credits
```

## Fixture Shape

Most fixtures use a single `payload` object. The payload is the request body sent to `buildWebsite-background`, with convenience file fields:

- `sampleHtmlFile` becomes `sampleHtml`
- `templateHtmlFile` becomes `templateHtml`
- `resumePdfFile` becomes `resumePdfBase64`
- `resumeFactsFile` becomes `resumeFacts`
- `resolvedStrategyFile` becomes `resolvedStrategy`
- `strategyJsonFile` becomes `strategyJson`
- `jobAdJsonFile` becomes `jobAdJson`
- `jobAdTextFile` becomes `jobAdText`

You can also use multi-step fixtures:

```json
{
  "name": "slot-fill-and-image",
  "steps": [
    { "name": "slot-fill", "payload": { "mode": "slot-fill" } },
    { "name": "masthead-image", "payload": { "mode": "generateImage", "imageKind": "masthead" } }
  ]
}
```

Each step gets its own job id and artifact directory.
