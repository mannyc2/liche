# Build system requirements

## Type generation placement

Core no longer ships a `gen` runtime helper. The old `li gen` path only emitted TypeScript module augmentation from command metadata, was not committed as source, and had no runtime or agent-facing consumer outside tests and the handwritten example. If this capability returns, it belongs in a build-time package or extension with an explicit consumer, not in `@liche/core`.

`@liche/build` is an opt-in package for reusable Bun build/compile behavior. It owns the programmatic `Bun.build()` wrapper, compile flag profile, build-time constants, compile entrypoint rendering, and path-independent `compileFlagsDigest`.

This is a deliberately narrow boundary, not a major product abstraction. Its value is only shared compile/provenance behavior for generated and handwritten CLI entrypoints. If that shared use case disappears, the code can be folded into `@liche/product` or `@liche/releases` without changing the release manifest contract.

`@liche/product` is the opt-in package for Product schema generation. It consumes a runtime product schema module, normalizes it into a canonical capability catalog, generates artifacts, checks drift, runs server conformance, and delegates standalone executable compilation to `@liche/build`.

Neither package replaces `@liche/core`. Generated code must plug into core through public runtime APIs.

Detailed requirements live in:

- `docs/http-operation-transport.md`
- `docs/schema-ir-openapi.md`
- `docs/server-conformance.md`

## Purpose

The Product system exists so a user can define an owned product capability catalog once and get:

- generated CLI command tree
- generated dispatcher
- generated outbound remote HTTP wiring
- generated local implementation wiring
- generated OpenAPI for HTTP resource operations
- generated MCP tools
- generated docs/reference markdown
- generated Agent Skill/LLM surfaces
- generated JSON Schema for general config and bindings, when configured
- deterministic drift checks
- server conformance checks against owned HTTP deployments

The build system exists so a user with any CLI entrypoint can get:

- Bun standalone binary compilation
- deterministic compile flag profiles
- build-time constants for release version, contract digest, source commit, and build-tool version
- path-independent compile provenance for release manifests

Handwritten CLIs remain valid without installing `@liche/build`.

Handwritten CLIs that only want a standalone binary can use `@liche/build` without installing `@liche/product`.

The product schema is authoritative for owned product capabilities. `@liche/product` does not generate server routes in MVP, but it does generate the catalog and conformance checks that a hand-written server must satisfy.

The `liche-build` developer CLI is intentionally small: it exposes compile-entry behavior over the generic compile spine. The `liche-product` developer CLI opts into core helper built-ins for completions, skills, and MCP. Its `skills add` command installs authored product-package guidance through `DefineCliOptions.skill`. Generated product CLIs do not automatically enable `skills` or `mcp`; their agent skill and MCP surfaces must come from the canonical catalog when the product schema opts into those generated surfaces.

## Generated surface graph

The build system must model generated outputs as synchronized surfaces over one source graph.

Required surface record:

```ts
type GeneratedSurfaceRecord = {
  id: string;
  source: "catalog" | "openapi";
  owner: "@liche/product" | "@liche/build" | "@liche/releases" | "adapter";
  generatorVersion: string;
  generationOptionsDigest: string;
  inputDigest: string;
  outputDigest: string;
  artifacts: string[];
};
```

`artifacts` are relative artifact paths. Absolute local paths are internal build-record data and must not affect canonical schema digests.

Initial catalog-derived surfaces:

| Surface | Source | MVP status |
|---|---|---|
| CLI command tree | catalog | required |
| dispatcher and local/remote/hybrid wiring | catalog | required |
| command manifest / `schema --json` | catalog | required |
| OpenAPI projection | catalog | required for HTTP resource operations in Phase 3C |
| MCP command tools | catalog | required |
| Agent Skill/LLM surfaces | catalog | required |
| docs/reference markdown | catalog | required |
| JSON Schema for config and bindings | catalog | required when general config or bindings are declared |

OpenAPI-derived downstream surfaces are not the first implementation slice, but the graph must leave a clean path for them:

