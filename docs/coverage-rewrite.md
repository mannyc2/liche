# Rewrite coverage matrix

This matrix covers planned rewrite behavior. The existing `docs/coverage-current.md` tracks the current Bun-native core implementation.

## Parity additions (2026-05-18)

Implemented in current `src/` first; each behavior maps to a rewrite component:

| Behavior ID | Rewrite component | Test |
|---|---|---|
| STREAM-001 | `@lili/core` runtime (cli/execute + cli/serve + cli/fetch) | `parity.test.ts` |
| OPT-DEP-001 | `@lili/core` schema metadata + help renderer | `parity.test.ts` |
| MCP-ADD-001 | `@lili/core` skills/sync resolver | `parity.test.ts` |
| SKILLS-ADD-001 | `@lili/core` skills/sync resolver | `parity.test.ts` |
| GEN-001 | `@lili/core` for now; revisit when `@lili/build` lands (typegen is arguably a build-time concern) | `parity.test.ts` |
| MCP-NAME-001 | `@lili/core` mcp transport | `parity.test.ts` |
| AGENT-FLIP-001 | `@lili/core` execute context | `parity.test.ts` |
| LLMS-SHAPE-001 | `@lili/core` command/registry | `parity.test.ts` |
| OPENAPI-001 | `@lili/core` command/openapi (emit) | `parity.test.ts` |
| OPENAPI-002 | `@lili/core` command/openapi (ingest) | `parity.test.ts` |
| CONFIG-002 | `@lili/core` parser/globals + parser/config | `parity.test.ts` |
| HELP-002 / USAGE-001 | `@lili/core` help renderer | `parity.test.ts` |
| VARS-001 | `@lili/core` execute context | `parity.test.ts` |


Before adding rewrite tests:

1. Find the requirement in `docs/*.md`.
2. Add or update the relevant docs page.
3. Add coverage here.
4. State the known-bad implementation the test catches.

