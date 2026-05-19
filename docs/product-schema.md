# Product schema requirements

`@lili/build` is a product-schema compiler, not a wrapper around `@lili/core`.

The public authoring model is a catalog of product capabilities. Some capabilities are resources, some are workflow commands, and some are config bindings. Generated CLIs are one projection of that catalog. OpenAPI, command manifests, docs, Agent Skills, dashboard metadata, and config surfaces are other projections.

## Thesis

```txt
Product schema = canonical capability catalog
CLI = user-invokable projection
OpenAPI = HTTP-backed projection
Docs = public capability projection
Agent Skill = explicit safe automation projection
Config surfaces = binding projection
```

Do not force every meaningful product action into a CRUD resource operation. `deploy`, `migrate`, `login`, `init`, `doctor`, and `dev` are commands. A command may call HTTP APIs internally, but the user-facing capability is still the workflow.

## Public API

The public API should follow the existing static-class style used by `Cli.create()`:

```ts
import { Command, Field, Product, Shape } from "@lili/build";

export default Product.create({
  id: "workers",
  name: "Workers",
  version: "1.0.0",
  description: "Build and deploy serverless applications.",
  scope: { kind: "account", param: "account_id" },
})
  .resource("script", {
    label: "Worker script",
    path: "/workers/scripts",
    doc: "A deployed Worker script.",
    scope: "account",
  }, (resource) =>
    resource
      .field("id", Field.string("Script ID").identifier().immutable())
      .field("name", Field.string("Script name").humanLabel())
      .field("created_at", Field.datetime("Creation time").immutable().optional())
      .operation("list", {
        summary: "List Worker scripts",
        http: { method: "GET", path: "" },
        output: Shape.list("script"),
        permission: "workers:read",
        surfaces: {
          cli: { command: "workers script list" },
          docs: true,
          dashboard: { view: "table" },
          agent: true,
        },
      })
  )
  .command("deploy", Command.workflow({
    summary: "Deploy a Worker",
    input: Shape.object({
      entrypoint: Field.string("Entrypoint file").required(),
      environment: Field.string("Environment").optional(),
      dry_run: Field.boolean("Validate without publishing").optional(),
    }),
    output: Shape.object({
      deployment_id: Field.string("Deployment ID").required(),
      url: Field.string("Deployment URL").optional(),
    }),
    handler: "wrangler.deploy",
    steps: [
      { id: "bundle", label: "Bundle local source", uses: "local" },
      { id: "upload", label: "Upload assets", uses: "api" },
      { id: "activate", label: "Activate deployment", uses: "api" },
    ],
    permission: "workers:edit",
    surfaces: {
      cli: { command: "deploy <entrypoint>" },
      docs: true,
      agent: true,
      dashboard: { view: "action", placement: "page" },
      openapi: false,
    },
  }))
  .command("dev", Command.local({
    family: "dev",
    summary: "Run a local development server",
    input: Shape.object({
      entrypoint: Field.string("Entrypoint file").required(),
    }),
    handler: "wrangler.dev",
    needs: ["filesystem", "runtime"],
    surfaces: {
      cli: { command: "dev <entrypoint>" },
      docs: true,
      agent: false,
      dashboard: false,
      openapi: false,
    },
  }))
  .binding({
    key: "kv_namespaces",
    doc: "KV namespaces bound to the Worker.",
    fields: Shape.object({
      binding: Field.string("Variable name in code").required(),
      id: Field.string("KV namespace id").required(),
    }),
  });
```

The class API is authoring sugar. `@lili/build` must normalize it into a deterministic plain-data catalog before linting, digesting, or generating artifacts.

## Catalog model

Use product-facing names in public docs and APIs:

```ts
type ProductSchema = {
  id: string;
  name: string;
  version: string;
  description: string;
  scope?: ProductScope;
  authProviders: AuthProvider[];
  permissions: Record<string, Permission>;
  contexts: ProductContext[];
  resources: Resource[];
  commands: Command[];
  bindings: Binding[];
};

type Capability =
  | ResourceCapability
  | CommandCapability;
```

`Capability` is the flat unit consumed by generators. A resource operation and a command are both capabilities, but they retain their kind. Generators filter capabilities by predicate instead of assuming every capability belongs on every surface.

Internal implementation may use names such as `Catalog` or `CanonicalCatalog`, but avoid exposing `ProductIR` or `OperationIR` as the user-facing model.

Auth providers, permissions, and contexts are catalog nodes, not runtime session state. They describe what capabilities require and how generated runtime code should resolve credentials/context. Stored sessions, selected profiles, selected org/project values, token material, and account identities are runtime state and must not affect the catalog digest. Detailed requirements live in `docs/auth-session.md`.

## Resources

A resource is a durable noun with fields, identity, and explicit operations.

```ts
type Resource = {
  kind: "resource";
  id: string;
  label: string;
  path: string;
  fields: Shape;
  operations: ResourceOperation[];
};
```

CRUD is a convenience layer, not the full model. MVP resource actions may start with `list`, `get`, `create`, `update`, and `delete`, but the schema must leave room for resource-scoped actions such as `purge`, `rotate`, `rollback`, `enable`, `disable`, or `tail` without forcing them into fake resources.

## Commands

A command is a transient capability: workflow, auth, setup, diagnostic, or dev behavior. It has no resource identity and is not `GET`-able.

```ts
type Command = {
  kind: "command";
  id: string;
  family: "workflow" | "auth" | "setup" | "diagnostic" | "dev";
  summary: string;
  description?: string;
  input?: Shape;
  output?: Shape;
  requires?: CapabilityRequirements;
  execution: Execution;
  surfaces?: SurfaceHints;
};

type Execution =
  | { mode: "remote-http"; http: HttpSpec; handler?: string }
  | { mode: "local"; handler: string; needs?: LocalNeed[] }
  | { mode: "hybrid-workflow"; handler: string; http?: HttpSpec; steps?: WorkflowStep[] };
```

