# V1 release plan

This plan defines the public-readiness work after the release renderer spine. It assumes the package architecture stays hard-cut: no legacy package shape, no `release-extra`, and no hosted service as a prerequisite for v1.

V1 is the self-contained toolchain. It should let a team define, generate, compile, package, publish, inspect, and operate an agent-ready CLI from local packages and standard registries. V2 is the hosted service and platform layer.

## Recommendation

V1 should publish the package suite, not a single generic end-user CLI.

The public product is:

```txt
@lili/core       runtime CLI framework
@lili/product    Product schema, generated surfaces, drift checks, conformance
@lili/build      Bun compile/provenance helpers
@lili/releases   manifest, renderers, publisher planning/execution, rollback planning
```

`li-product` and `li-build` are developer tool binaries that ship with their packages. They are not the v1 positioning by themselves. A later hosted product or website can dogfood these packages, but it must not block v1 package publication.

The v1 story should be:

```txt
define capabilities -> generate surfaces -> compile binary -> package/publish artifacts
```

The hosted/API idea is the V2 product track. It can become the best demo and commercial surface, but adding it before v1 would introduce auth, tenancy, billing, uptime, and external API compatibility concerns that are not needed to prove the packages.

## Success criteria

- Public README explains the product in one path: install packages, build a handwritten CLI, define a Product schema, generate a CLI/OpenAPI/docs surface, compile, release.
- Each publishable package has a package README, export map, `files` list, license metadata, and external-consumer smoke test.
- `examples/` exists and runs from the workspace root without relying on unpublished internals.
- LOC and package-boundary metrics have a baseline and are checked before v1 release candidates.
- Public docs are curated for users. Internal requirement docs remain traceability material and are not published wholesale.
- Release publishing has a dry-run path, receipt shape, provenance posture, and real npm/PyPI/Homebrew/Scoop publisher adapters from one manifest plus verified artifacts.
- Auth/session, diagnostics, telemetry contracts, install/update/channel UX, and catalog/discovery artifacts are available without a hosted service.
- No hosted service, website backend, OpenAPI importer, Vite plugin, framework adapter, or generated server implementation is required for v1.

## Current support areas

Before v1 can claim an agent-ready Product workflow, each local support area below must be implemented and verified. The only category intentionally excluded from v1 is the hosted service/platform layer: hosted dashboards, hosted telemetry ingestion, hosted policy sync, org/team administration, billing, and multi-tenant uptime commitments.

Public docs may mark a specific adapter or edge-case integration experimental, but they must not present an incomplete local capability as finished.

First, fix the auth default contradiction: omitting the `auth` field must normalize to no auth. `Auth.none()` remains an optional explicit declaration, not required boilerplate. A no-auth product must not emit auth runtime imports, generated auth commands, a fake `none` provider in release-facing metadata, or auth globals. A capability that declares `requires.auth` when the product has no provider remains an authoring error.

The agent-native release focus is now narrow. Declarative core and Product authoring are hard-cut, the core config primitive has landed, generated remote base URL wiring is implemented for declared literal/env/config sources, and `gen` is gone from core. The remaining agent-readiness work should optimize recovery and discovery instead of reopening the framework shape:

- Structured recovery errors now cover the core envelope, auth failures, remote HTTP transport failures, generated config-backed remote failures, and the `li-product` generate/compile/conform commands. Remaining work is to measure whether agents recover from those fields instead of prompting users with raw error text.
- MCP metadata parity has landed. Direct core `tools/list` includes declared command output schemas, and Product-generated MCP tools mirror the MCP-standard `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` fields from catalog effects/policy.
- Keep `mcp add` and `skills add` as opt-in core helpers only for narrow local registration/sync. `mcp add` owns the generic MCP executable/args config shape, including splitting command overrides and appending `--mcp` once. Broader provider workflows such as VS Code/Codex config formats, Claude Desktop app config, `.mcpb` bundles, URL skill installers, or vendor publishing should be adapter work unless a public-lane test proves core must widen.
- Use extension-lane tests to settle future boundary debates. If a feature can be implemented through `CommandContract`, `Catalog`, generated OpenAPI, lifecycle events, hooks, middleware, documented config, or release/build records without internals, it stays out of core.

