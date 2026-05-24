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
| MCP-NAME-001 | `@lili/core` mcp transport | `parity.test.ts` |
| MCP-CONFORMANCE-001 | `@lili/core` MCP JSON-RPC transport + `@lili/product` generated MCP tools | `packages/core/test/mcp-conformance.test.ts`, `packages/product/test/generate-mcp-conformance.test.ts` |
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
| BUILD-001 | Handwritten core CLI works without `@lili/product` or `@lili/build`. | `docs/invariant.md` | Package boundary test imports only `@lili/core`. | Public API | Product/build dependency leaks into core runtime. |
| BUILD-002 | Runtime product schema normalizes into a canonical catalog. | `docs/build-system.md` | Normalize representative schema and snapshot canonical catalog. | Requirement fixture | Generator reads erased TypeScript types, class identity, or raw source formatting. |
| BUILD-003 | Catalog digest ignores source formatting. | `docs/invariant.md` | Two differently formatted schemas normalize to same digest. | Canonical catalog | Digest computed from source bytes. |
| BUILD-004 | Closed vocabulary is a positive allowlist. | `docs/build-system.md` | Lint an absent verb, then add a product-specific verb and verify it passes. | Requirement fixture | Vocabulary drift accepted or project-specific vocabulary blocked. |
| BUILD-005 | Public capabilities require output schema when selected surfaces need one. | `docs/build-system.md` | Lint public capability without output for CLI/agent/docs surfaces. | Requirement fixture | Generated surfaces have unknown output contract. |
| BUILD-006 | Execution mode is required and bound. | `docs/build-system.md` | Lint command without execution, local command without handler, and HTTP capability without HTTP binding. | Requirement fixture | Local/remote/hybrid behavior inferred, omitted, or declared without an implementation binding. |
| BUILD-007 | Execution shape is one input/output contract. | `docs/build-system.md` | Lint attempts to define divergent local/remote contracts for one capability. | Requirement fixture | Alternate execution paths return different shapes. |
| BUILD-008 | HTTP binding must account for all input fields. | `docs/build-system.md` | Lint GET capability with unbound input field. | Requirement fixture | Generated HTTP requests silently drop input. |
| BUILD-009 | Schema portability rejects unsupported Zod constructs. | `docs/build-system.md` | Lint transform/custom-refinement fixture. | Zod + requirement | Generated OpenAPI/JSON Schema lies about behavior. |
| BUILD-010 | Schema does not eagerly import local implementations. | `docs/build-system.md` | Lint schema that imports its `local.module`. | Module graph | Lint/docs/codegen execute implementation side effects. |
| BUILD-011 | Example argv parses to declared input. | `docs/build-system.md` | Lint mismatched `examples[].argv` and `examples[].input`. | Core parser | Docs examples drift from runtime parsing. |
| BUILD-012 | Generated command declares through `defineCli()` / `defineCommand()`. | `docs/build-system.md` | Inspect generated TS and execute command through core. | Public core API | Generator invents a parallel runtime or falls back to fluent registration. |
| BUILD-013 | Generated remote-http capability calls core HTTP transport. | `docs/build-system.md` | Fixture generated command invokes mocked `callHttpOperation`. | Core transport primitive | Build layer owns duplicated transport behavior. |
| BUILD-014 | Generated local or hybrid command imports implementation lazily. | `docs/build-system.md` | Assert module is not imported during lint/generate and imports during local execution. | Module side-effect counter | Schema import triggers implementation side effects. |
| BUILD-015 | Generated and handwritten behavior converges. | `docs/build-system.md` | Run equivalent handwritten and generated CLIs over same inputs and compare output/status. | Public behavior | Generated code diverges from core semantics. |
| BUILD-016 | Drift check fails on hand-edited generated file. | `docs/build-system.md` | Mutate generated header/body and run `--check`. | Generated fixture | Manual edits accepted. |
| BUILD-017 | Compile command emits expected target artifact. | `docs/build-system.md` | Compile fixture schema for one supported target after unit-level profile tests pass. | Bun executable behavior | Compile path not wired to generated entry. |
| BUILD-018 | Application workflow is capability-first, not UI-route-first. | `docs/application-integration.md` | Example Vite/TanStack app defines resources/commands/bindings and API routes, not generated frontend route commands. | Requirement fixture | CLI generator couples to UI route tree. |
| BUILD-019 | Runtime authoring classes and canonical catalog stay separate. | `docs/schema-ir-openapi.md` | Canonical digest fixture contains plain data only, no class instances/functions. | Canonical catalog | Runtime objects leak into digest or generated snapshots. |
| BUILD-020 | Default generated vocabulary is replaceable. | `docs/build-system.md` | Normalize a product schema with an explicit vocabulary object and verify defaults are absent. | Requirement fixture | Defaults become mandatory instead of a convenience preset. |
| BUILD-021 | Generated commands use `--json` as the machine-output contract. | `docs/build-system.md` | Generated CLI fixture asserts `--json` is present, `--format` is absent or rejected, and help surfaces match. | Generated CLI fixture | Generated CLI preserves current core `--format` contract as the primary agent path. |
| BUILD-022 | Generated helper commands honor `--json`. | `docs/build-system.md` | Run generated helper commands with `--json` and parse structured envelopes. | JSON parser + fixture | Helper commands emit ad hoc text like `wrote ...` under `--json`. |
| BUILD-023 | Effects are required and policy-consistent. | `docs/schema-ir-openapi.md` | Lint fixtures missing `effects`, using invalid `effects.kind`, and declaring dangerous delete with non-destructive policy. | Requirement fixture | Dangerous or executable commands cannot be distinguished by agents or conformance. |
| BUILD-024 | Resource helpers compile down to plain capabilities. | `docs/application-integration.md` | Resource-authored and explicit capability fixtures normalize to equivalent catalog records. | Canonical catalog | CRUD helper becomes a privileged parallel model. |
| BUILD-025 | Workflow commands remain first-class. | `docs/application-integration.md` | Fixture includes `deploy`, `doctor`, or `migrate` command with no HTTP binding and verifies generation/lints still pass. | Canonical catalog | Generator assumes every command is a resource action or HTTP endpoint. |
| BUILD-026 | Product schema uses declarative authoring and digests normalized plain data. | `docs/product-schema.md` | Build equivalent `defineProduct()` schemas through separately allocated objects and compare catalog digests. | Canonical catalog | Digest depends on object identity, private fields, or construction side effects. |
| BUILD-027 | Resources, commands, and bindings are sibling catalog nodes. | `docs/product-schema.md` | Workers fixture includes one resource, `deploy`, `dev`, and one binding, then snapshots normalized catalog kinds. | Canonical catalog | Commands or bindings are forced under fake resources. |
| BUILD-028 | Field metadata is first-class in shape projections. | `docs/product-schema.md` | Fixture fields use `secret`, `identifier`, `humanLabel`, and `mutability`; generated catalog preserves metadata. | Field projection | Metadata is lost before CLI/OpenAPI/docs generation. |
| BUILD-029 | Surface membership is normalized once. | `docs/product-schema.md` | Fixture omits some surface hints and asserts defaults for CLI/docs/dashboard/agent/OpenAPI. | Normalized surfaces | Each generator guesses different defaults. |
| BUILD-030 | Generated CLI consumes flattened capabilities. | `docs/next-plan.md` | Generated CLI fixture includes a resource operation and top-level `deploy`/`dev` commands. | Public CLI behavior | CLI generator remains tied to operation-only records. |
| BUILD-032 | Compile profile is the source of truth for `Bun.build()` and `compileFlagsDigest`. | `docs/build-system.md` | Unit-test compile profile construction, path-independent digesting, internal entrypoint rendering, and injected `Bun.build()` options. | Bun build API docs + canonical digest | Shell-string compile logic drifts from recorded flags, or release rebuilds from workspace state. |
| BUILD-033 | `@lili/build` stays generic and does not depend on Product or releases. | `docs/package-layout.md` | Package boundary test inspects runtime dependencies and source imports. | Package graph | Build users who only want standalone CLI compilation pull in Product generation or release rendering. |
| CORE-PLUGIN-001 | Core is simplified around a serializable `CommandContract`; optional renderers/installers/vendor helpers live in plugins or separate packages. | `docs/next-plan.md` | Contract fixture emits schema, manifest, help, and MCP tools without executing handlers; manifest JSON contains no internal state/functions; dependency tests prove plugin packages do not leak into core. | Serializable contract fixture + package graph | Runtime reflection over `Entry`/`CliState` remains the canonical surface, plugin renderers or installer helpers stay hard-wired into core, or plugins are required for normal command execution. |