| Surface | Source | Status |
|---|---|---|
| TypeScript SDK | OpenAPI | later adapter |
| Go SDK | OpenAPI | later adapter |
| Python SDK | OpenAPI | later adapter |
| Terraform provider | OpenAPI plus provider-specific metadata | later adapter |
| Code Mode MCP server | OpenAPI | later adapter |

Product-specific surfaces are also later adapters:

| Surface | Source | Requirement before implementation |
|---|---|---|
| Workers Binding RPC metadata | catalog plus platform adapter requirement | Binding semantics, auth, deployment, and runtime compatibility must be documented. |
| `wrangler.jsonc` fragments or schema | catalog plus config metadata | Config keys, defaults, env precedence, and ownership must be documented in `docs/config-primitive.md` plus an adapter requirement. |
| Dashboard metadata | catalog plus product metadata | UI labels, lifecycle, permissions, safety, and audit behavior must be documented. |
| Developer docs beyond reference markdown | catalog plus docs metadata | Narrative ownership, examples, and publication target must be documented. |
| Product API implementation/stubs | catalog plus server adapter requirement | Generated server code is not MVP; conformance remains the first proof that an owned API implements the schema. |

Each generated surface must have a drift check. A stale generated CLI, stale OpenAPI document, stale Agent Skill, or stale config schema is the same class of failure: the generated surface no longer matches the canonical source graph.

Do not infer a broad generator framework from this requirement. The first vertical slice still proves one generated command through core APIs before adding broad surface coverage.

## Public product schema API

The Product API is runtime-value first. TypeScript inference is derived from runtime schema values and field helpers; erased TypeScript types are not generator input.

The public authoring model is product-shaped, not CLI-program-shaped. `defineProduct({ resources, commands, bindings })` is the source API. Generated CLIs lower into `@liche/core` through declarative `defineCli()` / `defineCommand()` command graphs.

The concrete product schema API, naming, defaults, and refactor path live in `docs/product-schema.md`.

Required public classes:

```txt
Product
Resource
Command
Shape
Field
```

The class API is authoring sugar only. `liche-product` loads a product schema module, checks its runtime tag, and normalizes it into a deterministic plain-data catalog before linting, digesting, or generating artifacts.

## Canonical catalog

The normalized catalog must include at least:

```ts
type ProductSchema = {
  id: string;
  name: string;
  version: string;
  description: string;
  scope?: ProductScope;
  config?: ProductConfig;
  authProviders: AuthProviderCatalog[];
  permissions: PermissionCatalog[];
  contexts: ContextCatalog[];
  resources: Resource[];
  commands: Command[];
  bindings: Binding[];
  capabilities: Capability[];
};

type Capability =
  | ResourceCapability
  | CommandCapability;

type ResourceCapability = {
  kind: "resource-operation";
  id: string;
  resourceId: string;
  action: string;
  summary: string;
  input: ShapeProjection;
  output: ShapeProjection;
  http?: HttpSpec;
  requirements: CapabilityRequirements;
  effects: CapabilityEffects;
  surfaces: NormalizedSurfaces;
};

type CommandCapability = {
  kind: "command";
  id: string;
  family: "workflow" | "auth" | "setup" | "diagnostic" | "dev";
  summary: string;
  input: ShapeProjection;
  output: ShapeProjection;
  execution: Execution;
  requirements: CapabilityRequirements;
  effects: CapabilityEffects;
  surfaces: NormalizedSurfaces;
};

type ShapeProjection = {
  jsonSchema: unknown;
  fields: FieldProjection[];
  portability: {
    openapi: boolean;
    mcp: boolean;
    docs: boolean;
    reasons: string[];
  };
};
```

Auth provider, permission, context, and capability requirement shapes are defined in `docs/auth-session.md` and `docs/schema-ir-openapi.md`. They are part of the catalog digest, but runtime session state and selected context values are not.

The non-negotiables are:

```txt
closed vocabulary
execution mode as a first-class field
one input and one output contract per capability
effects as a first-class field
field metadata as a first-class field
surface membership as normalized data
```

`effects.kind` is the user-facing safety and lint axis. It must be one of:

```txt
read
write
delete
exec
auth-session-read
auth-session-write
auth-session-delete
auth-context-write
```