| Area | V1 posture | Required work | Verification |
|---|---|---|---|
| Capability effects, policy, and examples | V1 blocker for agent/conformance claims. | Add `effects`, `policy`, and examples to Product authoring and normalized capabilities. They must distinguish read/write/delete/exec/auth-session effects, idempotence, dangerous behavior, confirmation requirements, and conformance eligibility. | Lints reject missing or inconsistent effects/policy; command manifest and conformance fixtures include effects, examples, and safety policy. |
| Remote transport and server conformance | V1 blocker for remote-backed Product examples. | Core `serializeHttpOperationRequest` and `callHttpOperation`, Product remote base URL declarations, and generated literal/env/config base URL wiring are implemented. Remaining work is fixture-backed conformance and report redaction checks. | Core serializer/transport tests and generated remote command tests pass now; local fixture-server conformance tests and report redaction checks must pass before V1. |
| Generated surface completion | V1 blocker for any surface named in public docs. | Catalog-derived command manifest, MCP command tools, Agent Skill/LLM surfaces, docs/reference markdown, and config JSON Schema are implemented. Remaining work is package-readiness proof for every advertised surface and consistent use of recovery metadata in generated failures. | `generate --check` tracks every emitted surface by id; stale CLI/OpenAPI/MCP/docs/agent/config artifacts fail with targeted drift. Generated MCP tools include agent-useful schemas and MCP hint annotations. |
| Sessions and OAuth device login | V1 blocker for authenticated remote-operation CLIs. | File sessions, profiles, context selection, generated `whoami`/`switch`/`login`/`logout`, OAuth device login without refresh tokens, identity probes, env-token CI/agent mode, and no implicit login for normal commands are implemented. Remaining work is package/readiness documentation and example proof. | Session/OAuth examples run in temp stores; normal, CI, agent, and MCP invocations never start interactive login implicitly; generated auth commands are catalog capabilities with auth effects. |
| Release publishing receipts and real adapters | V1 blocker for distribution automation. | Tighten publisher plan/preflight/execute around durable receipts, trusted-publishing/OIDC metadata, artifact hash recheck, npm platform-before-umbrella ordering, and real adapter cutlines for npm/PyPI/Homebrew/Scoop. | Publish dry-run and executor tests produce receipt records; live adapters are covered behind explicit selection/fake-registry tests where possible; tampered artifacts fail immediately before execution. |
| External-consumer readiness | V1 blocker. | Pack every package, install into a temp Bun project, import documented root/subpath exports, and run examples through package names rather than source-relative paths. | `examples:smoke`, temp-consumer import tests, package file-list checks, and public API snapshots pass. |
| Install/update/channel UX | V1 local capability. | Generate install docs, expose version/update metadata, support channel selection in release manifests, surface yanked-version notices from static metadata when available, and provide install/PATH/package-manager diagnostics. Do not require a hosted update service. | Generated CLIs and release docs expose accurate install/channel/update behavior; static metadata tests cover yanked and out-of-date cases without a hosted backend. |
| Telemetry and observability primitives | V1 local capability. | Define core lifecycle events, mutation hooks, opt-in telemetry events, redaction rules, sink interface, local/file/custom sink behavior, invocation labels (`cli`, `ci`, `agent`, `mcp`), and release-manifest disclosure. No hosted ingestion in v1. | Tests prove telemetry is off by default, redacts secrets/context values as specified, never changes command results, subscriber failures are swallowed, mutation hooks run at documented points, and events can be captured by a local sink in examples. |
| Diagnostics and supportability | V1 local capability. | Generate `doctor`/diagnostic checks for auth, env, sessions, install path, package-manager wrapper health, release metadata, update metadata, and agent-readiness assumptions. | Diagnostic fixtures produce structured envelopes, redact secrets, and distinguish blocking failures from warnings. |
| Catalog and discovery artifacts | V1 local capability. | Emit versioned local catalogs for capabilities, command manifest, generated surfaces, release metadata, and agent/MCP discovery. Hosted catalog search is V2. | Packaged examples and generated CLIs include machine-readable discovery artifacts; drift checks fail when any advertised artifact is stale. |

## Package publication plan

### Publishable packages

Publish all four first-party packages together once the external-consumer checks pass. Use synchronized versions for v1 unless a package is explicitly held back as experimental. Synchronized versions make examples, docs, and release troubleshooting simpler.

Current package-state gaps to close:

- Root workspace is private, which is correct, but `@lili/build`, `@lili/product`, and `@lili/releases` are still package-private.
- Package READMEs are missing.
- Package export maps point at TypeScript source. Decide deliberately whether v1 is Bun-only source publication or whether packages emit `dist` plus `.d.ts`; then test the exact published shape in a temp consumer.
- `files` lists need to include package READMEs and any generated type/build output required by the chosen package format.
- Public API snapshots exist for core; product, build, and releases need equivalent public-surface checks before v1.

Verification:

- `npm pack --dry-run` or equivalent pack inspection for every publishable package.
- Temp Bun consumer installs packed artifacts and imports documented entrypoints by package name.
- Package boundary tests prove `@lili/core` does not import product/build/releases, `@lili/releases` does not import core/product/build, and concrete renderers/publishers stay behind subpath exports.
- API snapshot tests cover every public root export and documented subpath export.

## CLI and V2 cutline

Do not invent one top-level `li` CLI as the v1 centerpiece unless it has a clear job that is not already owned by `li-product` or `li-build`.

For v1:

- `li-product` owns schema loading, generation, drift checks, and conformance.
- `li-build` owns compile/provenance helpers.
- Generated product CLIs own their own user-facing command names.
- `@lili/core` remains a library for handwritten CLIs.

A V2 hosted surface can expose schema management, hosted generation, API keys, docs hosting, release dashboards, artifact distribution, hosted telemetry ingestion, team administration, policy sync, and audit logs. That is a separate product, not the proof that the packages work.

Dogfood v1 through local examples and a real generated sample CLI. Dogfood the hosted service in V2 after the package workflow is already solid.

## Telemetry and hooks contract

Core should expose two extension lanes, not one generic analytics API.

Observe-only lifecycle events are the local observability foundation. A CLI declares subscribers with `defineCli({ events: [...] })`. Subscribers receive a redacted event snapshot and their return value is ignored. Subscriber failures must never change command output, exit status, result envelopes, or middleware behavior. This is the right lane for local debug logging, tests, UI wrappers, MCP wrappers, audit trails, and future telemetry sink adapters.

Mutation hooks are a separate behavior lane. A CLI declares hooks with `defineCli({ hooks: { beforeExecute } })`. Hooks receive the runtime context at documented points and may mutate the context or fail the command. The first V1 mutation hook is `beforeExecute`, which runs after command selection and argument/config/env validation but before middleware and the command handler. This is the right lane for auth/session enrichment, policy checks, request metadata, and future outbound transport preparation.

Middleware stays distinct from both lanes. A CLI declares middleware with `defineCli({ middleware: [...] })` for handwritten command composition. Middleware should not be used as the telemetry API because it sees parsed values and can intentionally alter command results.

V1 core lifecycle events are broader than telemetry. They are safe local lifecycle facts:

- `command.selected`
- `command.started`
- `command.completed`
- `command.failed`
- `validation.failed`
- `parse.failed`
- `command.not_found`
- `help.rendered`
- `version.rendered`
- `completion.generated`
- `schema.generated`
- `mcp.initialize`
- `mcp.tools_listed`
- `mcp.tool_call.started`
- `mcp.tool_call.completed`
- `mcp.tool_call.failed`
- `hook.failed`

Event payloads must be safe by construction. They may include CLI name/version, command id/path when a command has actually been resolved, invocation label, output mode, duration, exit code, coarse result classification, allowed completion shell, MCP method, tool count, and sanitized error codes/counts. They must not include raw argv, unresolved command tokens, positional values, option values, env names or values, config values, local file paths, request bodies, MCP argument payloads, prompt text, stack traces, or raw error objects.

Telemetry itself remains opt-in and narrower than the event stream. The default telemetry allowlist is `command.started`, `command.completed`, `command.failed`, and `validation.failed`. Future additions such as `command.not_found` must be explicit and must still omit raw input. A downstream CLI can attach a local sink subscriber such as memory/file/debug/custom, but core must run with no subscribers by default. Future hosted ingestion must be implemented as another subscriber or sink adapter, not as a mandatory core dependency.

### Telemetry config integration

Core now has a first-class opt-in config primitive for CLI authors: `Config.object(...)` declares a typed config contract, accepts JSON/JSONC/YAML/TOML files, exposes values through `ctx.config`, preserves provenance through `ctx.sources`, and feeds command options only through explicit `optionConfig` bindings. Runtime command execution keeps argv above option env and config, while auth/session state remains outside the durable config ladder.

Telemetry should use a reserved framework namespace in that same loaded config object, not command options:

```yaml
lili:
  telemetry:
    enabled: false
    mode: off # off | local | debug
    file: ./.lili/telemetry.ndjson

commands:
  deploy:
    options:
      region: iad
```

The reserved namespace is `lili.telemetry`, not top-level `telemetry`, so generated CLIs and handwritten CLIs can still use arbitrary product keys without colliding with framework controls. The v1 resolver should treat config as one input to the control decision, not as proof that telemetry may run. Telemetry is active only when the CLI author has enabled telemetry support and the user/operator has opted in.

Recommended precedence:

1. `DO_NOT_TRACK=1`, `--telemetry=off`, or `--no-config` disabling a config-only opt-in
2. `--telemetry=debug`
3. explicit CLI-specific env var such as `ACME_TELEMETRY=1|0|debug`, configured by the CLI author or generated from the Product id
4. `LILI_TELEMETRY=1|0|debug` for framework-level local development
5. loaded config at `lili.telemetry`
6. author default, which must remain off unless both the framework feature and user/operator opt-in are present

Config is loaded after global parsing, command selection, help/version/completion/schema handling, and not-found help. That is acceptable because the telemetry allowlist is command/validation only. Do not force config loading just to decide whether help, version, completion, schema, or command-not-found local events should export; those events are local-only by default.

Product-generated config schema now includes declared Product config and bindings. Before telemetry config is documented publicly, the schema must either include explicitly reserved framework namespaces such as `lili.telemetry`, or the telemetry namespace must stay outside the generated app config schema. Unknown product keys still fail under strict declared schemas.

## README and docs plan

The root README should become a public starting point, not a planning index. It should contain:

- what lili is
- when to use handwritten core vs Product schema
- install commands
- a small handwritten CLI example
- a small Product schema example
- generated artifacts overview
- compile/release overview
- links to package READMEs and examples
- explicit Bun-only support statement if source-published Bun packages remain the contract

Package READMEs should be narrow:

| Package | README job |
|---|---|
| `@lili/core` | Build a handwritten CLI and use runtime primitives. |
| `@lili/product` | Define a Product schema, generate surfaces, run drift/conformance checks. |
| `@lili/build` | Compile a generated or handwritten CLI and record provenance. |
| `@lili/releases` | Package and publish final artifacts from one manifest. |

The current `docs/` tree is internal requirement material. It should not be published as-is. For v1, create a curated public docs surface from the README, package READMEs, examples, and generated reference docs. Keep internal requirement docs available in the repo for traceability, but do not make users read implementation history.

Verification:

- A new-user doc smoke follows README steps in a temp directory.
- Every README code block that claims to run has a checked example or test fixture.
- Internal-only docs are not included in package `files` lists or website build inputs unless explicitly curated.

## Examples plan

`examples/` should prove package boundaries and become the main dogfood path.

Recommended examples:

| Example | Purpose | Packages used |
|---|---|---|
| `examples/handwritten-cli` | Minimal handwritten CLI with JSON output and help. | `@lili/core` |
| `examples/product-generated-cli` | Product schema generates CLI, command manifest, OpenAPI, docs, and agent surfaces. | `@lili/product`, `@lili/core` |
| `examples/remote-backed-cli` | HTTP-backed capability uses core transport and conformance against a local server. | `@lili/product`, `@lili/core` |
| `examples/auth-session-cli` | Env auth, file session/profile state, OAuth device login in a fake auth server, context switching, and no implicit login. | `@lili/product`, `@lili/core` |
| `examples/diagnostics-telemetry-cli` | Generated diagnostics plus opt-in local telemetry sink and redaction behavior. | `@lili/product`, `@lili/core` |
| `examples/compiled-release` | Compile a CLI, write a manifest, render npm/PyPI/Homebrew/Scoop artifacts, run publish dry-run. | all four packages |
| `examples/web-app-capabilities` | Optional later example showing a web app exposing capabilities without a framework adapter. | `@lili/product`, app-local server |

Do not start with a large hosted demo. The first examples should be small enough that failures identify package defects instead of app complexity.

Verification:

- `bun run examples:smoke` runs every v1 example.
- Each example installs through workspace package names, not source-relative internals.
- The release example proves one manifest can feed all implemented renderers and publisher dry-run planning.
- Auth/session and telemetry examples use temp stores and local sinks only.

## Simplification and metrics

Simplification should be measured by package, not as a vague cleanup pass.