## Config primitive coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| CONFIG-PRIM-001 | Core exposes opt-in `createConfig(...)` for handwritten CLIs. | `docs/config-primitive.md` | Package consumer imports `createConfig` from `@lili/core`, declares config, and receives typed `ctx.config`. | Public API snapshot | Config remains a private loader hook or Product-only feature. |
| CONFIG-PRIM-002 | CLIs without config reject `--config` and `--no-config`. | `docs/config-primitive.md` | Invoke no-config CLI with each flag and assert parse errors. | CLI parser | Config flags silently no-op or become positionals. |
| CONFIG-PRIM-003 | Explicit config path and disabled config behavior are exclusive and source-aware. | `docs/config-primitive.md` | `--config` loads only one file; `--no-config` disables discovery; both together fail. | Temp filesystem fixture | Explicit files are merged with discovered files or conflicting flags are accepted. |
| CONFIG-PRIM-004 | Project/user discovery follows documented precedence. | `docs/config-primitive.md` | Create user and nested project config files, run from a child cwd, and inspect resolved values/provenance. | Temp filesystem fixture | User config beats project config or upward discovery misses the nearest project file. |
| CONFIG-PRIM-005 | Config-to-option binding is explicit. | `docs/config-primitive.md` | Matching config and option names do not bind until `optionConfig` is declared. | CLI output fixture | Every matching option name is treated as durable config. |
| CONFIG-PRIM-006 | Unknown config keys fail under strict schema. | `docs/config-primitive.md` | Config fixture includes a misspelled top-level field and asserts validation failure. | Core schema validation | Misspelled durable preferences are silently ignored. |
| CONFIG-PRIM-007 | Product config and bindings emit one config schema surface. | `docs/config-primitive.md` | Product fixture with general config and bindings generates schema/docs and surface manifest entries. | Canonical catalog | Binding schema remains the only config surface or general config becomes a separate system. |
| CONFIG-PRIM-008 | General product config rejects secrets. | `docs/config-primitive.md` | Product fixture marks a config field secret and lints fail. | Product lint | Tokens enter docs, config schema, release manifest, or agent surfaces. |

