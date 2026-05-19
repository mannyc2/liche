# Build system requirements

## `gen` placement

`li gen` (typegen) ships in the current core runtime because `@lili/build` doesn't exist yet. It loads command metadata via `stateSymbol` and emits a `declare module` augmentation on `Cli.Commands`. When the build package lands, `gen` is a candidate to move there — it's arguably a build-time concern, not a runtime concern. Behavior IDs: `GEN-001`.

`@lili/build` is an opt-in package. It consumes a runtime contract module, normalizes it into canonical IR, generates artifacts, checks drift, and compiles a standalone Bun binary.

`@lili/build` does not replace `@lili/core`. Generated code must plug into core through public runtime APIs.

Detailed requirements live in:

- `docs/http-operation-transport.md`
- `docs/schema-ir-openapi.md`
- `docs/server-conformance.md`

## Purpose

The build system exists so a user can define an owned operation contract once and get:

- generated CLI command tree
- generated dispatcher
- generated outbound remote HTTP wiring
- generated local implementation wiring
- generated OpenAPI for HTTP-compatible operations
- generated MCP tools
- generated docs/reference markdown
- generated Agent Skill/LLM surfaces
- generated JSON Schema for config, when configured
- deterministic drift checks
- server conformance checks against owned HTTP deployments
- Bun standalone binary compilation

Handwritten CLIs remain valid without installing `@lili/build`.

The contract is authoritative for owned operation surfaces. `@lili/build` does not generate server routes in MVP, but it does generate the contract and conformance checks that a hand-written server must satisfy.

The `li-build` developer CLI opts into core helper built-ins for completions, skills, and MCP. Its `skills add` command installs authored build-package guidance through `CreateOptions.skill`. Generated product CLIs do not automatically enable `skills` or `mcp`; their agent skill and MCP surfaces must come from canonical IR when the contract opts into those generated surfaces.

## Generated surface graph

The build system must model generated outputs as synchronized surfaces over one source graph.

Required surface record:

```ts
type GeneratedSurfaceRecord = {
  id: string;
  source: "canonical-ir" | "openapi";
  owner: "@lili/build" | "@lili/releases" | "adapter";
  generatorVersion: string;
  generationOptionsDigest: string;
  inputDigest: string;
  outputDigest: string;
  artifacts: string[];
};
```

`artifacts` are relative artifact paths. Absolute local paths are internal build-record data and must not affect canonical schema digests.

Initial IR-derived surfaces:

| Surface | Source | MVP status |
|---|---|---|
| CLI command tree | canonical IR | required |
| dispatcher and local/remote wiring | canonical IR | required |
| command manifest / `schema --json` | canonical IR | required |
| OpenAPI projection | canonical IR | required for HTTP-compatible operations |
| MCP command tools | canonical IR | required |
| Agent Skill/LLM surfaces | canonical IR | required |
| docs/reference markdown | canonical IR | required |
| JSON Schema for config | canonical IR | required when config is declared |

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
| Workers Binding RPC metadata | canonical IR plus platform adapter requirement | Binding semantics, auth, deployment, and runtime compatibility must be documented. |
| `wrangler.jsonc` fragments or schema | canonical IR plus config metadata | Config keys, defaults, env precedence, and ownership must be documented. |
| Dashboard metadata | canonical IR plus product metadata | UI labels, lifecycle, permissions, safety, and audit behavior must be documented. |
| Developer docs beyond reference markdown | canonical IR plus docs metadata | Narrative ownership, examples, and publication target must be documented. |
| Product API implementation/stubs | canonical IR plus server adapter requirement | Generated server code is not MVP; conformance remains the first proof that an owned API implements the schema. |

Each generated surface must have a drift check. A stale generated CLI, stale OpenAPI document, stale Agent Skill, or stale config schema is the same class of failure: the generated surface no longer matches the canonical source graph.

Do not infer a broad generator framework from this requirement. The first vertical slice still proves one generated command through core APIs before adding broad surface coverage.

