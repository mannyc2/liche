# Catalog and OpenAPI requirements

`@lili/product` normalizes runtime product schema values into a canonical catalog before generation. Public docs and APIs should use product names such as `Product`, `Resource`, `Command`, `Binding`, `Shape`, `Field`, `Catalog`, and `Capability`; avoid exposing `ProductIR` or `OperationIR` as the author-facing model.

OpenAPI is owned by `@lili/product`, not `@lili/core`. Core's `cli.fetch` handler exposes command-tree execution and MCP, but does not emit or ingest OpenAPI documents. The previous runtime-reflection emit and ingest in core have been removed; `@lili/product` will produce OpenAPI from the normalized catalog, HTTP bindings, and field metadata. In Phase 3C, OpenAPI is a projection of HTTP resource operations, not the source of truth and not a mirror of every CLI command.

## Runtime and canonical catalog split

Do not mix runtime handles with the digestable catalog.

Use two internal shapes:

```txt
RuntimeProductSchema
  may hold class instances and helper values used during authoring

CanonicalCatalog
  serializable
  stable
  no functions
  no class instances
  suitable for digesting and deterministic generation
```

The canonical digest must never include raw class instances, functions, absolute paths, timestamps, env values, or secret values.

Generation options are separate from the canonical catalog. A surface may be disabled, routed to a different relative artifact path, or rendered with target-specific options without changing the canonical schema digest. Those choices belong in the generated surface manifest and contribute to the surface output digest.

## Minimum canonical catalog

The detailed product schema model lives in `docs/product-schema.md`. The minimum normalized shape is:

```ts
export type Catalog = {
  kind: "lili.catalog";
  catalogVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  vocabulary: Vocabulary;
  scope?: ProductScope;
  authProviders: AuthProviderCatalog[];
  permissions: PermissionCatalog[];
  contexts: ContextCatalog[];
  resources: Resource[];
  commands: Command[];
  bindings: Binding[];
  capabilities: Capability[];
};

export type Vocabulary = {
  verbs: string[];
  flags: string[];
  aliases: Record<string, string>;
};

export type RuntimeValue =
  | { envVar: string; literal?: string }
  | { envVar?: string; literal: string };

export type RemoteAuth =
  | { kind: "none" }
  | { kind: "bearer"; envVar?: string }
  | { kind: "apiKey"; envVar?: string; header?: string };

export type AuthProviderCatalog =
  | { kind: "none" }
  | {
      id: string;
      kind: "bearer" | "apiKey" | "oauthDevice";
      tokenSources: Array<
        | { kind: "env"; envVar: string; mode: "any" | "ci"; label?: string }
        | { kind: "session"; refresh: boolean }
      >;
      header?: string;
      identity?: { http: HttpSpec; subject: string; label?: string };
      generatedCommands: Partial<Record<"login" | "logout" | "whoami" | "switch", string>>;
    };

export type PermissionCatalog = {
  id: string;
  scope?: string;
  description?: string;
};

export type ContextCatalog = {
  id: string;
  label: string;
  parent?: string;
  select: {
    flag?: string;
    env?: string;
  };
};

export type CapabilityRequirements = {
  auth?: true | { provider: string };
  contexts: string[];
  permissions: string[];
};

export type Capability = ResourceCapability | CommandCapability;

export type ResourceCapability = {
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
  examples: CapabilityExample[];
  policy: CapabilityPolicy;
};

export type CommandCapability = {
  kind: "command";
  id: string;
  family: "workflow" | "auth" | "setup" | "diagnostic" | "dev";
  summary: string;
  description?: string;
  input: ShapeProjection;
  output: ShapeProjection;
  execution: Execution;
  requirements: CapabilityRequirements;
  effects: CapabilityEffects;
  surfaces: NormalizedSurfaces;
  examples: CapabilityExample[];
  policy: CapabilityPolicy;
};

export type ShapeProjection = {
  jsonSchema: unknown;
  fields: FieldProjection[];
  portability: {
    openapi: boolean;
    mcp: boolean;
    docs: boolean;
    reasons: string[];
  };
};

export type FieldProjection = {
  path: string[];
  type: string;
  description: string;
  required: boolean;
  secret: boolean;
  identifier: boolean;
  humanLabel: boolean;
  mutability: "immutable" | "create-only" | "mutable";
};

export type HttpSpec = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  bind: HttpBind;
};

export type HttpBind = {
  path: string[];
  query: string[];
  headers: Record<string, string>;
  body: true | string[] | false;
};
```