## Remote transport coverage

Current status (2026-05-23): `@lili/core` exports `serializeHttpOperationRequest` and `callHttpOperation`. `packages/core/test/http-operation.test.ts` covers `REMOTE-001` through `REMOTE-009`, plus `REMOTE-015` and `REMOTE-016`, at the core primitive layer. Generated Product wiring now calls the shared transport for literal, env, and config-backed remote base URLs; Product linting and generation fail for HTTP-backed capabilities without `remote.baseUrl`.

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| REMOTE-001 | Core exposes outbound HTTP operation transport without `@lili/product` or `@lili/build`. | `docs/build-system.md` | Handwritten CLI calls transport directly. | Public API | Remote calls are generation-only. |
| REMOTE-002 | Transport serializes path/query/body mapping. | `docs/build-system.md` | Fixture capability captures outgoing Request. | Fetch Request | Input fields serialized to wrong location. |
| REMOTE-003 | Missing base URL maps to structured error. | `docs/build-system.md` | Omit env/config and run remote command. | Error envelope | Raw config exception leaks. |
| REMOTE-004 | Missing auth maps to structured error. | `docs/build-system.md` | Omit token env and run authenticated command. | Error envelope | Raw env exception leaks. |
| REMOTE-005 | Network failure maps to structured error with retryable metadata. | `docs/http-operation-transport.md` | Mock fetch rejection. | Error envelope | Raw fetch error leaks. |
| REMOTE-006 | Timeout maps to structured error with retryable metadata. | `docs/http-operation-transport.md` | Mock delayed response beyond timeout. | Error envelope | Command hangs or throws raw abort. |
| REMOTE-007 | Non-2xx response maps to structured HTTP error. | `docs/build-system.md` | Fixture 500 JSON/text/HTML responses. | Error envelope | HTML or raw body emitted as success. |
| REMOTE-008 | Malformed success body maps to structured error. | `docs/build-system.md` | 200 with invalid JSON for JSON operation. | Error envelope | JSON parse error leaks. |
| REMOTE-009 | Output schema validates untrusted response. | `docs/build-system.md` | 200 body violates output schema. | Zod + error envelope | Malformed server response returned as success. |
| REMOTE-010 | Mixed local/remote conformance holds. | `docs/build-system.md` | Same input through fixture local impl and fixture backend, compare parsed output. | Output schema | Local and remote implementations drift. |
| REMOTE-011 | Server conformance uses schema as reference. | `docs/build-system.md` | `li-product conform` sends example request to fixture server and validates output. | Output schema + fixture server | OpenAPI emitted but server behavior unverified. |
| REMOTE-012 | Server conformance is separate from `generate --check`. | `docs/build-system.md` | Artifact freshness check runs without server; conformance requires target. | Capability contract | CI gate conflates generated drift with live server verification. |
| REMOTE-013 | Bind coverage lints request placement. | `docs/build-system.md` | Missing, unknown, and conflicting bind entries fail lint. | Input schema | Dead parameter or broken request accepted. |
| REMOTE-014 | Destructive conformance requires opt-in fixture. | `docs/build-system.md` | Destructive capability without fixture is skipped with reason, not executed. | Capability policy | Conformance mutates production accidentally. |
| REMOTE-015 | Pure serializer works without network. | `docs/http-operation-transport.md` | Serialize request and assert URL/method/headers/body without fetch. | Core serializer | Conformance depends on a live network call to inspect bind output. |
| REMOTE-016 | Transport throws structured core errors. | `docs/http-operation-transport.md` | Mock failures and assert execution envelope contains normalized codes. | Error envelope | Transport returns mixed result shapes or leaks raw errors. |
| REMOTE-017 | Generated capabilities report applied execution mode. | `docs/build-system.md` | Mixed execution fixture covers flag/config/default precedence when supported and asserts `meta.execution.mode` and `meta.execution.source`. | Standard result envelope | Agent cannot tell whether the command touched local simulation, remote HTTP, or a hybrid workflow. |
| REMOTE-018 | `--local` and `--remote` are mutually exclusive. | `docs/build-system.md` | Generated mixed-mode command invoked with both flags fails before execution. | Parser error fixture | Command silently chooses one mode when the user's intent is ambiguous. |
| REMOTE-019 | Generated remote commands can resolve base URL from declared config. | `docs/config-primitive.md` | Product remote fixture uses `Runtime.config("apiBaseUrl")`, config file supplies it, generated command calls `callHttpOperation`. | Core transport mock | Generated remote wiring stays env/literal-only or reads app config ad hoc. |

