# @liche/telemetry

Client-side telemetry extension for `@liche/core` CLIs. Subscribes to the lifecycle event stream, redacts secret-shaped fields, validates against a versioned wire schema, and fans events out to one or more sinks of your choice. **Opt-in by default**. No hosted ingestion — bring your own backend.

```ts
import { defineCli } from '@liche/core'
import { telemetry, httpSink, jsonlFileSink } from '@liche/telemetry'

export const cli = defineCli({
  name: 'shipyard',
  version: '0.1.0',
  extensions: [
    telemetry({
      sinks: [
        httpSink({ url: 'https://ingest.example.com/v1/events' }),
        jsonlFileSink({ path: '/var/log/shipyard/telemetry.jsonl' }),
      ],
    }),
  ],
})
```

A `telemetry()` extension is a no-op until the operator opts in. See **Consent** below.

## Consent (opt-in)

Telemetry emits nothing until at least one of:

- `LICHE_TELEMETRY=1` (Liche-wide consent)
- `${CLI_NAME}_TELEMETRY=1` (per-CLI consent, e.g. `SHIPYARD_TELEMETRY=1`)
- `LICHE_TELEMETRY_CLI=1` (per-invocation override)

A **kill at any level** wins:

| Env var | Effect |
|---|---|
| `DO_NOT_TRACK=1` | Universal kill (consoledonottrack.com). Overrides every enable below. |
| `LICHE_TELEMETRY=0` | Disables Liche-wide; overrides per-CLI and per-invocation enables. |
| `${CLI}_TELEMETRY=0` | Disables this CLI; overrides per-invocation enables. |
| `LICHE_TELEMETRY_<INV>=0` | Disables a specific invocation (`CLI`, `CI`, `AGENT`, `MCP`). |

Value vocabulary: `1|true|yes|on` enables, `0|false|off|no|''` disables. Anything else is treated as unset and resolves to disabled.

### Invocation defaults

Even with consent set, only `invocation: 'cli'` is enabled by default. CI runners are detected automatically via CI env markers and require `LICHE_TELEMETRY_CI=1` or `telemetry({ invocations: [...] })` to opt in. Agent and MCP surfaces are **not** auto-detected: the wrapping lane (e.g. the host running `cli.fetch()`, the MCP server) must explicitly declare itself by setting `LICHE_INVOCATION=agent` or `LICHE_INVOCATION=mcp` on the run env so consent gating applies. Without that declaration, an in-process `cli.fetch()` call resolves as `'cli'` and emits under whatever CLI-level consent is set. The combined effect — declared surface plus the per-invocation switch — is what caps the volume amplification problem LLM agent loops produce.

#### Detecting invocation

`telemetry` derives the current invocation from env, in this order:

1. `LICHE_INVOCATION=cli|ci|agent|mcp` — a declared invocation wins. Set this when wrapping a CLI as an MCP tool, calling it from an agent loop, or stubbing CI for tests.
2. Standard CI markers (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, `CIRCLECI`, `BUILDKITE`, `TF_BUILD`) → `'ci'`.
3. Otherwise → `'cli'`.

`'agent'` and `'mcp'` are **not** derivable from env alone — the wrapping host must set `LICHE_INVOCATION` so telemetry can gate consent for those surfaces correctly. The `telemetry status` subcommand reads invocation through the run-invocation env (`ctx.sources`), so `run(cli, argv, { env })` is the source of truth and ambient `process.env` does not leak in.

### Subcommands

Mount them by installing the extension — they appear under `${cli} telemetry`:

- `${cli} telemetry status` — prints resolved consent for the current environment, including the rule that decided it (`liche-enabled`, `cli-disabled`, `do-not-track`, etc.).
- `${cli} telemetry enable` — prints the env var the operator should export.
- `${cli} telemetry disable` — prints the three kill switches.
- `${cli} telemetry inspect` — prints how to set `LICHE_TELEMETRY_DEBUG=stderr` to see redacted wire events on stderr without sending them anywhere.

## Sinks

A sink is anything implementing `TelemetrySink`:

```ts
interface TelemetrySink {
  readonly name: string
  emit(event: WireEvent): void | Promise<void>
  flush?(deadlineMs: number): Promise<void>
  shutdown?(deadlineMs: number): Promise<void>
}
```

Each sink runs in isolation: a `throw` from one sink does not poison its siblings. After **three consecutive failures**, a per-sink circuit breaker trips and that sink stops receiving events. `shutdown()` bypasses the breaker for a final drain attempt.

### `httpSink({ url, headers?, timeoutMs?, batchSize?, flushMs?, format?, retry? })`