Effects do not imply a resource model. `project delete` and `db migrate` can both be dangerous capabilities, but only one is naturally CRUD-shaped. Auth/session effects are local credential or context effects, not product data writes. The linter should reason over the capability contract, not force commands through resource inheritance.

## Agent consistency guardrails

The current core is intentionally permissive for handwritten CLIs. That is not sufficient for schema-driven CLIs aimed at agents.

The rewrite must close these audit gaps:

- resource actions and generated CLI control flags must be checked against the product vocabulary
- command input fields are data shape fields, not vocabulary entries
- `--format` is currently a global runtime option; generated product CLIs must make `--json` the canonical machine-output switch and must not advertise `--format` as the agent contract
- built-in and generated helper commands must honor `--json` consistently; text such as `wrote ./liche.generated.ts` is not acceptable when JSON was explicitly requested
- generated JSON output for local, remote HTTP, or hybrid workflow capabilities must identify the execution mode that was applied
- generated OpenAPI must come from HTTP-capable catalog entries and field metadata, not from the current runtime reflection shortcut that emits every command as a `POST`

Default generated vocabulary:

```txt
allowed verbs:
  get
  list
  create
  update
  delete
  run

allowed flags:
  --json
  --local
  --remote
  --force
```

`vocabulary({...})` is a convenience for extending the default vocabulary. A product schema that wants to replace the defaults can pass an explicit `Vocabulary` object instead. The linter treats vocabulary as an allowlist only: if a resource action or generated control flag is present in the active vocabulary, it is allowed; if it is absent, it fails. There is no separate forbidden-word list.

`vocabulary.aliases` is command-surface metadata, not an extra allowlist. Alias targets must still resolve to names present in the active vocabulary when they are used by a generated surface.

`--force` is the standard destructive-action bypass flag in the default vocabulary. A product can choose a different control-flag vocabulary by not using the defaults, but generated surfaces must still use only flags present in the active vocabulary.

For current core compatibility, handwritten CLIs may continue to use richer formatting and arbitrary command names. That compatibility layer must not be treated as proof that product-schema generated surfaces satisfy the closed-vocabulary requirement.

## Remote transport ownership

Outbound HTTP operation transport is core runtime behavior.

`@liche/core` exports documented `serializeHttpOperationRequest` and `callHttpOperation` primitives that can be used by handwritten CLIs and generated CLIs. `@liche/product` generates wiring that calls those primitives when a Product declares `remote.baseUrl` through a literal, env var, or config field. That contract is the first-class config primitive in `docs/config-primitive.md`; HTTP-backed capabilities without a product remote base URL fail linting and generation.

The primitive must own:

- resolving contract-level runtime config such as base URL, while keeping auth/session resolution on the auth/session path
- serializing input into path, query, and body according to the HTTP binding
- making the HTTP request
- parsing the HTTP response
- validating successful response data through the capability output schema
- mapping network failures, timeouts, non-2xx responses, malformed bodies, and output validation failures into the standard core error envelope

The primitive must not throw raw transport errors through generated command handlers.

Required error classes or codes:

| Case | Required behavior |
|---|---|
| missing base URL config | structured configuration error before request |
| missing auth config | structured configuration error before request |
| network failure | structured remote transport error with retryable metadata when appropriate |
| timeout | structured timeout error with retryable metadata |
| non-2xx response | structured remote HTTP error with status and safe body summary |
| malformed success body | structured malformed response error |
| output schema failure | structured validation error that identifies response shape mismatch |

## Execution semantics

Execution mode is a runtime behavior, not only docs metadata.

```txt
remote-http:
  generated run() calls @liche/core outbound HTTP operation transport

local:
  generated run() imports or resolves the configured handler and executes local process/tool behavior

hybrid-workflow:
  generated run() calls the configured handler; the handler may perform local work and make API calls
```

The product schema declares a capability's execution mode. Generated CLI flags may select explicit local or remote behavior only for capabilities that actually support both forms. A `local` command such as `dev` must not be made OpenAPI-visible by accident. A `hybrid-workflow` command such as `deploy` must not be flattened into a fake resource mutation.