## Core supportability coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| CORE-OBS-001 | Lifecycle subscribers are observe-only and receive redacted command events. | `docs/v1-release-plan.md` | Declare `defineCli({ events: [subscriber] })`, run a command with sensitive args/options/env, and inspect captured events. | Event schema | Telemetry sees raw inputs or only command success paths. |
| CORE-OBS-002 | Subscriber failures never change command results. | `docs/v1-release-plan.md` | Subscriber throws during `command.started`; command output and exit code remain successful. | Command result envelope | Telemetry sink failure breaks CLI execution. |
| CORE-OBS-003 | Local lifecycle events cover non-command supportability surfaces without expanding telemetry. | `docs/v1-release-plan.md` | Subscribe to `*`, exercise help/version/completion/schema/not-found/MCP surfaces, and assert event names plus absence of raw argv/request payloads. | Event stream snapshot | Framework hooks become the telemetry API or leak unresolved user input. |
| CORE-OBS-004 | Telemetry sinks consume an explicit allowlist, not every lifecycle event. | `docs/v1-release-plan.md` | Attach a fixture telemetry subscriber that forwards only the documented allowlist while broad local events are also emitted. | Telemetry allowlist | Help, completion, schema, or MCP discovery events are exported by default. |
| CORE-OBS-005 | Telemetry config resolves from the reserved `lili.telemetry` namespace without treating command options or declared app config as telemetry controls. | `docs/v1-release-plan.md` | Config fixture contains `lili.telemetry`, command-option config, and unrelated declared product config keys; resolver applies precedence and leaves command option parsing unchanged. | Telemetry control resolver | Telemetry reads raw app config, collides with product keys, or ignores `--no-config`. |
| CORE-HOOK-001 | Mutation hooks run at documented points before middleware/handler execution. | `docs/v1-release-plan.md` | `beforeExecute` mutates context vars; middleware and handler observe the mutation in order. | Hook contract | Hooks run too late or are conflated with middleware. |
| CORE-HOOK-002 | Hook failures are command failures, unlike subscriber failures. | `docs/v1-release-plan.md` | `beforeExecute` throws a structured error; command returns the normalized error envelope. | Error envelope | Mutation hooks fail silently or look like telemetry failures. |

## Generated surfaces coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| SURFACE-001 | Phase 3C OpenAPI emits only HTTP resource operations. | `docs/build-system.md` | Mixed product schema with resource HTTP ops, remote commands, hybrid commands, and local commands. | Requirement fixture | Command capability appears as an OpenAPI route before command projection is specified. |
| SURFACE-002 | OpenAPI is generated from the normalized catalog. | `docs/build-system.md` | Compare OpenAPI output from equivalent product schemas. | Canonical catalog | OpenAPI generated from raw source or runtime reflection. |
| SURFACE-003 | MCP tools are generated from the catalog for schema-driven CLIs. | `docs/build-system.md` | Compare generated MCP tool definitions to catalog capabilities. | Canonical catalog | Core reflection silently wins for generated CLI. |
| SURFACE-004 | Docs/reference markdown uses command vocabulary and examples. | `docs/build-system.md` | Golden generated docs fixture. | Requirement fixture | Docs drift from schema examples. |
| SURFACE-005 | Generated JSON Schema is portable. | `docs/build-system.md` | Generate schema for supported Zod shapes. | JSON Schema validator | Unsupported Zod construct emitted incorrectly. |
| SURFACE-006 | OpenAPI consumes HTTP bind placement and field metadata. | `docs/build-system.md` | Generate OpenAPI with path/query/header/body fields plus secret/identifier metadata and inspect parameters, requestBody, descriptions, and extensions. | OpenAPI schema | All input fields emitted as body, omitted, or stripped of metadata. |
| SURFACE-007 | Schema-driven OpenAPI does not use current runtime reflection fallback. | `docs/build-system.md` | Mixed product fixture proves HTTP methods, paths, operation IDs, and excluded local-only commands come from the catalog. | Canonical catalog + OpenAPI schema | Every command is emitted as `POST` regardless of REST contract or execution mode. |
| SURFACE-008 | Generated surface manifest records every emitted surface. | `docs/build-system.md` | Generate a fixture with CLI, OpenAPI, MCP, docs, Agent Skill, and config schema outputs and inspect manifest records. | Surface manifest schema | Generated artifacts exist but drift/provenance cannot name their source. |
| SURFACE-009 | Surface drift reports stale surface IDs. | `docs/build-system.md` | Hand-edit one generated surface and run `generate --check`. | Generated fixture | Drift failure is generic or misses non-CLI surfaces. |
| SURFACE-010 | OpenAPI-derived downstream surfaces consume OpenAPI, not raw schema or CLI output. | `docs/schema-ir-openapi.md` | Adapter fixture receives only OpenAPI plus digest and fails if it reads schema/generated CLI files. | OpenAPI document + digest | SDK/Terraform/Code Mode generator couples to schema internals. |
| SURFACE-011 | Command MCP tools and Code Mode MCP are separate surfaces. | `docs/schema-ir-openapi.md` | Fixture with local-only command appears in command MCP manifest but not in OpenAPI-derived downstream manifest. | Canonical catalog + OpenAPI eligibility | HTTP-only downstream MCP overwrites command MCP semantics. |
| SURFACE-012 | Product-specific surfaces require explicit adapters. | `docs/application-integration.md` | Request `wrangler.jsonc`, Workers Binding RPC, dashboard metadata, or generated server/API output before adapter registration. | Requirement gate | Build silently emits partial product-specific artifacts. |
| SURFACE-013 | Command manifest is catalog-derived and includes effects/execution. | `docs/build-system.md` | Generate `schema --json` or command manifest output and assert argv, input/output schemas, effects, execution mode, and examples. | Canonical catalog | Agent manifest loses CLI-only semantics or mirrors OpenAPI instead. |
| SURFACE-014 | Config JSON Schema is generated from declared general config and bindings, with only explicitly reserved runtime namespaces allowed outside strict product fields. | `docs/config-primitive.md` | Product fixture declares general config fields and bindings; generated config schema includes both plus reserved runtime namespaces and rejects unknown app keys. | Canonical catalog config + bindings | Config docs/schema are absent, binding-only, hand-written separately, or silently accept misspelled product fields. |
| BUILD-031 | `@lili/product` has package-local mutation testing. | `docs/build-system.md` | Add `packages/product/stryker.conf.mjs`, `mutate` script, root-catalog Stryker dev deps, and config typecheck inclusion; run the package-local mutate command for an initial report. | Stryker + Bun runner | Product package silently lacks the mutation-testing workflow already available in core. |