## Build system coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| BUILD-001 | Handwritten core CLI works without `@lili/build`. | `docs/invariant.md` | Package boundary test imports only `@lili/core`. | Public API | Build dependency leaks into core runtime. |
| BUILD-002 | Runtime schema normalizes into canonical IR. | `docs/build-system.md` | Normalize representative schema and snapshot canonical IR. | Requirement fixture | Generator reads erased TypeScript types or raw source formatting. |
| BUILD-003 | Canonical IR digest ignores source formatting. | `docs/invariant.md` | Two differently formatted schemas normalize to same digest. | Canonical IR | Digest computed from source bytes. |
| BUILD-004 | Closed vocabulary rejects unknown verbs and flags. | `docs/build-system.md` | Lint invalid verb and invalid flag fixtures. | Requirement fixture | Vocabulary drift accepted. |
| BUILD-005 | Public operations require output schema. | `docs/build-system.md` | Lint operation without output. | Requirement fixture | Generated surfaces have unknown output contract. |
| BUILD-006 | Locality is required. | `docs/build-system.md` | Lint operation without locality. | Requirement fixture | Local/remote behavior inferred or omitted. |
| BUILD-007 | Locality shape is one input/output contract. | `docs/build-system.md` | Lint attempts to define divergent local/remote contracts. | Requirement fixture | `--local` and `--remote` return different shapes. |
| BUILD-008 | Remote binding must account for all input fields. | `docs/build-system.md` | Lint GET operation with unbound input field. | Requirement fixture | Generated HTTP requests silently drop input. |
| BUILD-009 | Schema portability rejects unsupported Zod constructs. | `docs/build-system.md` | Lint transform/custom-refinement fixture. | Zod + requirement | Generated OpenAPI/JSON Schema lies about behavior. |
| BUILD-010 | Schema does not eagerly import local implementations. | `docs/build-system.md` | Lint schema that imports its `local.module`. | Module graph | Lint/docs/codegen execute implementation side effects. |
| BUILD-011 | Example argv parses to declared input. | `docs/build-system.md` | Lint mismatched `examples[].argv` and `examples[].input`. | Core parser | Docs examples drift from runtime parsing. |
| BUILD-012 | Generated command registers through `Cli.create().command()`. | `docs/build-system.md` | Inspect generated TS and execute command through core. | Public core API | Generator invents a parallel runtime. |
| BUILD-013 | Generated remote command calls core HTTP transport. | `docs/build-system.md` | Fixture generated command invokes mocked `callHttpOperation`. | Core transport primitive | Build layer owns duplicated transport behavior. |
| BUILD-014 | Generated local command imports implementation lazily. | `docs/build-system.md` | Assert module is not imported during lint/generate and imports during local execution. | Module side-effect counter | Schema import triggers implementation side effects. |
| BUILD-015 | Generated and handwritten behavior converges. | `docs/build-system.md` | Run equivalent handwritten and generated CLIs over same inputs and compare output/status. | Public behavior | Generated code diverges from core semantics. |
| BUILD-016 | Drift check fails on hand-edited generated file. | `docs/build-system.md` | Mutate generated header/body and run `--check`. | Generated fixture | Manual edits accepted. |
| BUILD-017 | Compile command emits expected target artifact. | `docs/build-system.md` | Compile fixture schema for one supported target. | Bun executable behavior | Compile path not wired to generated entry. |
| BUILD-018 | Application workflow is operation-first, not UI-route-first. | `docs/application-integration.md` | Example Vite/TanStack app defines operations and API routes, not generated frontend route commands. | Requirement fixture | CLI generator couples to UI route tree. |
| BUILD-019 | Runtime and canonical IR stay separate. | `docs/schema-ir-openapi.md` | Canonical digest fixture contains JSON projections only, no Zod handles/functions. | Canonical IR | Runtime objects leak into digest or generated snapshots. |
| BUILD-020 | Default generated vocabulary forbids `info`, `--format`, and `--skip-confirmations`. | `docs/build-system.md` | Lint fixtures for `projects info`, `format`, and `skipConfirmations`. | Requirement fixture | Current permissive core accepts agent-hostile vocabulary drift. |
| BUILD-021 | Generated commands use `--json` as the machine-output contract. | `docs/build-system.md` | Generated CLI fixture asserts `--json` is present, `--format` is absent or rejected, and help surfaces match. | Generated CLI fixture | Generated CLI preserves current core `--format` contract as the primary agent path. |
| BUILD-022 | Generated helper commands honor `--json`. | `docs/build-system.md` | Run generated helper commands with `--json` and parse structured envelopes. | JSON parser + fixture | Helper commands emit ad hoc text like `wrote ...` under `--json`. |
| BUILD-023 | Effects are required and policy-consistent. | `docs/schema-ir-openapi.md` | Lint fixtures missing `effects`, using invalid `effects.kind`, and declaring dangerous delete with non-destructive policy. | Requirement fixture | Dangerous or executable commands cannot be distinguished by agents or conformance. |
| BUILD-024 | Resource helpers compile down to plain operations. | `docs/application-integration.md` | Resource-authored and hand-authored command fixtures normalize to equivalent operation records. | Canonical IR | CRUD helper becomes a privileged parallel model. |
| BUILD-025 | Workflow commands remain first-class. | `docs/application-integration.md` | Fixture includes `deploy`, `doctor`, or `migrate` command with no remote binding and verifies generation/lints still pass. | Canonical IR | Generator assumes every command is a resource action or HTTP endpoint. |