Machine-readable output must identify what happened. For `--json`, generated capabilities must use the standard envelope and include at least:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "execution": {
      "mode": "remote-http",
      "source": "schema-default"
    }
  }
}
```

`source` is one of `flag`, `config`, or `schema-default`. Human output should also include a concise execution signal for capabilities where confusion is possible, especially hybrid workflows.

`capability/execution-shape` is a correctness gate:

- every executable capability has one input schema and one output schema
- alternate execution paths for one capability share that same input/output contract
- downstream surfaces assume those contracts are identical

A capability with both local and remote behavior must have a runtime conformance test against a fixture backend that proves both implementations produce identical parsed output for the same valid input.

This guarantee has two layers:

```txt
local conformance:
  the generated local path resolves owned handler code and validates its return value with the output schema

remote conformance:
  a server outside the CLI process is checked against the catalog, HTTP binding, and output schema
```

The linter can prove schema shape. Only server conformance can prove that a hand-written remote server actually implements the contract.

## Generated-code seam

Generated command code must be plain TypeScript that imports `@liche/core` and declares commands through the public `defineCli()` / `defineCommand()` API.

Representative generated file:

```ts
// generated by @liche/product
// schema: ./liche.schema.ts
// contractDigest: sha256:<catalog-digest>
// generatorVersion: <version>
// do not edit by hand

import { callHttpOperation, defineCli, defineCommand, z } from "@liche/core";

export const cli = defineCli({
  name: "workers",
  version: "1.0.0",
  commands: [
    defineCommand({
      path: ["workers", "script", "list"],
      summary: "List Worker scripts",
      input: {
        options: z.object({}),
      },
      output: z.object({
        scripts: z.array(z.object({
          id: z.string(),
          name: z.string(),
        })),
      }),
      safety: {
        auth: "required",
        destructive: false,
        idempotent: true,
        interactive: "never",
        openWorld: true,
        readOnly: true,
      },
      async run({ ctx }) {
        const data = await callHttpOperation({
          id: "workers.script.list",
          baseUrl: { envVar: "WORKERS_API_URL" },
          auth: { kind: "bearer", envVar: "WORKERS_TOKEN" },
          method: "GET",
          path: "/workers/scripts",
          bind: { body: false },
          input: ctx.options,
          inputFields: [],
          output: z.object({
            scripts: z.array(z.object({
              id: z.string(),
              name: z.string(),
            })),
          }),
          env: ctx.env,
        });
        return ctx.ok(data, { execution: { mode: "remote-http", source: "schema-default" } });
      },
    }),
  ],
});
```

The exact generated body may include product-specific constants and auth/context preambles, but the seam is fixed: generated code wires schema metadata into core; core performs runtime behavior.

## Local implementation imports

The schema module must be safe to import for linting, docs generation, and code generation.

Rules:

- command and capability handlers are string references such as `wrangler.deploy` or module/export references relative to the schema file
- the schema module must not eagerly import local implementation modules
- implementation modules are imported only by generated runtime code when local or hybrid execution is selected
- the build system must lint that the target module exists and the export exists when a module/export handler is declared
- generated code must fail with a structured error when a local implementation cannot be loaded

Required lint:

```txt
schema/no-eager-local-import
  Fails when the schema module imports a file referenced by a local or hybrid handler.
```

## HTTP binding

`http.method` and `http.path` are not sufficient alone. The build system must know where input fields go.

MVP mapping:

```txt
bind.path:
  input fields substituted into route path segments

bind.query:
  input fields serialized into URLSearchParams

bind.headers:
  maps HTTP header names to input field names

bind.body:
  true means remaining input object becomes JSON body
  string[] means selected fields become JSON body
```

Unmapped input fields must fail lint unless an explicit default mapping is documented for the method.

Recommended default:

- `GET` and `DELETE`: unmapped fields are not allowed
- `POST`, `PUT`, `PATCH`: unmapped fields default to body only if `body: true` is set

Required lint:

```txt
remote/bind-coverage
  Fails when a non-defaulted input field is not bound to path, query, header, or body.
  Fails when a binding references a field that does not exist in the input schema.
  Fails when one input field is bound to conflicting locations unless explicitly allowed.