### Generated surface implementation trace

| ID | Status | Test file(s) |
|---|---|---|
| SURFACE-003 | Implemented for catalog-derived MCP tools gated by `surfaces.agent` | `packages/product/test/generate-surfaces.test.ts` |
| SURFACE-004 | Partially implemented for generated docs/reference markdown from catalog summaries, schemas, auth requirements, bindings, and capability examples | `packages/product/test/generate-surfaces.test.ts` |
| SURFACE-008 | Implemented for CLI, OpenAPI, command manifest, MCP tools, agent reference, docs reference, and config schema surfaces | `packages/product/test/generate-check.test.ts` |
| SURFACE-009 | Implemented for generated artifact content and manifest metadata drift, with targeted surface ids | `packages/product/test/generate-check.test.ts` |
| SURFACE-013 | Expanded with command path, input/output/env schemas, execution, auth/context/permission requirements, effects, policy, and examples; lints reject missing safety metadata for agent/OpenAPI-visible capabilities | `packages/product/test/generate-surfaces.test.ts`, `packages/product/test/vocabulary-lints.test.ts` |
| SURFACE-014 | Partially implemented for binding-derived config schema; general Product config waits for `CONFIG-PRIM-*` | `packages/product/test/generate-surfaces.test.ts` |

## Auth/session coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| AUTH-001 | Auth providers and capability requirements normalize into the catalog. | `docs/auth-session.md` | Product fixture declares provider, permissions, contexts, and capability `requires`; inspect catalog. | Canonical catalog | Auth modeled as ad hoc generated CLI behavior. |
| AUTH-002 | `SecretString` redacts through string and JSON paths. | `docs/auth-session.md` | Wrap token and assert `String(secret)`, JSON, error details, and metadata redact. | Redaction type | Token leaks through logs or envelopes. |
| AUTH-003 | Env bearer/API key resolution is deterministic. | `docs/auth-session.md` | Resolve auth with env present/missing across CLI, CI, and agent invocations. | Resolution table | Agent or CI falls back to interactive/session behavior unexpectedly. |
| AUTH-004 | Context resolution follows flag > env > allowed stored profile context. | `docs/auth-session.md` | Fixture covers explicit flag, context env, stored profile, env credential plus explicit profile. | Resolution table | Wrong org/project selected silently. |
| AUTH-005 | Generated auth commands are catalog capabilities. | `docs/auth-session.md` | Provider fixture emits `whoami`/`switch` and later `login`/`logout` with auth effects and surfaces. | Catalog snapshot | Auth commands become hard-coded built-ins or agent-visible mutators. |
| AUTH-006 | Normal operations never trigger login implicitly. | `docs/auth-session.md` | Auth-required command without credential fails; generated `login` is the only device-flow path. | CLI behavior | Agent or CI command opens browser/device flow. |
| AUTH-007 | Session store handles permissions, locking, and corruption. | `docs/auth-session.md` | Temporary store asserts mode, atomic write, lock timeout, corrupt rename. | Filesystem fixture | Corrupt sessions silently reset or concurrent writes corrupt state. |
| AUTH-008 | 401/403 map through auth-aware error rules. | `docs/http-operation-transport.md` | Mock 401/403 with/without auth requirement and known scopes. | Error envelope | Every 401 is called expired or every 403 becomes generic HTTP. |
| AUTH-009 | Agent/MCP auth metadata is useful and secret-free. | `docs/auth-session.md` | Generated MCP/tool metadata includes requirements/status and excludes tokens, env values, paths, user codes. | Metadata snapshot | Agent gets secrets or cannot explain missing auth. |
| AUTH-010 | Release manifest records non-secret auth expectations. | `docs/distribution.md` | Manifest fixture includes auth providers, env names, commands, contexts, session posture, no secrets. | Manifest schema | Release artifact hides auth requirements or leaks runtime state. |
| AUTH-011 | Auth global flags are generated only for auth-enabled CLIs. | `docs/auth-session.md` | Compare generated help for auth and no-auth product fixtures. | CLI help snapshot | `--profile`/`--no-session` pollute unauthenticated CLIs. |
| AUTH-012 | Local scope checks are best-effort and server remains authoritative. | `docs/auth-session.md` | Known missing scope fails locally; unknown scopes call server and map 403. | Scope fixture + HTTP mock | CLI blocks valid tokens or treats local scopes as definitive authorization. |