`effects` describes what the capability does for linting, help, docs, agent manifests, and default safety behavior. `policy` describes execution and conformance guard rails. They must agree: for example, `effects.kind: "delete"` or `effects.dangerous: true` cannot silently become a non-destructive conformance policy.

Auth/session generated commands use first-class auth effects:

```txt
auth-session-read
auth-session-write
auth-session-delete
auth-context-write
```

Do not encode auth commands as generic `write` or `exec`; generated surfaces and agents need to distinguish credential/session mutation from product data mutation.

## OpenAPI projection

OpenAPI generation consumes normalized HTTP capability data: `http.method`, `http.path`, `http.bind`, input/output shape projections, and field metadata.

Mapping:

| Binding | OpenAPI output |
|---|---|
| `bind.path` | path parameters; each must match a `{field}` template segment |
| `bind.query` | query parameters |
| `bind.headers` | header parameters, except auth/media headers handled by security/content |
| `bind.body` | `requestBody.content["application/json"]` |

Phase 3C emits OpenAPI only for `resource-operation` capabilities with an HTTP binding and normalized `surfaces.openapi === true`.

Local-only, `remote-http`, and hybrid workflow commands remain valid catalog capabilities but do not emit OpenAPI routes in this phase. Command projection can be added later once command execution maps to stable HTTP paths without flattening workflow semantics into fake resource operations.

OpenAPI is the handoff point for downstream HTTP ecosystem surfaces such as SDKs, Terraform providers, and a future Code Mode MCP server. Those downstream surfaces must consume the generated OpenAPI document and its digest, not the raw schema source or generated CLI code.

The generated CLI's MCP command tools are different: they are catalog-derived command surfaces and may include local or hybrid semantics that do not exist in OpenAPI. Do not use OpenAPI as the source for command MCP tools unless a later requirement explicitly narrows the behavior to HTTP-only commands.

## Generated surface manifest

`@lili/product` emits a generated surface manifest beside generated artifacts.

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
    source: "catalog" | "openapi";
    inputDigest: string;
    generationOptionsDigest: string;
    outputDigest: string;
    artifacts: string[];
  }>;
};
```

The manifest supports drift checks and later release provenance. It must not contain secret values, absolute local paths, timestamps that affect deterministic output, or raw runtime handles.

## Example product capability

```ts
Product.create({
  id: "workers",
  name: "Workers",
  version: "1.0.0",
  description: "Build and deploy serverless applications.",
})
  .resource("script", { label: "Worker script", path: "/workers/scripts", doc: "A deployed Worker script.", scope: "account" }, (resource) =>
    resource
      .field("id", Field.string("Script ID").identifier().immutable())
      .field("name", Field.string("Script name").humanLabel())
      .operation("list", {
        summary: "List Worker scripts",
        http: { method: "GET", path: "" },
        output: Shape.list("script"),
        permission: "workers:read",
        surfaces: { cli: { command: "workers script list" }, openapi: true, docs: true },
      })
  )
  .command("dev", Command.local({
    family: "dev",
    summary: "Run a local development server",
    input: Shape.object({ entrypoint: Field.string("Entrypoint file").required() }),
    handler: "wrangler.dev",
    needs: ["filesystem", "runtime"],
    surfaces: { cli: { command: "dev <entrypoint>" }, docs: true, openapi: false, agent: false },
  }));
```

## Canonical digest rules

Include:

- product id, name, version, and description
- vocabulary
- resource IDs and field metadata
- command IDs and families
- capability IDs
- execution modes
- input/output JSON Schema projections and field projections
- HTTP method/path/bind
- handler references
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
capability/id-stable
capability/output-required
capability/execution-required
capability/execution-binding
catalog/remote-base-url
capability/http-binding-complete
http/path-param-template
http/bind-coverage
http/bind-conflict
http/no-body-on-get-delete
capability/example-consistency
capability/output-portable
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