```

OpenAPI generation must consume `bind`. Path, query, and header fields become parameters; body fields become request body schema. Field metadata becomes descriptions and `x-liche-*` extensions.

Conformance must also consume `bind`. A bind bug is not visible in local mode because local mode does not serialize HTTP requests.

## Server conformance

Server conformance is a named MVP capability owned by `@liche/product`.

It verifies that an owned external HTTP deployment implements the HTTP-backed schema capabilities. It is separate from generated-file drift checks.

The detailed command contract, fixture shape, report schema, and safety rules live in `docs/server-conformance.md`.

```txt
generate --check:
  hermetic artifact freshness check
  compares generated files to canonical catalog output

conform:
  server-vs-schema check
  sends capability example requests to a live or fixture server
  validates responses against output schemas
```

Proposed CLI:

```sh
liche-product conform ./liche.schema.ts --base-url http://localhost:5173
liche-product conform ./liche.schema.ts --env staging
liche-product conform ./liche.schema.ts --report .liche/conformance.json
```

Conformance must assert:

- capability examples parse from `argv` to declared input
- input serializes into HTTP request according to HTTP binding metadata
- configured base URL and auth are applied
- server accepts the request shape
- successful response body parses as JSON when JSON is expected
- successful response data validates against the capability output schema
- non-2xx, malformed, and schema-invalid responses are reported as structured conformance failures

Conformance should use declared examples or explicit conformance fixtures. It must not invent unsafe mutating requests against production.

Policy:

| Capability policy | Default conformance behavior |
|---|---|
| idempotent/read-only | May run against configured target when examples exist. |
| destructive | Requires explicit conformance fixture and opt-in target. |
| requires confirmation | Requires explicit conformance fixture and opt-in target. |
| no examples or fixture | Report skipped with reason; do not silently pass. |

`@liche/releases` may require or attach a conformance report before publishing, but `@liche/product` owns the conformance logic because it is schema-contract verification.

## Generated surfaces

`@liche/product` generates:

```txt
generated CLI command tree
generated dispatcher
generated command manifest / schema --json
generated OpenAPI for HTTP resource operations
generated MCP tools
generated docs/reference markdown
generated Agent Skills / llms surface
generated JSON Schema for config and bindings, when configured
generated surface manifest
```

OpenAPI is an output, not an input. In Phase 3C it is emitted only for `resource-operation` capabilities with HTTP bindings and normalized `surfaces.openapi === true`.

Local-only, interactive, `remote-http`, and hybrid workflow commands remain valid catalog capabilities even when no OpenAPI route is emitted.

The generated surface manifest records every emitted surface record from the generated surface graph. It is a build artifact for drift checks and release provenance; it is not the release manifest owned by `@liche/releases`.

## Command manifest

Schema-driven product CLIs must expose a compact command manifest surface for agents and automation. It is separate from OpenAPI because it includes command-local concepts such as argv shape, local-only commands, hybrid workflows, effects, execution mode, examples, and output envelopes.

Required minimum fields per command:

```ts
type GeneratedCommandManifestEntry = {
  id: string;
  argv: string;
  summary: string;
  description?: string;
  inputSchema: unknown;
  outputSchema: unknown;
  effects: {
    kind: "read" | "write" | "delete" | "exec";
    idempotent: boolean;
    dangerous: boolean;
  };
  execution: {
    mode: "remote-http" | "local" | "hybrid-workflow";
  };
  examples: string[];
};
```

The build package may expose this as generated JSON, a built-in generated command such as `schema --json`, or both. In all cases, the manifest is catalog-derived and must be covered by generated-surface drift checks.

## Mutation testing

`@liche/product` must have package-local mutation testing wired the same way as `@liche/core`: a `mutate` script that runs Stryker through the Bun runner, a package-local `stryker.conf.mjs`, TypeScript checking enabled, and the root workspace catalog dependencies reused instead of adding one-off versions. `@liche/build` keeps its own focused mutation scope for generic compile primitives.

The initial mutation scope should target implementation modules where surviving mutants expose real generator or catalog risk:

```txt
packages/product/src/catalog.ts
packages/product/src/command.ts
packages/product/src/digest.ts
packages/product/src/field.ts
packages/product/src/generate.ts
packages/product/src/generate-cli.ts
packages/product/src/generate-openapi.ts
packages/product/src/lints.ts
packages/product/src/manifest.ts
packages/product/src/product.ts
packages/product/src/shape.ts
packages/product/src/vocabulary.ts
```

Exclude public barrels, the `liche-product` CLI wrapper, packaged skill text, generated fixtures, and tests from mutation input. The first threshold should match core (`high: 90`, `low: 85`, `break: 80`) unless a measured baseline proves that too strict for the first landed config.

The goal is not to chase 100% mutation score in the first slice. The goal is to make build-package regressions visible in the same local workflow as core and to turn meaningful surviving mutants into focused tests.

## Vite sanity check only

The framework must not know Vite exists.

A developer who already has backend capabilities should be able to expose those capabilities through the existing generic core runtime and get a generated CLI with good execution-mode ergonomics.

If the design requires any of the following, the design failed:

- Vite package
- Vite plugin
- Vite adapter
- virtual browser module
- browser client generator
- contract/server file split
- Vite-specific lint rule

If the same generated command wiring and core HTTP operation transport work for a Vite app, a Bun server, a serverless function, or a handwritten HTTP backend, the design passed.

## Core reflection overlap

Core already has runtime reflection surfaces for handwritten CLIs:

- command schema
- runtime manifest-style command listing
- MCP tools
- skill markdown/index

Schema-generated artifacts are canonical for product-schema generated CLIs. The generated CLI may still register enough metadata for core reflection to work, but weaker runtime reflection must not override or silently conflict with catalog-generated OpenAPI, MCP, docs, or Agent Skill output.

Required decision:

```txt
handwritten CLI:
  core reflection is canonical