### Phase 3D-A implementation trace

The env-only slice of `docs/auth-session.md` shipped in Phase 3D-A. Implementation pointers for the rows that are already covered by tests:

| ID | Status | Test file(s) |
|---|---|---|
| AUTH-001 | Implemented (env-only) | `packages/product/test/catalog-normalization.test.ts` (Auth/Permission/Context/Capability requires describe blocks) |
| AUTH-002 | Implemented | `packages/core/test/auth/secret.test.ts`, `packages/core/test/auth/errors.test.ts` |
| AUTH-003 | Implemented (env-only) | `packages/core/test/auth/resolve.test.ts` (CLI vs CI invocation, source order, custom headers, known scope checks) |
| AUTH-004 | Partially implemented (env+flag; stored-profile path deferred to 3D-B) | `packages/core/test/auth/resolve.test.ts` (resolveContext describe block), `packages/product/test/generate-cli-auth.test.ts` (generated optional context flag + env fallback) |
| AUTH-006 | Partially implemented (no implicit login because no login command exists yet) | `packages/product/test/generate-cli-auth.test.ts` (missing-env fails with `AUTH_MISSING`, never reaches transport) |
| AUTH-008 | Deferred to Phase 4 (no transport yet) | — |
| AUTH-010 | Implemented (env modes/contexts; session/OAuth-device entries land with their slices) | `packages/product/test/catalog-normalization.test.ts` (Surface manifest auth metadata describe block) |
| AUTH-011 | Implemented (no-auth product emits no auth runtime; conditional imports verified) | `packages/product/test/generate-cli-auth.test.ts` (no-auth assertion at end of source-assertions describe) |
| AUTH-012 | Implemented locally (`AUTH_SCOPE_MISSING` factory wired into `resolveAuth` when `requiredScopes` are passed and the credential has known scopes); server path deferred to Phase 4 | `packages/core/test/auth/errors.test.ts`, `packages/core/test/auth/resolve.test.ts` |
| AUTH-009 | Implemented for 3D-A static requirements/status metadata; resolved account/session status expands in 3D-B | `packages/product/test/generate-cli-auth.test.ts` (`--llms --json` and MCP `tools/list` include non-secret auth metadata) |

AUTH-005 and AUTH-007 require sessions / `whoami` and stay open for 3D-B and beyond.