## Public API Shape

The build API is runtime-value first. TypeScript inference is derived from runtime schema values; erased TypeScript types are not generator input.

```ts
import { Contract, vocabulary, z } from "@lili/build";

export default Contract.create({
  name: "acme",
  version: "1.0.0",

  vocabulary: vocabulary({
    verbs: ["get", "list", "create", "update", "delete", "run"],
    flags: ["json", "local", "remote", "force"],
    aliases: { ls: "list" },
  }),

  remote: {
    baseUrl: {
      envVar: "ACME_API_URL",
    },
    auth: {
      kind: "bearer",
      envVar: "ACME_TOKEN",
    },
  },
}).operation({
  id: "users.list",
  command: ["users", "list"],
  description: "List users",

  locality: {
    modes: ["remote", "local"],
    default: "remote",
  },

  input: z.object({
    limit: z.number().int().min(1).max(100).default(20),
  }),

  output: z.object({
    users: z.array(
      z.object({
        id: z.string(),
        email: z.string(),
      }),
    ),
  }),

  remote: {
    method: "GET",
    path: "/users",
    bind: {
      query: ["limit"],
    },
  },

  local: {
    module: "./operations/users.ts",
    export: "listUsers",
  },

  examples: [
    {
      argv: ["users", "list", "--limit", "10", "--json"],
      input: { limit: 10 },
    },
  ],
});
```

The public authoring model is contract-shaped, not CLI-program-shaped. `Contract.create(...).operation(...)` is the source API. Generated CLIs still lower into `@lili/core` through `Cli.create().command(...)`.

`Contract.kind === "lili.contract"` is a runtime loading tag. `li-build` uses it when importing an unknown module path before normalizing or generating from that value.

## Canonical IR

The normalized IR must include at least:

```ts
type Contract = {
  name: string;
  version: string;
  vocabulary: Vocabulary;
  remote?: ContractRemote;
  operations: Operation[];
};

type Vocabulary = {
  verbs: string[];
  flags: string[];
  aliases?: Record<string, string>;
};

type ContractRemote = {
  baseUrl: RuntimeValue;
  auth?: RemoteAuth;
  timeoutMs?: number;
};

type RuntimeValue =
  | { envVar: string; literal?: string }
  | { envVar?: string; literal: string };

type RemoteAuth =
  | { kind: "none" }
  | { kind: "bearer"; envVar: string }
  | { kind: "apiKey"; envVar: string; header: string };

type Operation = {
  id: string;
  command: string[];
  description?: string;

  locality: {
    modes: ("remote" | "local")[];
    default: "remote" | "local";
  };

  input: z.ZodType;
  output: z.ZodType;

  remote?: RemoteOperation;
  local?: LocalOperation;
  examples?: OperationExample[];
  policy?: OperationPolicy;
};

type RemoteOperation = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  bind: RemoteBinding;
};

type RemoteBinding = {
  path?: string[];
  query?: string[];
  headers?: Record<string, string>;
  body?: string[] | true;
};

type LocalOperation = {
  module: string;
  export: string;
};
```

The three non-negotiables are:

```txt
closed vocabulary
locality as a first-class field
one input and one output contract per operation
effects as a first-class field
```

`effects.kind` is the user-facing safety and lint axis. It must be one of:

```txt
read
write
delete
exec
```

Effects do not imply a resource model. `project delete` and `db migrate` can both be dangerous commands, but only one is naturally CRUD-shaped. The linter should reason over the command contract, not force commands through resource inheritance.

## Agent consistency guardrails

The current core is intentionally permissive for handwritten CLIs. That is not sufficient for schema-driven CLIs aimed at agents.

The rewrite must close these audit gaps:

- command actions are derived from the final command segment; schema-driven operations must reject actions that are not in the contract vocabulary
- command flags are currently derived from arbitrary Zod option keys; schema-driven control flags must reject names that are not in the contract vocabulary
- `--format` is currently a global runtime option; generated product CLIs must make `--json` the canonical machine-output switch and must not advertise `--format` as the agent contract
- built-in and generated helper commands must honor `--json` consistently; text such as `wrote ./lili.generated.ts` is not acceptable when JSON was explicitly requested
- generated JSON output for local or remote operations must identify the locality mode that was applied
- generated OpenAPI must come from `remote.bind` and operation metadata, not from the current runtime reflection shortcut that emits every command as a `POST`

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

`vocabulary({...})` is a convenience for extending the default vocabulary. A contract that wants to replace the defaults can pass an explicit `Vocabulary` object instead. The linter treats vocabulary as an allowlist only: if a derived command action or generated control flag is present in the active vocabulary, it is allowed; if it is absent, it fails. There is no separate forbidden-word list.

`vocabulary.aliases` is command-surface metadata, not an extra allowlist. Alias targets must still resolve to names present in the active vocabulary when they are used by a generated surface.

`--force` is the standard destructive-action bypass flag in the default vocabulary. A product can choose a different control-flag vocabulary by not using the defaults, but generated surfaces must still use only flags present in the active vocabulary.

For current core compatibility, handwritten CLIs may continue to use richer formatting and arbitrary command names. That compatibility layer must not be treated as proof that schema-driven generated surfaces satisfy the closed-vocabulary requirement.

## Remote transport ownership

Outbound HTTP operation transport is core runtime behavior.

`@lili/core` must export a documented primitive, tentatively named `callHttpOperation`, that can be used by handwritten CLIs and generated CLIs. `@lili/build` generates wiring that calls the primitive.

The primitive must own:

- resolving contract-level runtime config such as base URL and auth
- serializing input into path, query, and body according to the operation mapping
- making the HTTP request
- parsing the HTTP response
- validating successful response data through the operation output schema
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

## Locality semantics

Locality is a runtime behavior, not only docs metadata.

```txt
local mode:
  generated run() imports the configured local module and calls the configured export

remote mode:
  generated run() calls @lili/core outbound HTTP operation transport

mixed mode:
  generated run() chooses local or remote by explicit flag/config/default
```

Generated commands must resolve locality with this precedence:

```txt
explicit flag:
  --remote or --local

config:
  operation-specific locality preference

schema default:
  operation.locality.default
```

`--local` and `--remote` are mutually exclusive. Passing both is a parse error before execution.

Machine-readable output must identify what happened. For `--json`, generated local/remote operations must use the standard envelope and include at least:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "locality": {
      "mode": "remote",
      "source": "default"
    }
  }
}
```

`source` is one of `flag`, `config`, or `default`. Human output should also include a concise local/remote signal for operations where confusion is possible, especially mixed-mode operations.

`operation/locality-shape` is a correctness gate:

- local and remote execution for one operation share the same input schema
- local and remote execution for one operation share the same output schema
- downstream surfaces assume those contracts are identical

A mixed operation must have a runtime conformance test against a fixture backend that proves local and remote implementations produce identical parsed output for the same valid input.

This guarantee has two layers:

```txt
local conformance:
  the generated local path imports owned implementation code and validates its return value with the output schema

remote conformance:
  a server outside the CLI process is checked against the schema, remote binding, and output schema
```

The linter can prove schema shape. Only server conformance can prove that a hand-written remote server actually implements the contract.

## Generated-code seam

Generated command code must be plain TypeScript that imports `@lili/core` and registers commands through the public `Cli.create().command()` API.

Representative generated file:

```ts
// generated by @lili/build
// schema: ./lili.schema.ts
// schemaDigest: sha256:<canonical-ir-digest>
// generatorVersion: <version>
// do not edit by hand

import { Cli, callHttpOperation } from "@lili/core";
import contract from "../lili.contract";

export const cli = Cli.create({
  name: "acme",
  version: "1.0.0",
});

