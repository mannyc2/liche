# Schema IR and OpenAPI requirements

`@lili/build` normalizes runtime contract values into canonical IR before generation.

OpenAPI is owned by `@lili/build`, not `@lili/core`. Core's `cli.fetch` handler exposes command-tree execution and MCP, but does not emit or ingest OpenAPI documents. The previous runtime-reflection emit and ingest in core have been removed; `@lili/build` will produce OpenAPI from canonical IR and `remote.bind` (see below). OpenAPI is a projection of canonical IR for HTTP-compatible operations.

## Runtime and canonical IR split

Do not mix runtime handles with digestable IR.

Use two internal shapes:

```txt
RuntimeNormalizedContract
  may hold Zod schema handles for validation and generated TypeScript

CanonicalContractIR
  serializable
  stable
  no functions
  no Zod handles
  suitable for digesting and deterministic generation
```

The canonical digest must never include raw Zod objects, functions, absolute paths, timestamps, env values, or secret values.

Generation options are separate from canonical IR. A surface may be disabled, routed to a different relative artifact path, or rendered with target-specific options without changing the canonical schema digest. Those choices belong in the generated surface manifest and contribute to the surface output digest.

## Minimum canonical IR

```ts
export type ContractIR = {
  kind: "lili.contract";
  irVersion: 1;
  name: string;
  version: string;
  vocabulary: VocabularyIR;
  remote?: ContractRemoteIR;
  operations: OperationIR[];
};

export type VocabularyIR = {
  verbs: string[];
  flags: string[];
  aliases: Record<string, string>;
};

export type ContractRemoteIR = {
  baseUrl: RuntimeValueIR;
  auth: RemoteAuthIR;
  timeoutMs: number;
};

export type RuntimeValueIR =
  | { envVar: string; literal?: string }
  | { envVar?: string; literal: string };

export type RemoteAuthIR =
  | { kind: "none" }
  | { kind: "bearer"; envVar?: string }
  | { kind: "apiKey"; envVar?: string; header?: string };

export type OperationIR = {
  id: string;
  // Derived from command[command.length - 1], not authored separately.
  verb: string;
  command: string[];
  description?: string;

  locality: {
    modes: Array<"local" | "remote">;
    default: "local" | "remote";
  };

  input: SchemaProjectionIR;
  output: SchemaProjectionIR;

  remote?: RemoteOperationIR;
  local?: LocalOperationIR;

  effects: OperationEffectsIR;
  examples: OperationExampleIR[];
  policy: OperationPolicyIR;
};

export type SchemaProjectionIR = {
  jsonSchema: unknown;
  portability: {
    openapi: boolean;
    mcp: boolean;
    docs: boolean;
    reasons: string[];
  };
};

export type RemoteOperationIR = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  bind: RemoteBindIR;
};

export type RemoteBindIR = {
  path: string[];
  query: string[];
  headers: Record<string, string>;
  body: true | string[] | false;
};

export type LocalOperationIR = {
  module: string;
  export: string;
};

export type OperationEffectsIR = {
  kind: "read" | "write" | "delete" | "exec";
  idempotent: boolean;
  dangerous: boolean;
};

export type OperationPolicyIR = {
  idempotent: boolean;
  destructive: boolean;
  requiresConfirmation: boolean;
  conformance: "auto" | "fixture-only" | "skip";
};

export type OperationExampleIR = {
  name?: string;
  argv: string[];
  input: unknown;
  response?: unknown;
  safe?: boolean;
};
```

`effects` describes what the command does for linting, help, docs, agent manifests, and default safety behavior. `policy` describes execution and conformance guard rails. They must agree: for example, `effects.kind: "delete"` or `effects.dangerous: true` cannot silently become a non-destructive conformance policy.

## OpenAPI projection

OpenAPI generation consumes `remote.bind`.

Mapping:

| Binding | OpenAPI output |
|---|---|
| `bind.path` | path parameters; each must match a `{field}` template segment |
| `bind.query` | query parameters |
| `bind.headers` | header parameters, except auth/media headers handled by security/content |
| `bind.body` | `requestBody.content["application/json"]` |