## Distribution coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| RELEASE-001 | Manifest validates against schema. | `docs/distribution.md` | Validate generated fixture manifest. | Zod manifest schema | Renderer consumes invalid manifest. |
| RELEASE-002 | Manifest records subject/contract provenance. | `docs/distribution.md` | Assert subject id/name/version/commit/contract kind/contract digest. | Build record fixture | Binary not traceable to the source contract. |
| RELEASE-003 | Manifest records runtime env/config expectations. | `docs/distribution.md` | Remote config fixture includes env expectations. | Catalog | Binary runtime contract discoverable only by failing at runtime. |
| RELEASE-004 | Binary hash and size use final signed bytes. | `docs/distribution.md` | Sign/mutate fixture bytes before hashing. | sha256/file size | Hash computed before signing. |
| RELEASE-005 | npm renderer pins exact platform package versions. | `docs/distribution.md` | Render umbrella package and inspect optionalDependencies. | Manifest | Version skew accepted. |
| RELEASE-006 | npm renderer emits no lifecycle scripts. | `docs/distribution.md` | Inspect package JSONs. | npm package JSON | Install-time execution added. |
| RELEASE-007 | npm renderer writes package directories and derived `.tgz` artifacts whose binary hash matches the manifest. | `docs/distribution.md` | Inspect package directories; pack, unpack, hash executable. | sha256 | Renderer only emits opaque tarballs or staging verification misses packed artifact drift. |
| RELEASE-008 | npm shim gives actionable missing optional error. | `docs/distribution.md` | Simulate missing platform package. | Requirement fixture | Module resolution error leaks. |
| RELEASE-009 | Renderer interface is pure manifest plus verified binary records to staged package. | `docs/distribution.md` | Renderer test runs without schema/build output. | Dependency boundary | Renderer reads non-manifest state. |
| RELEASE-010 | Yank command uses one manifest reference. | `docs/distribution.md` | Dry-run yank fixture for npm and future ecosystems. | Manifest | Yank requires ad hoc package names. |
| RELEASE-011 | npm platform packages verify directory contents and final `.tgz` binaries. | `docs/npm-binary-packaging.md` | Inspect package directory fields; pack, unpack, hash, and inspect package fields. | Manifest + sha256 | Directory output and packed artifact drift apart. |
| RELEASE-012 | Renderer selection supports zero to all renderers inside `@lili/releases`. | `docs/releases.md` | Release config fixtures cover `[]`, one renderer, multiple renderers, and `all`. | Decision record | npm-only flow or separate `release-extra` package becomes the architecture. |
| RELEASE-013 | `@lili/releases` consumes build output as manifest/data, not by importing `@lili/core`, `@lili/build`, or `@lili/product`; concrete renderers stay behind subpath exports. | `docs/package-layout.md` | Package boundary test inspects runtime dependencies, imports `@lili/releases` without concrete renderers, and checks renderer subpath exports. | Package graph | Release code reaches around the manifest into core/build/product internals or root imports every renderer. |
| RELEASE-014 | Publish automation derives npm/PyPI/Homebrew/Scoop mutations from one manifest. | `docs/next-plan.md` | Dry-run publish plan for all implemented publishers from one manifest fixture. | Manifest + verified artifact records | Publisher requires ad hoc package names, versions, or workspace state. |
| RELEASE-015 | Selected publisher credentials and repository settings fail before mutation. | `docs/next-plan.md` | Missing npm/PyPI token or Homebrew/Scoop repo config fails during preflight. | Dry-run/preflight fixture | Partial publishes happen before config errors surface. |
| RELEASE-016 | Publish rechecks final artifact hashes immediately before upload/update. | `docs/next-plan.md` | Tamper with a packed artifact after verification and before publish. | sha256 | Stale or tampered artifact is published. |
| RELEASE-017 | npm publish ordering publishes platform packages before the umbrella package. | `docs/next-plan.md` | Capture publish calls and assert platform packages precede umbrella package. | Publish call log | Umbrella package becomes installable before optional binary packages exist. |
| RELEASE-018 | Binary target string agrees with platform, arch, libc, and cpu variant. | `docs/distribution.md` | Fixture includes baseline x64, musl, and mismatched target records. | Bun target parser | Wrong binary selected for package renderer or release matrix. |
| RELEASE-019 | Verified artifact records include renderer, ecosystem, kind, version, sha256, and size. | `docs/distribution.md` | Fixture renderer emits artifact records and verifier rejects incomplete records. | Manifest package IDs + packed artifact hash | Publishing cannot map verified artifacts back to manifest IDs. |
| RELEASE-020 | Renderer preflight is separate from publisher credential preflight. | `docs/distribution.md` | Renderer selection with absent credentials still stages artifacts; publisher preflight fails before mutation. | Phase 5/Phase 7 boundary | Rendering is blocked by missing registry credentials or publishing starts during render. |
| RELEASE-021 | Release provenance integrates supported registry/CI attestations without replacing hash verification. | `docs/distribution.md` | Fixture records npm/PyPI/GitHub provenance metadata and still rejects tampered package bytes. | Attestation metadata + sha256 | Attestation presence bypasses binary/package hash verification. |

### Phase 5 release implementation trace

| ID | Status | Test file(s) |
|---|---|---|
| RELEASE-001 | Implemented | `packages/releases/test/manifest.test.ts` |
| RELEASE-002 | Implemented | `packages/releases/test/manifest.test.ts` |
| RELEASE-003 | Implemented | `packages/releases/test/manifest.test.ts` |
| RELEASE-004 | Implemented | `packages/releases/test/binary.test.ts` |
| RELEASE-009 | Implemented for shared fake-renderer contract; ecosystem renderers deferred to Phase 6 | `packages/releases/test/release-package.test.ts`, `packages/releases/test/package-boundary.test.ts` |
| RELEASE-010 | Implemented as dry-run planning only | `packages/releases/test/yank.test.ts` |
| RELEASE-012 | Implemented for renderer registry/selection | `packages/releases/test/renderer-selection.test.ts` |
| RELEASE-013 | Implemented | `packages/releases/test/package-boundary.test.ts` |
| RELEASE-018 | Implemented | `packages/releases/test/binary.test.ts` |
| RELEASE-019 | Implemented for final artifact file records; ecosystem archive introspection deferred to Phase 6 | `packages/releases/test/release-package.test.ts` |
| RELEASE-020 | Implemented for renderer selection and orchestration; publisher preflight deferred to Phase 7 | `packages/releases/test/renderer-selection.test.ts`, `packages/releases/test/release-package.test.ts` |

### Phase 6 release renderer implementation trace

| ID | Status | Test file(s) |
|---|---|---|
| RELEASE-005 | Implemented for npm umbrella optional dependency pins | `packages/releases/test/ecosystem-renderers.test.ts` |
| RELEASE-006 | Implemented for rendered npm package JSONs | `packages/releases/test/ecosystem-renderers.test.ts` |
| RELEASE-007 | Implemented for npm package directories plus tarball binary hashing | `packages/releases/test/ecosystem-renderers.test.ts` |
| RELEASE-008 | Implemented for missing optional dependency shim error | `packages/releases/test/ecosystem-renderers.test.ts` |
| RELEASE-011 | Implemented for npm platform package directories, tarball package fields, and binary hash | `packages/releases/test/ecosystem-renderers.test.ts` |
| RELEASE-019 | Expanded across npm, PyPI, Homebrew, and Scoop artifacts | `packages/releases/test/ecosystem-renderers.test.ts` |