## Remote transport coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| REMOTE-001 | Core exposes outbound HTTP operation transport without `@lili/build`. | `docs/build-system.md` | Handwritten CLI calls transport directly. | Public API | Remote calls are generation-only. |
| REMOTE-002 | Transport serializes path/query/body mapping. | `docs/build-system.md` | Fixture operation captures outgoing Request. | Fetch Request | Input fields serialized to wrong location. |
| REMOTE-003 | Missing base URL maps to structured error. | `docs/build-system.md` | Omit env/config and run remote command. | Error envelope | Raw config exception leaks. |
| REMOTE-004 | Missing auth maps to structured error. | `docs/build-system.md` | Omit token env and run authenticated command. | Error envelope | Raw env exception leaks. |
| REMOTE-005 | Network failure maps to structured error with retryable metadata. | `docs/http-operation-transport.md` | Mock fetch rejection. | Error envelope | Raw fetch error leaks. |
| REMOTE-006 | Timeout maps to structured error with retryable metadata. | `docs/http-operation-transport.md` | Mock delayed response beyond timeout. | Error envelope | Command hangs or throws raw abort. |
| REMOTE-007 | Non-2xx response maps to structured HTTP error. | `docs/build-system.md` | Fixture 500 JSON/text/HTML responses. | Error envelope | HTML or raw body emitted as success. |
| REMOTE-008 | Malformed success body maps to structured error. | `docs/build-system.md` | 200 with invalid JSON for JSON operation. | Error envelope | JSON parse error leaks. |
| REMOTE-009 | Output schema validates untrusted response. | `docs/build-system.md` | 200 body violates output schema. | Zod + error envelope | Malformed server response returned as success. |
| REMOTE-010 | Mixed local/remote conformance holds. | `docs/build-system.md` | Same input through fixture local impl and fixture backend, compare parsed output. | Output schema | Local and remote implementations drift. |
| REMOTE-011 | Server conformance uses schema as reference. | `docs/build-system.md` | `li-build conform` sends example request to fixture server and validates output. | Output schema + fixture server | OpenAPI emitted but server behavior unverified. |
| REMOTE-012 | Server conformance is separate from `generate --check`. | `docs/build-system.md` | Artifact freshness check runs without server; conformance requires target. | Command contract | CI gate conflates generated drift with live server verification. |
| REMOTE-013 | Bind coverage lints request placement. | `docs/build-system.md` | Missing, unknown, and conflicting bind entries fail lint. | Input schema | Dead parameter or broken request accepted. |
| REMOTE-014 | Destructive conformance requires opt-in fixture. | `docs/build-system.md` | Destructive operation without fixture is skipped with reason, not executed. | Operation policy | Conformance mutates production accidentally. |
| REMOTE-015 | Pure serializer works without network. | `docs/http-operation-transport.md` | Serialize request and assert URL/method/headers/body without fetch. | Core serializer | Conformance depends on a live network call to inspect bind output. |
| REMOTE-016 | Transport throws structured core errors. | `docs/http-operation-transport.md` | Mock failures and assert execution envelope contains normalized codes. | Error envelope | Transport returns mixed result shapes or leaks raw errors. |
| REMOTE-017 | Generated local/remote operations report applied locality. | `docs/build-system.md` | Mixed-mode fixture covers flag/config/default precedence and asserts `meta.locality.mode` and `meta.locality.source`. | Standard result envelope | Agent cannot tell whether the command touched local simulation or a remote resource. |
| REMOTE-018 | `--local` and `--remote` are mutually exclusive. | `docs/build-system.md` | Generated mixed-mode command invoked with both flags fails before execution. | Parser error fixture | Command silently chooses one mode when the user's intent is ambiguous. |

## Generated surfaces coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| SURFACE-001 | OpenAPI emits only HTTP-compatible operations. | `docs/build-system.md` | Mixed schema with remote and local-only operations. | Requirement fixture | Local-only operation appears as HTTP route. |
| SURFACE-002 | OpenAPI is generated from canonical IR. | `docs/build-system.md` | Compare OpenAPI output from equivalent formatted schemas. | Canonical IR | OpenAPI generated from raw source or runtime reflection. |
| SURFACE-003 | MCP tools are generated from canonical IR for schema-driven CLIs. | `docs/build-system.md` | Compare generated MCP tool definitions to IR. | Canonical IR | Core reflection silently wins for generated CLI. |
| SURFACE-004 | Docs/reference markdown uses command vocabulary and examples. | `docs/build-system.md` | Golden generated docs fixture. | Requirement fixture | Docs drift from schema examples. |
| SURFACE-005 | Generated JSON Schema is portable. | `docs/build-system.md` | Generate schema for supported Zod shapes. | JSON Schema validator | Unsupported Zod construct emitted incorrectly. |
| SURFACE-006 | OpenAPI consumes remote bind placement. | `docs/build-system.md` | Generate OpenAPI with path/query/header/body fields and inspect parameter/requestBody placement. | OpenAPI schema | All input fields emitted as body or omitted. |
| SURFACE-007 | Schema-driven OpenAPI does not use current runtime reflection fallback. | `docs/build-system.md` | Mixed local/remote fixture proves HTTP methods, paths, operation IDs, and excluded local-only operations come from canonical IR. | Canonical IR + OpenAPI schema | Every command is emitted as `POST` regardless of REST contract or locality. |
| SURFACE-008 | Generated surface manifest records every emitted surface. | `docs/build-system.md` | Generate a fixture with CLI, OpenAPI, MCP, docs, Agent Skill, and config schema outputs and inspect manifest records. | Surface manifest schema | Generated artifacts exist but drift/provenance cannot name their source. |
| SURFACE-009 | Surface drift reports stale surface IDs. | `docs/build-system.md` | Hand-edit one generated surface and run `generate --check`. | Generated fixture | Drift failure is generic or misses non-CLI surfaces. |
| SURFACE-010 | OpenAPI-derived downstream surfaces consume OpenAPI, not raw schema or CLI output. | `docs/schema-ir-openapi.md` | Adapter fixture receives only OpenAPI plus digest and fails if it reads schema/generated CLI files. | OpenAPI document + digest | SDK/Terraform/Code Mode generator couples to schema internals. |
| SURFACE-011 | Command MCP tools and Code Mode MCP are separate surfaces. | `docs/schema-ir-openapi.md` | Fixture with local-only operation appears in command MCP manifest but not in OpenAPI-derived downstream manifest. | Canonical IR + OpenAPI eligibility | HTTP-only downstream MCP overwrites command MCP semantics. |
| SURFACE-012 | Product-specific surfaces require explicit adapters. | `docs/application-integration.md` | Request `wrangler.jsonc`, Workers Binding RPC, dashboard metadata, or generated server/API output before adapter registration. | Requirement gate | Build silently emits partial product-specific artifacts. |
| SURFACE-013 | Command manifest is IR-derived and includes effects/locality. | `docs/build-system.md` | Generate `schema --json` or command manifest output and assert argv, input/output schemas, effects, locality, and examples. | Canonical IR | Agent manifest loses CLI-only semantics or mirrors OpenAPI instead. |