schema-driven generated CLI:
  canonical catalog outputs are canonical
  core reflection is compatibility only
```

## Schema lints

Schema lints are CI gates, not style suggestions.

| Rule | Fails when |
|---|---|
| `vocabulary/verb` | Resource action or generated control flag uses a name outside the allowed vocabulary. |
| `vocabulary/flag` | A generated control flag or override introduces an unapproved flag. |
| `capability/output-required` | Public capability has no output schema when the selected surfaces require one. |
| `capability/execution-required` | Command does not declare `remote-http`, `local`, or `hybrid-workflow` execution. |
| `capability/execution-binding` | Command declares an execution mode without the corresponding handler or HTTP binding. |
| `capability/execution-shape` | Alternate execution paths do not share one input/output contract. |
| `capability/effects-required` | Capability does not declare `effects.kind`, idempotence, and danger level when defaults cannot infer them. |
| `capability/effects-policy-consistent` | Effects and execution/conformance policy disagree, such as a dangerous delete treated as non-destructive. |
| `capability/id-stable` | Capability ID is missing, duplicated, or unstable. |
| `auth/provider-required` | A capability requires auth but the catalog has no matching provider. |
| `auth/context-required` | A capability requires an unknown context or a context has no flag/env selector. |
| `auth/permission-required` | A capability requires an unknown product permission. |
| `auth/agent-safe` | An agent-visible capability has auth/context/permission requirements that cannot be explained without secrets or interaction. |
| `catalog/remote-base-url` | Catalog-level remote config exists without a base URL literal, env var, or declared config field source. |
| `capability/http-binding-complete` | HTTP-capable capability leaves input fields unbound. |
| `http/bind-coverage` | HTTP binding omits input fields, references missing fields, or binds fields to conflicting locations. |
| `capability/example-consistency` | Example argv does not parse to the declared example input. |
| `capability/output-portable` | Output schema cannot be represented in generated surfaces. |
| `schema/portable` | Input/output schema uses unsupported transforms, custom refinements, functions, non-JSON values, or lossy defaults without an explicit escape hatch. |
| `schema/no-eager-local-import` | Schema eagerly imports a referenced local implementation module. |
| `openapi/eligibility` | Capability claims OpenAPI output but lacks HTTP-compatible mapping. |
| `generated/no-drift` | Generated files differ from current schema output. |
| `generated/no-manual-edit` | Generated file provenance header is missing or altered. |

## Drift checks

Drift check compares generated outputs to checked-in files:

```sh
liche-product generate ./liche.schema.ts --check
```

It must fail when:

- generated output differs from current schema output
- a generated file is hand-edited
- provenance header is missing or altered
- schema digest differs from the catalog digest used to generate the file

Drift check does not verify a deployed server. Server conformance is a separate capability because it needs a live or fixture HTTP target.

## Build CLI

`@liche/product` exposes Product authoring and generation commands only for users who install it:

```sh
liche-product lint ./liche.schema.ts
liche-product generate ./liche.schema.ts --out .liche/generated
liche-product generate ./liche.schema.ts --check
liche-product conform ./liche.schema.ts --base-url http://localhost:5173
liche-product compile ./liche.schema.ts --target bun-linux-x64
```

Pipeline:

```txt
1. Load runtime schema module with Bun.
2. Normalize product schema into a canonical catalog.
3. Run schema lints.
4. Generate CLI source and byproduct surfaces.
5. Run drift check if requested.
6. Run server conformance if requested.
7. Compile generated CLI entry by delegating to `@liche/build`.
8. Emit binary artifacts and internal build record.
```

## Compile determinism

The compile command must choose deterministic settings deliberately. Bun's `compile` option exposes settings that change runtime behavior of the resulting binary; the build pipeline must pin them explicitly rather than inherit defaults.

`@liche/build` owns all `Bun.build()` calls. `@liche/releases` must not call `Bun.build()`, rebuild binaries, read generated source, or infer compile settings from a workspace. Releases receive final binary paths, final binary hashes/sizes, and the build record produced here.

Generated CLI files remain importable test fixtures. The compile path writes a small internal entrypoint next to the generated CLI that imports the generated default export and calls `cli.serve(process.argv.slice(2))`. That compile entrypoint is internal build-record data, not a generated surface artifact and not release-manifest data.

### Required compile flags

For release builds, `@liche/build compile-entry` must invoke `Bun.build()` with a profile equivalent to:

```sh
bun build --compile \
  --target=<bun-os-arch[-libc]> \
  --minify \
  --sourcemap \
  --bytecode \
  --no-compile-autoload-bunfig \
  --no-compile-autoload-dotenv \
  --define LICHE_BUILD_VERSION='"<release.version>"' \
  --define LICHE_CONTRACT_DIGEST='"<contract-digest>"' \
  --define LICHE_SOURCE_COMMIT='"<git-sha>"' \
  --define LICHE_BUILD_TOOL_VERSION='"<build-tool.version>"' \
  --outfile <out>