## V1 public-readiness coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| V1-001 | Every publishable package can be packed and consumed from a temp Bun project. | `docs/v1-release-plan.md` | Pack each package, install packed artifacts into a temp project, and import documented root/subpath exports. | Package READMEs + export maps | Package works only through workspace source paths or unpublished internals. |
| V1-002 | Public README and package READMEs describe runnable v1 workflows. | `docs/v1-release-plan.md` | Execute README quickstart and package README code blocks through examples or temp projects. | Public docs | Documentation points at internal planning docs or stale package names. |
| V1-003 | V1 examples dogfood package boundaries. | `docs/v1-release-plan.md` | `bun run examples:smoke` runs handwritten, generated, remote/conformance, compile, and release examples. | Example fixtures | Examples import source-relative internals or skip the release path. |
| V1-004 | Public docs are curated separately from internal requirement docs. | `docs/v1-release-plan.md` | Package/website file-list check excludes internal requirement docs unless explicitly curated. | Package `files` lists + site inputs | Internal agent/planning docs are shipped wholesale as user docs. |
| V1-005 | LOC, export, dependency, and boundary metrics are tracked before release candidates. | `docs/v1-release-plan.md` | `bun run --silent metrics` records package source LOC, test LOC, public exports, runtime dependencies, and boundary exceptions; the release-candidate gate runs it. | Metrics baseline | Simplification is asserted without a measured baseline or regression signal. |
| V1-006 | Hosted service/platform work is V2 and does not block package publication. | `docs/v1-release-plan.md`, `docs/v2-platform-goals.md` | Release checklist fails if hosted-service tasks are required for package pack/temp-consumer/example/release dry-run success. | V1/V2 cutline | A website/backend product becomes an accidental dependency of publishing the libraries. |
| V1-007 | V1 telemetry is opt-in local instrumentation, not hosted ingestion. | `docs/v1-release-plan.md` | Fixture command emits lifecycle events to a local sink only when enabled; redaction tests cover secrets, env values, context values, and local paths; subscriber failures do not alter results. | Telemetry event schema | Telemetry leaks secrets, becomes mandatory for command execution, or uses mutation hooks as its collection path. |
| V1-008 | Generated diagnostics are available without a hosted service. | `docs/v1-release-plan.md` | `doctor` fixtures cover local install/PATH/package-manager checks plus Product catalog/config/remote/auth/session/context/static-notice/agent-readiness checks and emit structured envelopes. | Diagnostic schema | Supportability depends on manual debugging, leaks secrets, drops undeclared env vars, or requires a SaaS backend. |
| V1-009 | Local catalog/discovery artifacts are versioned and drift-checked. | `docs/v1-release-plan.md` | Generate CLI, command manifest, surface manifest, MCP/agent discovery, and release metadata; mutate one artifact and assert targeted drift. | Generated catalog manifests | Hosted catalog assumptions hide stale local artifacts. |
| V1-010 | Install/update/channel UX works from static release metadata. | `docs/v1-release-plan.md` | Fixture `ops.release` metadata drives generated docs, discovery JSON, `release --json`, `doctor --json` release checks, version/update status, channel selection, yanked-version notices, and package-manager wrapper diagnostics. | Static Product release metadata | Generated CLIs need a hosted update service or a runtime `@lili/releases` dependency to explain install or channel state. |
| V1-011 | Public release metadata and support policy are explicit before publication. | `docs/public-release.md` | Offline metadata gate checks LICENSE/SECURITY/SUPPORT/CHANGELOG, package LICENSE files, narrow package file lists, no placeholder package metadata, and release scripts; live npm-name probe stays manual. | Public release metadata policy | Packages publish without license/support/security policy, with placeholder URLs, or with registry-name assumptions treated as ownership. |

### V1 public-readiness implementation trace

| ID | Status | Test file(s) |
|---|---|---|
| V1-005 | Implemented for local release-candidate metrics and gate wiring | `scripts/release-candidate-metrics.ts`, `packages/product/test/release-candidate-readiness.test.ts` |
| V1-011 | Implemented for offline metadata policy checks and live npm registry status probe | `scripts/release-metadata-check.ts`, `scripts/check-npm-package-availability.ts`, `packages/product/test/release-candidate-readiness.test.ts` |

## Docs coverage

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| DOCS-001 | `docs/` stays internal — never shipped as package or command. | `docs/invariant.md` | File presence and package exports check. | Repo tree | Docs shipped as package or command. |
| DOCS-003 | Reading order and log are maintained. | `docs/AGENTS.md` | Docs lint requires reading-order entry and log entry for docs page changes. | Repo tree | Docs pages drift without navigation/history. |
| DOCS-004 | Claims trace to requirement, upstream, or user instruction. | `docs/AGENTS.md` | Spot-check or docs lint for citations. | Docs rules | Unsupported claims become agent lore. |