## Distribution coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| RELEASE-001 | Manifest validates against schema. | `docs/distribution.md` | Validate generated fixture manifest. | Zod manifest schema | Renderer consumes invalid manifest. |
| RELEASE-002 | Manifest records schema provenance. | `docs/distribution.md` | Assert schema name/version/commit/digest. | Build record fixture | Binary not traceable to schema. |
| RELEASE-003 | Manifest records runtime env/config expectations. | `docs/distribution.md` | Remote config fixture includes env expectations. | Program IR | Binary runtime contract discoverable only by failing at runtime. |
| RELEASE-004 | Binary hash and size use final signed bytes. | `docs/distribution.md` | Sign/mutate fixture bytes before hashing. | sha256/file size | Hash computed before signing. |
| RELEASE-005 | npm renderer pins exact platform package versions. | `docs/distribution.md` | Render umbrella package and inspect optionalDependencies. | Manifest | Version skew accepted. |
| RELEASE-006 | npm renderer emits no lifecycle scripts. | `docs/distribution.md` | Inspect package JSONs. | npm package JSON | Install-time execution added. |
| RELEASE-007 | npm final `.tgz` binary hash matches manifest. | `docs/distribution.md` | Pack, unpack, hash executable. | sha256 | Staging verification misses packed artifact drift. |
| RELEASE-008 | npm shim gives actionable missing optional error. | `docs/distribution.md` | Simulate missing platform package. | Requirement fixture | Module resolution error leaks. |
| RELEASE-009 | Renderer interface is pure manifest to staged package. | `docs/distribution.md` | Renderer test runs without schema/build output. | Dependency boundary | Renderer reads non-manifest state. |
| RELEASE-010 | Yank command uses one manifest reference. | `docs/distribution.md` | Dry-run yank fixture for npm and future ecosystems. | Manifest | Yank requires ad hoc package names. |
| RELEASE-011 | npm platform packages verify final `.tgz` binaries. | `docs/npm-binary-packaging.md` | Pack, unpack, hash, and inspect package fields. | Manifest + sha256 | Staging directory verification hides packed artifact drift. |
| RELEASE-012 | Renderer selection supports zero to all renderers inside `@lili/releases`. | `docs/releases.md` | Release config fixtures cover `[]`, one renderer, multiple renderers, and `all`. | Decision record | npm-only flow or separate `release-extra` package becomes the architecture. |

## Docs coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| DOCS-001 | `docs/` stays internal — never shipped as package or command. | `docs/invariant.md` | File presence and package exports check. | Repo tree | Docs shipped as package or command. |
| DOCS-003 | Reading order and log are maintained. | `docs/AGENTS.md` | Docs lint requires reading-order entry and log entry for docs page changes. | Repo tree | Docs pages drift without navigation/history. |
| DOCS-004 | Claims trace to requirement, upstream, or user instruction. | `docs/AGENTS.md` | Spot-check or docs lint for citations. | Docs rules | Unsupported claims become agent lore. |