Initial measured baseline from this checkout:

| Package | Source LOC | Source files | Test LOC | Test files |
|---|---:|---:|---:|---:|
| `@lili/core` | 2761 | 46 | 4121 | 24 |
| `@lili/build` | 294 | 4 | 197 | 2 |
| `@lili/product` | 2898 | 17 | 3539 | 18 |
| `@lili/releases` | 3024 | 20 | 2870 | 11 |
| Total | 8977 | 87 | 10727 | 55 |

LOC is a pressure gauge, not a product goal. A package should shrink when simplification removes concepts, but a package can grow if it replaces hidden behavior with public guard rails. Track:

- source LOC by package
- test LOC by package
- public root exports and subpath exports
- runtime dependency count by package
- number of package-boundary exceptions
- number of generated fixtures and example smokes

Simplification targets before v1:

- Keep `@lili/build` narrow. It should remain compile/provenance only.
- Keep `@lili/releases` manifest/data-driven. Publishing must consume verified artifact records, not workspace state.
- Remove duplicate schema/manifest primitives where package-local helpers can make the code clearer.
- Prefer examples over new abstractions when the problem is unclear.
- Do not add compatibility shims for old names or old package layout.

Verification:

- Add a repeatable LOC/exports/dependency metrics command before the first v1 release candidate.
- Record the baseline and delta in release-candidate notes.
- Any package with source LOC growth above a release-candidate threshold must name the requirement it implements.

## Missing work

The current plan also needs these v1 gates:

- Auth default hard cut: omitted `auth` equals no auth, and explicit `Auth.none()` is only authoring clarity.
- Capability effects/policy/examples implemented before agent-ready or conformance claims.
- Core remote HTTP transport and generated remote wiring implemented before remote-backed examples.
- Catalog-derived MCP, Agent Skill/LLM, docs/reference, command manifest, and config schema surfaces completed or removed from public copy.
- Session/OAuth completion: file sessions, profiles, generated auth commands, OAuth device login, identity probes, context switching, and no implicit login.
- Publisher receipt/provenance completion: dry-run, receipt shape, credential preflight, provenance metadata, and real npm/PyPI/Homebrew/Scoop adapters from one manifest.
- Install/update/channel completion: generated install docs, version/update metadata, channel selection, static yanked-version notices, and install diagnostics without hosted infrastructure.
- Telemetry primitives: opt-in event taxonomy, redaction policy, local/custom sink interface, invocation labels, and release-manifest disclosure.
- Diagnostics: generated `doctor` checks for env, auth, sessions, install path, package-manager wrappers, release metadata, update metadata, and agent-readiness assumptions.
- Catalog/discovery artifacts: versioned local capability catalog, command manifest, surface manifest, release metadata, and agent/MCP discovery records.
- Package name and namespace availability check before final npm naming.
- License, repository, homepage, funding, and provenance metadata.
- Changelog and semver policy.
- Release candidate workflow: pack, temp-consumer smoke, example smoke, publish dry-run, provenance check.
- Trusted publishing or explicit token fallback for npm/PyPI.
- GitHub release artifact layout and checksums.
- Security posture: no secrets in manifests, docs, examples, logs, generated surfaces, or package artifacts.
- API stability policy for experimental surfaces and subpaths.
- Support matrix: Bun versions, OS targets, binary targets, and whether Node is explicitly unsupported.
- Public docs hosting decision: static site, README-only for v1, or generated reference docs plus examples.
- V2 cutline: hosted telemetry ingestion, release dashboard, hosted catalog, org/team admin, audit logs, billing, policy sync, and uptime commitments are not v1 gates.

## Phase order

### Phase 8A: contract closure

Close the Product contract gaps that would otherwise make the public story overclaim.

Verification:

- omitted `auth` normalizes to no auth and matches explicit `Auth.none()` behavior where relevant
- no-auth products emit no auth runtime imports, auth globals, generated auth commands, or fake release-facing auth provider
- capabilities carry effects, policy, examples, requirements, execution mode, input/output shapes, and surface membership
- lints reject unsupported agent/conformance exposure before generation
- command manifest includes effects, execution mode, examples, auth requirements, and output envelope shape

Current status: the omitted-auth default and explicit capability `effects`/`policy`/`examples` authoring path are implemented for generated Product catalogs. Command manifests and MCP tool annotations expose the metadata, and lints now fail agent/OpenAPI-visible capabilities that omit it or declare inconsistent dangerous/delete policy. Remaining Phase 8A follow-up is to broaden fixtures/docs around conformance eligibility as the server conformance runner consumes this metadata.