cli.command("users list", {
  description: "List users",
  options: contract.operations["users.list"].input,
  output: contract.operations["users.list"].output,
  async run(ctx) {
    return await callHttpOperation(ctx, {
      baseUrl: contract.remote.baseUrl,
      auth: contract.remote.auth,
      method: "GET",
      path: "/users",
      bind: {
        query: ["limit"],
      },
      input: ctx.options,
      output: contract.operations["users.list"].output,
    });
  },
});
```

That example is not final API syntax. It is the required architectural seam: generated code wires schema metadata into core; core performs runtime behavior.

## Local implementation imports

The schema module must be safe to import for linting, docs generation, and code generation.

Rules:

- `local.module` is a string reference relative to the schema file.
- the schema module must not eagerly import local implementation modules
- implementation modules are imported only by generated runtime code when local execution is selected
- the build system must lint that the target module exists and the export exists
- generated code must fail with a structured error when a local implementation cannot be loaded

Required lint:

```txt
schema/no-eager-local-import
  Fails when the schema module imports a file referenced by local.module.
```

## Remote binding

`remote.method` and `remote.path` are not sufficient alone. The build system must know where input fields go.

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

OpenAPI generation must consume `bind`. Path, query, and header fields become parameters; body fields become request body schema.

Conformance must also consume `bind`. A bind bug is not visible in local mode because local mode does not serialize HTTP requests.

## Server conformance

Server conformance is a named MVP capability owned by `@lili/build`.

It verifies that an owned external HTTP deployment implements the schema contract. It is separate from generated-file drift checks.

The detailed command contract, fixture shape, report schema, and safety rules live in `docs/server-conformance.md`.

```txt
generate --check:
  hermetic artifact freshness check
  compares generated files to canonical IR output

conform:
  server-vs-schema check
  sends operation example requests to a live or fixture server
  validates responses against output schemas
```

Proposed CLI:

```sh
li-build conform ./lili.schema.ts --base-url http://localhost:5173
li-build conform ./lili.schema.ts --env staging
li-build conform ./lili.schema.ts --report .lili/conformance.json
```

Conformance must assert:

- operation examples parse from `argv` to declared input
- input serializes into HTTP request according to `remote.bind`
- configured base URL and auth are applied
- server accepts the request shape
- successful response body parses as JSON when JSON is expected
- successful response data validates against the operation output schema
- non-2xx, malformed, and schema-invalid responses are reported as structured conformance failures

Conformance should use declared examples or explicit conformance fixtures. It must not invent unsafe mutating requests against production.

Policy:

| Operation policy | Default conformance behavior |
|---|---|
| idempotent/read-only | May run against configured target when examples exist. |
| destructive | Requires explicit conformance fixture and opt-in target. |
| requires confirmation | Requires explicit conformance fixture and opt-in target. |
| no examples or fixture | Report skipped with reason; do not silently pass. |

`@lili/releases` may require or attach a conformance report before publishing, but `@lili/build` owns the conformance logic because it is schema-contract verification.

## Generated surfaces

`@lili/build` generates:

```txt
generated CLI command tree
generated dispatcher
generated command manifest / schema --json
generated OpenAPI for HTTP-compatible operations
generated MCP tools
generated docs/reference markdown
generated Agent Skills / llms surface
generated JSON Schema for config, when configured
generated surface manifest
```

OpenAPI is an output, not an input. It is emitted only for operations with HTTP-compatible remote bindings.

Local-only and interactive operations remain valid IR operations even when no OpenAPI route is emitted.

The generated surface manifest records every emitted surface record from the generated surface graph. It is a build artifact for drift checks and release provenance; it is not the release manifest owned by `@lili/releases`.

## Command manifest

Schema-driven contracts must expose a compact command manifest surface for agents and automation. It is separate from OpenAPI because it includes command-local concepts such as argv shape, local-only operations, effects, locality, examples, and output envelopes.

Required minimum fields per command:

```ts
type CommandManifestEntry = {
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
  locality: {
    modes: Array<"local" | "remote">;
    default: "local" | "remote";
  };
  examples: string[];
};
```

The build package may expose this as generated JSON, a built-in generated command such as `schema --json`, or both. In all cases, the manifest is IR-derived and must be covered by generated-surface drift checks.

## Vite sanity check only

The framework must not know Vite exists.

A developer who already has backend operations should be able to expose those operations through the existing generic core altitude and get a generated CLI with good local/remote ergonomics.

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

Schema-generated artifacts are canonical for schema-driven contracts. The generated CLI may still register enough metadata for core reflection to work, but weaker runtime reflection must not override or silently conflict with IR-generated OpenAPI, MCP, docs, or Agent Skill output.

Required decision:

```txt
handwritten CLI:
  core reflection is canonical