OpenAPI is emitted only for operations with HTTP-compatible remote bindings.

Local-only operations remain valid IR operations but do not emit HTTP routes.

OpenAPI is the handoff point for downstream HTTP ecosystem surfaces such as SDKs, Terraform providers, and a future Code Mode MCP server. Those downstream surfaces must consume the generated OpenAPI document and its digest, not the raw schema source or generated CLI code.

The generated CLI's MCP command tools are different: they are IR-derived command surfaces and may include local-mode semantics that do not exist in OpenAPI. Do not use OpenAPI as the source for command MCP tools unless a later requirement explicitly narrows the behavior to HTTP-only commands.

## Generated surface manifest

`@lili/build` emits a generated surface manifest beside generated artifacts.

Minimum shape:

```ts
export type GeneratedSurfaceManifest = {
  manifestVersion: 1;
  schema: {
    name: string;
    version: string;
    digest: string;
  };
  generatorVersion: string;
  surfaces: Array<{
    id: string;
    source: "canonical-ir" | "openapi";
    inputDigest: string;
    generationOptionsDigest: string;
    outputDigest: string;
    artifacts: string[];
  }>;
};
```

The manifest supports drift checks and later release provenance. It must not contain secret values, absolute local paths, timestamps that affect deterministic output, or raw runtime handles.

## Example operation

```ts
Contract.create({ name: "acme", version: "1.0.0" }).operation({
  id: "projects.get",
  command: ["projects", "get"],
  description: "Get one project",

  locality: {
    modes: ["remote"],
    default: "remote",
  },

  input: z.object({
    orgId: z.string(),
    projectId: z.string(),
    includeDeployments: z.boolean().default(false),
  }),

  output: z.object({
    project: z.object({
      id: z.string(),
      name: z.string(),
    }),
    deployments: z
      .array(
        z.object({
          id: z.string(),
          status: z.enum(["queued", "running", "success", "failed"]),
        }),
      )
      .optional(),
  }),

  remote: {
    method: "GET",
    path: "/orgs/{orgId}/projects/{projectId}",
    bind: {
      path: ["orgId", "projectId"],
      query: ["includeDeployments"],
    },
  },

  effects: {
    kind: "read",
    idempotent: true,
    dangerous: false,
  },
});
```

## Canonical digest rules

Include:

- contract name and version
- vocabulary
- remote config keys, not secret values
- operation IDs
- commands
- locality
- input/output JSON Schema projections
- remote method/path/bind
- local module/export strings
- effects
- examples
- policy
- generation-relevant descriptions
- source-declared surface metadata when it changes normalized contract behavior

Exclude:

- source formatting
- absolute local paths
- timestamps
- generated file paths
- runtime env values
- secret values
- raw Zod objects
- functions

Canonicalization:

```txt
sort object keys recursively
preserve array order where order is semantic
normalize undefined away
normalize default empty arrays/objects
serialize to stable JSON
sha256 -> sha256:<hex>
```

## Lints

Required lints:

```txt
vocabulary/verb
vocabulary/flag
operation/id-stable
operation/output-required
operation/locality-required
operation/locality-binding
contract/remote-base-url
operation/http-binding-complete
remote/path-param-template
remote/bind-coverage
remote/bind-conflict
remote/no-body-on-get-delete
operation/example-consistency
operation/output-portable
schema/portable
schema/no-eager-local-import
openapi/eligibility
generated/no-drift
generated/no-manual-edit
```

## Unsupported portable schema cases

Fail by default for generated OpenAPI/MCP/docs surfaces:

```txt
transforms
pipes where input/output diverge and no explicit projection is supplied
custom schemas
bigint
symbol
undefined
void
date
map
set
nan
functions/classes/non-JSON values
custom refinements that cannot be represented
async refinements in portable schemas
```

Allow unsupported constructs only with an explicit escape hatch that disables affected generated surfaces and records a reason.