### Phase 8B: remote and generated surfaces closure

Finish the generated Product surfaces that public docs name.

Verification:

- generated remote commands call core transport and validate untrusted HTTP output
- auth-aware 401/403 mapping follows `docs/auth-session.md` and `docs/http-operation-transport.md`
- `li-product conform` runs against an owned fixture server and stays separate from `generate --check`
- generated MCP command tools, Agent Skill/LLM surfaces, docs/reference markdown, command manifest, and config schema have manifest records and drift checks

### Phase 8C: auth and session closure

Finish authenticated remote-operation support as a local runtime feature, not a hosted dependency.

Verification:

- file session store uses temp-store tests, permissions checks, locking, corrupt-file quarantine, and no refresh-token storage
- generated `whoami`, `switch`, `login`, and `logout` are catalog capabilities with local-only effects and correct agent visibility
- OAuth device login works against a fake auth server and fails noninteractive invocations before opening a browser or prompting
- env-token, session-token, profile, and context resolution follow `docs/auth-session.md`
- normal, CI, agent, and MCP invocations never trigger implicit login

### Phase 8D: local operations support

Add the V1 supportability layer around generated CLIs without introducing a service.

Verification:

- generated `doctor` checks auth/env/session/install/release/update/agent-readiness assumptions and emits structured envelopes
- telemetry is opt-in, locally sinkable, invocation-aware, and redacted by construction
- catalog/discovery artifacts are versioned, packaged, and tracked by drift checks
- install/update/channel metadata supports static yanked-version and out-of-date notices without hosted infrastructure

### Phase 8E: release publish closure

Finish the v1 publish contract without requiring a hosted lili control plane.

Current status: `li-release publish --no-dry-run` now has explicit executors for npm, PyPI token upload, Homebrew, and Scoop. Execution re-reads artifact bytes and checks size/sha256 before every executor call. Successful executor receipts record stable step order, package id, ecosystem, artifact path/name/hash/size, credential posture without secrets, and executor provenance metadata. npm delegates to `npm publish` and requests npm provenance when running under GitHub Actions. PyPI token publishing delegates to `python -m twine upload`; PyPI trusted-publisher/OIDC credentials are represented in preflight/execute metadata but intentionally fail before mutation until they are run through the official trusted-publisher workflow path.

Verification:

- publish plan/preflight/execute dry-run produces durable receipts from one manifest plus verified artifacts
- receipt records artifact hashes, publisher, step ordering, credential posture, and provenance/attestation metadata when configured
- npm/PyPI trusted-publishing/OIDC paths are represented without treating attestations as a substitute for sha256 checks; PyPI OIDC remains an official-workflow handoff rather than a local upload-client token exchange
- live npm/PyPI/Homebrew/Scoop mutation adapters are implemented behind explicit executors and tested with injected command runners where direct registry mutation is unsafe
- install/update/channel metadata from the release manifest is consumed by generated docs and diagnostics

### Phase 8F: public package readiness

Make every intended package externally consumable.

Verification:

- pack every package
- install packed packages into a temp Bun project
- import documented root and subpath exports
- run public API snapshot tests

### Phase 8G: examples and dogfood

Create the small examples first, then the all-packages release example.

Verification:

- one command runs all example smokes
- examples use package names, not source-relative paths
- examples cover handwritten, generated, remote/conformance, auth/session, diagnostics/telemetry, compile, and release paths

### Phase 8H: public docs pass

Rewrite README and package READMEs around the v1 workflow. Curate public docs separately from internal requirements.

Verification:

- README quickstart works in a temp project
- package READMEs link to examples
- package files do not ship internal requirement docs

### Phase 8I: simplification pass

Refactor only where metrics, examples, or package-readiness checks expose real complexity.

Verification:

- metrics baseline recorded
- boundary tests pass
- package and workspace checks pass

### Phase 8J: release candidate

Run the full local release-candidate loop without mutating public registries.

Verification:

- clean git state except intended release files
- all tests and typechecks pass
- package packs inspected
- temp consumer passes
- examples smoke passes
- release renderers produce verified artifacts
- publisher plan/preflight/execute dry-run passes
- V2 service tasks are absent from the release-candidate checklist
