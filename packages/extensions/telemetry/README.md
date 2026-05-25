# @liche/telemetry

Local JSONL telemetry sink for `@liche/core` CLIs.

Subscribes to `CliEvent` streams, redacts secret-shaped fields, and appends one JSON object per line to a file path supplied via environment variable. Activation is opt-in via a second environment variable so no event is written by default.

```ts
import { defineCli } from '@liche/core'
import { createLocalTelemetrySink } from '@liche/telemetry'

defineCli({
  name: 'shipyard',
  events: [createLocalTelemetrySink({
    enabledEnvVar: 'SHIPYARD_TELEMETRY',
    fileEnvVar: 'SHIPYARD_TELEMETRY_FILE',
  })],
})
```

A sink is a no-op until both env vars are set: the enable flag must be truthy (anything other than `''`, `'0'`, or case-insensitive `'false'`) and the file path must point at a writable location.

Redaction covers `Authorization`, `Bearer ...` strings, `apiKey`/`api_key`, `password`, `token`, `secret`, and `privateKey` shaped fields recursively through nested objects and arrays. Secret-shaped values are replaced with `[redacted]` before serialization.
