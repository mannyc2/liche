# Application integration requirements

This document describes how an application developer uses the planned packages to expose an app to agents through a CLI and generated machine-readable surfaces.

The target example is a web app built with Vite and TanStack Router, but the rules are framework-agnostic.

## Mental model

```txt
application UI routes are for humans
product schema capabilities are for agents and automation
API routes implement HTTP-backed capabilities
the generated CLI invokes resource operations and commands
OpenAPI/MCP/docs describe filtered projections of the same catalog
```

Do not generate a CLI directly from frontend routes. A TanStack route tree describes navigation and rendering. It is not the same as a product capability catalog.

## Primary workflow

A developer with a Vite/TanStack app should:

1. Identify product capabilities: resources, commands, and bindings.
2. Define those capabilities in `lili.schema.ts`.
3. Implement matching API routes and local handlers in the app's server/runtime layer.
4. Generate CLI/OpenAPI/MCP/docs/Agent Skill/config surfaces with `@lili/build`.
5. Run server conformance against the local dev server and, when appropriate, deployed environments.
6. Compile and package the CLI with `@lili/build` and `@lili/releases`.

Example capabilities:

```txt
resources:
  projects.list
  projects.create
  deployments.status

commands:
  deploy
  doctor
  dev
  users.invite

bindings:
  kv_namespaces
  vars
```

## Owned contract rule

The schema is authoritative for product capabilities the application owner controls.

```txt
schema = source of truth for owned capability catalog
resource = durable noun with fields and operations
command = transient verb or workflow
binding = config declaration
http = server implementation of an HTTP-backed capability
handler = local or hybrid implementation of a command
```

The MVP supports an external server in the sense that the server is outside the CLI process. It does not default to third-party API transcription.

## Product-schema systems

A Cloudflare-style product-schema system maps cleanly to the lili plan when the source-of-truth boundary stays explicit:

```txt
owned product schema
  -> canonical lili catalog for capabilities
  -> generated CLI, OpenAPI, MCP command tools, Agent Skills, docs, and config schema
  -> generated OpenAPI downstream surfaces when those adapters exist
```

For this class of system, the schema may eventually feed product-specific surfaces such as Workers Binding RPC metadata, `wrangler.jsonc` fragments, dashboard metadata, product docs, SDK generators, Terraform providers, or a Code Mode MCP server.

Do not treat those surfaces as generic MVP behavior. Each product-specific surface needs a requirement that states:

- whether it consumes the canonical catalog or generated OpenAPI
- which metadata it requires beyond capability input/output schemas
- how drift is detected
- how conformance is proven against the owned API or platform runtime
- who owns publication and rollback

Generating the product API itself is a separate server-adapter track. Until that adapter exists, the app implements API routes manually and `li-build conform` proves the implementation matches the schema.

## Resources and commands

Resources and workflow commands are sibling concepts. CRUD-style helpers are convenience syntax for resources, not the core model.

Workflow commands such as `deploy`, `login`, `init`, `doctor`, `dev`, `migrate`, `generate`, `sync`, `open`, and `watch` must stay first-class. A generator, lint, or docs surface that assumes every capability is a resource action is wrong.

## Example schema

```ts
import { Command, Field, Product, Shape } from "@lili/build";

export default Product.create({
  id: "myapp",
  name: "My App",
  version: "1.0.0",
  description: "Project deployment and operations.",
})
  .resource("project", {
    label: "Project",
    path: "/api/projects",
    doc: "A deployed project.",
    scope: "account",
  }, (resource) =>
    resource
      .field("id", Field.string("Project ID").identifier().immutable())
      .field("name", Field.string("Project name").humanLabel())
      .operation("list", {
        summary: "List projects",
        http: { method: "GET", path: "" },
        output: Shape.list("project"),
        permission: "projects:read",
        surfaces: {
          cli: { command: "projects list" },
          docs: true,
          openapi: true,
        },
      })
  )
  .command("deploy", Command.workflow({
    summary: "Deploy a project",
    input: Shape.object({
      projectId: Field.string("Project ID").required(),
      target: Field.string("Deploy target").optional(),
    }),
    output: Shape.object({
      deploymentId: Field.string("Deployment ID").required(),
    }),
    handler: "myapp.deploy",
    permission: "projects:deploy",
    surfaces: {
      cli: { command: "deploy <projectId>" },
      docs: true,
      agent: true,
      openapi: false,
    },
  }));
```

The app implements `GET /api/projects` and the `myapp.deploy` handler manually in MVP. The implementation must conform to the schema.

## Package usage

### `@lili/core`

Use directly for handwritten CLIs or shared runtime behavior.

In an app integration, core owns:

- command execution
- standard output/error envelopes
- outbound HTTP operation transport
- response parsing and output validation

### `@lili/build`

Use to generate CLI and machine-readable surfaces from `lili.schema.ts`.

It generates:

- CLI command tree
- remote command wiring into core HTTP operation transport
- OpenAPI projection
- MCP tools
- docs/reference markdown
- Agent Skill/LLM surfaces
- config JSON Schema when configured
- generated surface manifest for drift and provenance
- conformance plans from capability examples and HTTP bindings

### `@lili/releases`

Use when shipping the CLI.

It packages final binaries and records runtime expectations such as:

```txt
MYAPP_API_URL
MYAPP_TOKEN
```

It can require or attach a conformance report for release provenance, but it does not own schema-to-server conformance logic.

## Framework boundary

No framework-specific package is required for Vite or TanStack Router.

The app only needs to expose HTTP routes and handlers that implement the product schema capabilities.

If the same `lili.schema.ts` can target:

- a Vite dev server
- a TanStack Start server
- a Bun server
- a serverless function
- a deployed production API

then the integration boundary is correct.

If the design requires a Vite plugin, TanStack plugin, browser client generator, or route-tree adapter in MVP, the design has drifted.

## Third-party APIs

Generating a CLI for an API the user does not own is a non-goal for MVP.

That use case needs different semantics:

- the schema is not authoritative over the upstream API
- generated OpenAPI would describe the adapter expectation, not the upstream truth
- conformance must compare against an external contract or observed behavior the user does not control

Keep that as a later adapter track.