schema-driven generated CLI:
  canonical IR outputs are canonical
  core reflection is compatibility only
```

## Schema lints

Schema lints are CI gates, not style suggestions.

| Rule | Fails when |
|---|---|
| `vocabulary/verb` | Operation uses a verb outside the allowed vocabulary. |
| `vocabulary/flag` | Operation or override introduces an unapproved flag. |
| `operation/output-required` | Public operation has no output schema. |
| `operation/locality-required` | Operation does not declare local/remote support. |
| `operation/locality-binding` | Operation declares `local` or `remote` locality without the corresponding execution binding. |
| `operation/locality-shape` | Local and remote paths do not share one input/output contract. |
| `operation/effects-required` | Operation does not declare `effects.kind`, idempotence, and danger level. |
| `operation/effects-policy-consistent` | Effects and execution/conformance policy disagree, such as a dangerous delete treated as non-destructive. |
| `operation/id-stable` | Operation ID is missing, duplicated, or unstable. |
| `contract/remote-base-url` | Contract-level remote config exists without a base URL env var or literal. |
| `operation/http-binding-complete` | Remote operation leaves input fields unbound. |
| `remote/bind-coverage` | Remote binding omits input fields, references missing fields, or binds fields to conflicting locations. |
| `operation/example-consistency` | Example argv does not parse to the declared example input. |
| `operation/output-portable` | Output schema cannot be represented in generated surfaces. |
| `schema/portable` | Input/output schema uses unsupported transforms, custom refinements, functions, non-JSON values, or lossy defaults without an explicit escape hatch. |
| `schema/no-eager-local-import` | Schema eagerly imports a referenced local implementation module. |
| `openapi/eligibility` | Operation claims OpenAPI output but lacks HTTP-compatible mapping. |
| `generated/no-drift` | Generated files differ from current schema output. |
| `generated/no-manual-edit` | Generated file provenance header is missing or altered. |

## Drift checks

Drift check compares generated outputs to checked-in files:

```sh
li-build generate ./lili.schema.ts --check
```

It must fail when:

- generated output differs from current schema output
- a generated file is hand-edited
- provenance header is missing or altered
- schema digest differs from the canonical IR digest used to generate the file

Drift check does not verify a deployed server. Server conformance is a separate capability because it needs a live or fixture HTTP target.

## Build CLI

`@lili/build` exposes a small CLI only for users who install it:

```sh
li-build lint ./lili.schema.ts
li-build generate ./lili.schema.ts --out .lili/generated
li-build generate ./lili.schema.ts --check
li-build conform ./lili.schema.ts --base-url http://localhost:5173
li-build compile ./lili.schema.ts --target bun-linux-x64
```

Pipeline:

```txt
1. Load runtime schema module with Bun.
2. Normalize schema into canonical IR.
3. Run schema lints.
4. Generate CLI source and byproduct surfaces.
5. Run drift check if requested.
6. Run server conformance if requested.
7. Compile generated CLI entry with bun build --compile.
8. Emit binary artifacts and internal build record.
```

## Compile determinism

The compile command must choose deterministic settings deliberately. Bun's `--compile` exposes flags that change runtime behavior of the resulting binary; the build pipeline must pin them explicitly rather than inherit defaults.

### Required compile flags

For release builds, `@lili/build compile` must invoke `bun build --compile` with at minimum:

```sh
bun build --compile \
  --target=<bun-os-arch[-libc]> \
  --minify \
  --sourcemap \
  --bytecode \
  --no-compile-autoload-bunfig \
  --no-compile-autoload-dotenv \
  --define INCUR_BUILD_VERSION='"<release.version>"' \
  --define INCUR_SCHEMA_DIGEST='"<canonical-ir-digest>"' \
  --define INCUR_SCHEMA_COMMIT='"<git-sha>"' \
  --define INCUR_GENERATOR_VERSION='"<generator.version>"' \
  --outfile <out>