`steps` are documentation and progress metadata only. Execution orchestration lives in the handler. Do not add a declarative step runner until a real runtime consumes it.

Commands use their own `Shape.object(...)` input/output. They do not pick fields from a resource unless a helper explicitly expands that into an owned command shape.

## Auth, permissions, and context

Auth is opt-in and catalog-owned:

```ts
type AuthProvider =
  | { kind: "none" }
  | {
      kind: "bearer" | "apiKey" | "oauthDevice";
      id: string;
      sources: TokenSource[];
      header?: string;
      identity?: IdentityProbe;
      commands?: AuthCommandNames;
    };

type Permission = {
  id: string;
  scope?: string;
  description?: string;
};

type ProductContext = {
  id: string;
  label: string;
  parent?: string;
  select: {
    flag?: string;
    env?: string;
  };
};

type CapabilityRequirements = {
  auth?: true | { provider: string };
  contexts?: string[];
  permissions?: string[];
};
```

Capability requirements replace loose `permission?: string` before the product-schema API becomes public. Generated surfaces use requirements to explain missing auth/context, agent visibility, OpenAPI security, and release manifest runtime expectations. Server-side permission checks remain authoritative; local scope checks are best-effort only when a credential exposes scopes.

Generated auth commands such as `login`, `logout`, `whoami`, and `switch` are normal generated capabilities with `family: "auth"`. They are emitted only when the auth provider opts into the needed features. `whoami` may be agent-visible when it is local, read-only, and redacted; `login`, `logout`, and `switch` are not agent-visible by default.

## Fields and shapes

Field metadata is first-class because every projection needs it:

```ts
type Field = {
  type: "uuid" | "hostname" | "string" | "int" | "bool" | "enum" | "datetime";
  description: string;
  values?: string[];
  required: boolean;
  secret: boolean;
  identifier: boolean;
  humanLabel: boolean;
  mutability: "immutable" | "create-only" | "mutable";
};
```

This metadata must flow into the normalized catalog and generated surfaces:

- CLI help, redaction, and examples
- OpenAPI descriptions and extensions such as `x-lili-secret`, `x-lili-identifier`, and `x-lili-mutability`
- docs/reference markdown
- Agent Skill and command manifest safety hints
- dashboard metadata
- config and binding projections

## Surface hints

Surface membership is declared on the capability and normalized once. Generators consume normalized booleans and metadata; they do not reinterpret missing values independently.

Defaults:

| Surface | Default |
|---|---|
| `cli` | included unless `false` |
| `docs` | included unless `false` |
| `dashboard` | excluded unless configured |
| `agent` | excluded unless `true` |
| `openapi` for resource operation with HTTP | included unless `false` |
| `openapi` for `remote-http` command | included unless `false` |
| `openapi` for `local` command | excluded |
| `openapi` for `hybrid-workflow` command | excluded unless explicitly `true` and an HTTP trigger exists |

Agent exposure remains explicit and conservative. A capability is agent-visible only when `surfaces.agent === true`, it has stable typed input/output, and any required permission or safety policy is declared.

## Projection predicates

Generators filter the catalog:

```ts
function openApiCapabilities(catalog: Catalog): Capability[] {
  return catalog.capabilities.filter((capability) =>
    capability.surfaces.openapi === true &&
    capability.http !== undefined
  );
}

function cliCapabilities(catalog: Catalog): Capability[] {
  return catalog.capabilities.filter((capability) => capability.surfaces.cli !== false);
}

function agentCapabilities(catalog: Catalog): Capability[] {
  return catalog.capabilities.filter((capability) =>
    capability.surfaces.agent === true &&
    capability.requirements !== undefined &&
    capability.input.portable === true &&
    capability.output.portable === true
  );
}
```

OpenAPI is a projection of HTTP-backed capabilities. CLI is a projection of user-invokable capabilities. Docs are a projection of public capabilities. The product schema is the catalog that keeps them consistent without requiring every capability to look like CRUD.

## Server boundary

The product schema must be enforceable against real implementation code, but server runtime belongs behind an adapter boundary.

MVP `@lili/build` owns:

- product schema authoring API
- normalization into canonical catalog
- lints
- surface generation
- drift checks
- server conformance against owned HTTP deployments

MVP `@lili/build` does not own:

- generated server routes
- a generic product API runtime
- workflow step execution

A future server adapter may consume the same catalog and provide `implement(...)`, `boot()`, `request(...)`, or framework-specific route mounting. Until that adapter exists, apps implement handlers manually and `li-build conform` proves the implementation matches the schema.

## Refactor path

1. Add `Product`, `Resource`, `Command`, `Shape`, and `Field` class APIs.
2. Normalize product schemas into a plain deterministic `Catalog`.
3. Flatten resource operations and commands into `Capability[]`.
4. Move CLI generation from operation-specific input to capability input.
5. Generalize generation from one hardcoded CLI output to a surface emitter registry.
6. Add OpenAPI as the next surface emitter.
7. Keep resource helpers thin. They must lower into the same catalog as explicit resources and commands.

Verification:

- A workers fixture with one resource, `deploy`, `dev`, and one binding normalizes to a stable catalog.
- CLI generation includes both resource operations and top-level commands.
- OpenAPI generation includes HTTP resource operations and `remote-http` commands, excludes `dev`, and respects explicit `openapi: false` on `deploy`.
- Field metadata appears in CLI help/command manifest and OpenAPI schema extensions.
- Surface manifest records separate `cli` and `openapi` surface entries with independent output digests.