```

The implementation should construct one plain `CompileFlagProfile` and derive both the `Bun.build()` options and `compileFlagsDigest` from it. Local paths such as generated entrypoint path, output path, temp directories, metafile paths, and local logs belong in the internal build record and must not affect `compileFlagsDigest`.

Rationale:

| Flag | Why pinned |
|---|---|
| `--target` | Cross-compile matrix is fixed by the release manifest, not the host. Defaults to host triple if omitted, which silently produces wrong artifacts in CI. |
| `--minify` | Reduces binary size; required for reproducible bytes alongside `--bytecode`. |
| `--sourcemap` | Preserves useful source locations for structured errors and crash reports. The exact sourcemap storage behavior is a Bun build detail; the chosen setting must still be recorded in the compile flag profile. |
| `--bytecode` | Moves JS parse cost from runtime to build time. Required because CLI startup is the dominant user-visible latency for short-lived invocations. |
| `--no-compile-autoload-bunfig` | A compiled CLI must not pick up the invoking user's `bunfig.toml`. Deterministic execution requires the binary behave the same regardless of working directory. |
| `--no-compile-autoload-dotenv` | Env vars are a documented input channel (`docs/env-vars.md`), not an ambient one. `.env` loading at runtime would let an unrelated project's `.env` mutate CLI behavior. Schema-declared env vars are read from the process environment directly. |
| `--compile-autoload-tsconfig`, `--compile-autoload-package-json` | Must remain off (the Bun default). The bundler already consumed these at build time. |
| `--define` | Build-time constants for version, schema digest, schema commit, and generator version. Embedded into the binary so `--version` and crash reports can identify the build without filesystem lookups. |
| `metafile` | Should be available in the internal build record for dependency/size analysis. It is audit data, not a release-manifest field. |

### Forbidden flags

| Flag | Why forbidden |
|---|---|
| `--compile-exec-argv` | Runtime args belong to the user's invocation, not to a baked-in default. `BUN_OPTIONS` remains available as an escape hatch for profiling. |
| host-default `--target` | The release pipeline must specify the target explicitly for every artifact in the matrix. |

### Baseline vs modern x64 targets

Bun ships `-baseline` and `-modern` variants of every x64 target. The release matrix must choose one per platform and document the floor:

- `bun-darwin-x64`: ship the default (modern). Pre-2013 Mac hardware is out of support.
- `bun-linux-x64`: ship `bun-linux-x64-baseline`. Linux x64 hosts include containers, CI runners, and edge VMs with unknown CPU features; an `Illegal instruction` crash from AVX2 on a baseline-only host is unrecoverable.
- `bun-windows-x64`: ship `bun-windows-x64-baseline` for the same reason.

ARM64 targets have no baseline/modern split.

### musl targets

`bun-linux-x64-musl` and `bun-linux-arm64-musl` must be produced as separate artifacts. Alpine, distroless, and similar images cannot run glibc binaries. The release manifest already encodes `libc` per binary entry; npm `libc` filters and PyPI `musllinux` tags consume it.

### Runtime escape hatches

The compiled binary inherits two Bun behaviors that the docs must surface:

- `BUN_OPTIONS` env var injects runtime flags (e.g. `BUN_OPTIONS="--cpu-prof" ./acme ...`). Useful for profiling production binaries without rebuild. Must not be relied on for normal operation.
- `BUN_BE_BUN=1` makes the binary act as the `bun` CLI itself. This is a Bun feature, not an liche feature. Users invoking the CLI with this env var are not running schema-driven code at all; document it as a known behavior and do not attempt to detect or block it.

### Release record

For releases, the build pipeline must record:

- release subject id/name when available from the caller
- release subject version
- source commit
- contract digest
- build-tool version
- build target (including baseline/modern/musl variant)
- exact compile flag set used
- `--define` values embedded into the binary
- runtime config expectations, including declared config schema artifacts and env vars required for remote base URL and auth/session

The recorded flag set is what `release/binary-hash` reproducibility checks compare against. A flag drift between two builds of the same catalog digest is a release failure.

## Acceptance criteria

Build system MVP is accepted only when:

- handwritten `@liche/core` CLI still works without `@liche/product` or `@liche/build`
- core exposes outbound HTTP operation transport for handwritten and generated CLIs
- runtime product schema defines resources, commands, bindings, auth providers, permissions, contexts, field metadata, closed vocabulary, execution mode, effects, input schema, output schema, HTTP binding, and surface membership
- schema linter rejects vocabulary drift, missing output contracts, missing execution modes, missing or inconsistent effects, incomplete HTTP bindings, invalid auth/context/permission requirements, unsupported portable schema shapes, and eager local imports
- generated command tree registers commands through public `@liche/core` APIs
- generated remote-http capability calls the core HTTP operation transport
- generated local command imports implementation lazily at runtime
- generated and equivalent handwritten command behavior converge for the same inputs and expected outputs
- server conformance verifies an owned external HTTP deployment against schema examples, HTTP bindings, and output schemas
- `generate --check` remains a hermetic artifact freshness check and is separate from server conformance
- OpenAPI/MCP/docs and command manifest are generated as schema byproducts
- generated surface manifest records every emitted surface with source digest, generator version, generation options digest, output digest, and artifact list
- generated fixtures include both CRUD-like resource operations and workflow commands so no generator or lint assumes every command is a resource or HTTP endpoint
- core runtime reflection overlap is explicitly scoped
- drift check fails on hand-edited generated output
- compile command produces Bun standalone binaries for configured targets