```

Rationale:

| Flag | Why pinned |
|---|---|
| `--target` | Cross-compile matrix is fixed by the release manifest, not the host. Defaults to host triple if omitted, which silently produces wrong artifacts in CI. |
| `--minify` | Reduces binary size; required for reproducible bytes alongside `--bytecode`. |
| `--sourcemap` | Linked, zstd-compressed sourcemap embedded in the binary. Required so structured errors thrown by core point at schema-authored locations, not transpiled offsets. |
| `--bytecode` | Moves JS parse cost from runtime to build time. Required because CLI startup is the dominant user-visible latency for short-lived invocations. |
| `--no-compile-autoload-bunfig` | A compiled CLI must not pick up the invoking user's `bunfig.toml`. Deterministic execution requires the binary behave the same regardless of working directory. |
| `--no-compile-autoload-dotenv` | Env vars are a documented input channel (`docs/env-vars.md`), not an ambient one. `.env` loading at runtime would let an unrelated project's `.env` mutate CLI behavior. Schema-declared env vars are read from the process environment directly. |
| `--compile-autoload-tsconfig`, `--compile-autoload-package-json` | Must remain off (the Bun default). The bundler already consumed these at build time. |
| `--define` | Build-time constants for version, schema digest, schema commit, and generator version. Embedded into the binary so `--version` and crash reports can identify the build without filesystem lookups. |

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
- `BUN_BE_BUN=1` makes the binary act as the `bun` CLI itself. This is a Bun feature, not an lili feature. Users invoking the CLI with this env var are not running schema-driven code at all; document it as a known behavior and do not attempt to detect or block it.

### Release record

For releases, the build pipeline must record:

- schema name
- schema version
- schema commit
- canonical IR digest
- generator version
- build target (including baseline/modern/musl variant)
- exact compile flag set used
- `--define` values embedded into the binary
- runtime config expectations, including env vars required for remote base URL and auth

The recorded flag set is what `release/binary-hash` reproducibility checks compare against. A flag drift between two builds of the same canonical IR digest is a release failure.

## Acceptance criteria

Build system MVP is accepted only when:

- handwritten `@lili/core` CLI still works without `@lili/build`
- core exposes outbound HTTP operation transport for handwritten and generated CLIs
- runtime schema IR defines closed vocabulary, locality, effects, input schema, output schema, remote binding, and operation metadata
- schema linter rejects vocabulary drift, missing output contracts, missing locality, missing or inconsistent effects, incomplete remote bindings, unsupported portable schema shapes, and eager local imports
- generated command tree registers commands through public `@lili/core` APIs
- generated remote command calls the core HTTP operation transport
- generated local command imports implementation lazily at runtime
- generated and equivalent handwritten command behavior converge for the same inputs and expected outputs
- server conformance verifies an owned external HTTP deployment against schema examples, remote bindings, and output schemas
- `generate --check` remains a hermetic artifact freshness check and is separate from server conformance
- OpenAPI/MCP/docs and command manifest are generated as schema byproducts
- generated surface manifest records every emitted surface with source digest, generator version, generation options digest, output digest, and artifact list
- generated fixtures include both CRUD-like operations and workflow commands so no generator or lint assumes every command is a resource or HTTP endpoint
- core runtime reflection overlap is explicitly scoped
- drift check fails on hand-edited generated output
- compile command produces Bun standalone binaries for configured targets