POSTs events to an HTTPS endpoint. **Loss surface**: on `process.exit(code)` direct-call, Bun's `beforeExit` does not fire, so any buffered events in flight are lost. Mitigate by leaving `batchSize: 1` (the default under `invocation: 'cli'`) or adding `jsonlFileSink` alongside HTTP and letting a host-level agent (Vector, Fluentbit, Promtail) ship the file. **SIGKILL is not survivable.**

- 5xx and network errors → retry **once** at 250 ms. Max two attempts per batch.
- 4xx → drop, no retry (matches Sentry's "drop if Sentry is unavailable" guidance).
- 429 → honor `Retry-After`; drop emits during the window.
- `format: 'otlp'` produces OTLP/HTTP Logs `resourceLogs` envelope when the URL ends `/v1/logs`. Default is `'json'` (sends `{ events: [...] }`).

### `jsonlFileSink({ path, append? })`

Appends one JSON line per event. Per-event synchronous flush — safe under SIGKILL of the writer process (the OS commits the prior `appendFile` call before the kill).

### `consoleSink({ stream?, write? })`

One line per event to `process.stderr` (default) or `process.stdout`. Useful for local dev. Automatically installed when `LICHE_TELEMETRY_DEBUG=stderr` is set.

### `noopSink()`

Useful in tests.

## Disclosure

**Default posture**: opt-in. No events emitted unless an env var enables it.

**Events allowlisted by default** (preset `'essential'`):

`command.started`, `command.completed`, `command.failed`, `validation.failed`, `parse.failed`, `command.not_found`, `hook.failed`. Switch to `'all-commands'`, `'errors-only'`, `'all'`, or a custom `CliEventType[]` via `telemetry({ events })`.

**Fields collected per event** (after redaction): `type`, `occurredAt`, `cli.{name, version}`, `format`, `formatExplicit`, `isTty`, `command.{id, path}`, `surface.{kind, name}`, `durationMs`, `exitCode`, `result`, `error.{code, exitCode, fieldErrorCount, retryable, status}`, `completion.{shell, suggestionCount}`, optional `attributes` (extension-provided metadata bag), plus the telemetry envelope: `telemetry.{schemaVersion, sessionId, runId, sdk.{name, version}, runtime.{name, version, platform, arch}}`. Wire events do not carry an `invocation` field — invocation is used internally for consent gating but is not exported per-event.

**Not collected**: anonymous machine ID, user names, file paths beyond what core puts on the event, command-line argument values, secret-shaped fields (see Redaction).

**Redaction rules applied once before fan-out** (type-preserving):

| Rule | Source |
|---|---|
| `bearer` | RFC 6750 §2.1 |
| `jwt` | RFC 7519 §3 (three base64url segments) |
| `github-pat-classic` | `gh[pousr]_` + 36 chars |
| `github-pat-fine-grained` | `github_pat_` + 82 chars |
| `aws-akia` | `AKIA`/`ASIA` + 16 uppercase alphanumerics |
| `stripe` | `(sk\|rk)_(live\|test)_` + 24+ chars |
| `slack` | `xox[abporse]-…`, `xoxe.`, `xapp-`, `xwfp-` |
| `google-api` | `AIza` + 35 chars |
| `openai` | `sk-`, `sk-proj-`, `sk-svcacct-`, `sk-None-` |
| `npm` | `npm_` + 36 chars |
| `inline-secret-value` | quoted `key=value` patterns |
| `field-name-secrets` | object keys matching `authorization\|password\|secret\|token\|api[_-]?key\|private[_-]?key` |

Extend without weakening via `telemetry({ extraSecretKeys: [/.../], extraStringPatterns: [/.../], redactor: (e) => ... })`. The custom `redactor` runs **after** built-ins.

## Performance & bundle

- Per-event sync path (redact + validate): **p99 ≈ 27 µs** on Bun 1.3.9 / macOS arm64.
- Minified bundle: **~13 KB**, zero runtime dependencies beyond `@liche/core`.

## Testing

`@liche/telemetry/testing` exports test helpers — subpath import, no runtime dep:

```ts
import { defineCli, run } from '@liche/core'
import { telemetry } from '@liche/telemetry'
import { memorySink, throwingSink, expectRedacted } from '@liche/telemetry/testing'

const sink = memorySink()
const cli = defineCli({ extensions: [telemetry({ sinks: [sink], env })] })
await run(cli, ['some', 'cmd'], { env })
expect(sink.events.map((e) => e.type)).toContain('command.completed')
```

## Roadmap

- v1.1 — dedicated `telemetry` section in the release manifest (currently the env vars are documented under `docs/env-vars.md`; the manifest schema bump 1 → 2 is coordinated with the next `@liche/releases` release).
- v1.1 — `terminal: true` annotation in `@liche/core` so the `'essential'` preset derives from core rather than hand-curating the list.
- v1.x — on-disk spool for HTTP sinks under contended-network deployments, if real loss reports justify the disk-write cost.
