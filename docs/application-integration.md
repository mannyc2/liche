# Application integration

This document describes how an application developer uses the packages to expose an app to agents through a CLI and generated machine-readable surfaces.

The target example is a web app built with Vite and TanStack Router, but the rules are framework-agnostic.

## Mental model

```txt
application UI routes are for humans
product schema capabilities are for agents and automation
API routes implement HTTP-backed capabilities
the generated CLI invokes resource operations and commands
OpenAPI/MCP/docs describe filtered projections of the same catalog
```

CLIs are not generated from frontend routes. A TanStack route tree describes navigation and rendering; it is not the same as a product capability catalog.

## Primary workflow

For a Vite/TanStack app:

1. Identify product capabilities and durable preferences: resources, commands, general config, and bindings.
2. Define those capabilities in `liche.schema.ts`.
3. Implement matching API routes and local handlers in the app's server/runtime layer.
4. Generate CLI/OpenAPI/MCP/docs/Agent Skill/config surfaces with `@liche/product`.
5. Run server conformance against the local dev server and, when appropriate, deployed environments.
6. Compile the generated or handwritten CLI with `@liche/build`.
7. Package the final binaries with `@liche/releases`.

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
config = durable non-secret product preference
binding = product-specific structured declaration
http = server implementation of an HTTP-backed capability
handler = local or hybrid implementation of a command
```

The server is outside the CLI process, but the schema describes the application's own API, not arbitrary third-party APIs.

## Product-schema systems

A Cloudflare-style product-schema system maps cleanly when the source-of-truth boundary stays explicit:

```txt
owned product schema
  -> canonical liche catalog for capabilities
  -> generated CLI, OpenAPI, MCP command tools, Agent Skills, docs, and config schema
  -> generated OpenAPI downstream surfaces when those adapters exist
```

For this class of system, the schema may eventually feed product-specific surfaces such as Workers Binding RPC metadata, `wrangler.jsonc` fragments, dashboard metadata, product docs, SDK generators, Terraform providers, or a Code Mode MCP server.

Those surfaces are adapter-level work. Each product-specific surface needs a requirement that states:

- whether it consumes the canonical catalog or generated OpenAPI
- which metadata it requires beyond capability input/output schemas
- how drift is detected
- how conformance is proven against the owned API or platform runtime
- who owns publication and rollback

Generating the product API itself is a separate server-adapter track. The app implements API routes manually and `liche-product conform` proves the implementation matches the schema.

## Resources and commands

Resources and workflow commands are sibling concepts. CRUD-style helpers are convenience syntax for resources, not the core model.

Workflow commands such as `deploy`, `login`, `init`, `doctor`, `dev`, `migrate`, `generate`, `sync`, `open`, and `watch` are first-class. A generator, lint, or docs surface that assumes every capability is a resource action is wrong.

## Example schema

```ts
import { Auth, Command, createConfig, Field, Runtime, Shape, defineProduct } from "@liche/product";

export default defineProduct({
  id: "myapp",
  name: "My App",
  version: "1.0.0",
  description: "Project deployment and operations.",
  auth: Auth.bearer({
    id: "myapp",
    sources: [Auth.token.env("MYAPP_TOKEN")],
  }),
  config: createConfig({
    files: ["myapp.jsonc", "myapp.yaml", "myapp.toml"],
    fields: Shape.object({
      apiBaseUrl: Field.url("API base URL").default("https://api.myapp.dev"),
      defaultProject: Field.string("Default project ID").optional(),
    }),
  }),
  remote: { baseUrl: Runtime.config("apiBaseUrl") },
  permissions: {
    "projects:read": Auth.permission.scope("projects.read"),
    "projects:deploy": Auth.permission.scope("projects.deploy"),
  },
  resources: {
    project: {
      label: "Project",
      path: "/api/projects",
      doc: "A deployed project.",
      scope: "account",
      fields: {
        id: Field.string("Project ID").identifier().immutable(),
        name: Field.string("Project name").humanLabel(),
      },
      operations: {
        list: {
          summary: "List projects",
          http: { method: "GET", path: "" },
          output: Shape.list("project"),
          requires: { auth: true, permissions: ["projects:read"] },
          surfaces: {
            cli: { command: "projects list" },
            docs: true,
            openapi: true,
          },
        },
      },
    },
  },
  commands: {
    deploy: Command.workflow({
      summary: "Deploy a project",
      input: Shape.object({
        projectId: Field.string("Project ID").required(),
        target: Field.string("Deploy target").optional(),
      }),
      output: Shape.object({
        deploymentId: Field.string("Deployment ID").required(),
      }),
      handler: "myapp.deploy",
      requires: { auth: true, permissions: ["projects:deploy"] },
      surfaces: {
        cli: { command: "deploy <projectId>" },
        docs: true,
        agent: true,
        openapi: false,
      },
    }),
  },
});
```

The app implements `GET /api/projects` and the `myapp.deploy` handler manually. The implementation conforms to the schema.

## Package usage

### `@liche/core`

Used directly for handwritten CLIs or shared runtime behavior. In an app integration, core owns:

- command execution
- standard output/error envelopes
- outbound HTTP operation transport
- response parsing and output validation

### `@liche/product`

Used to generate CLI and machine-readable surfaces from `liche.schema.ts`. It generates:

- CLI command tree
- remote command wiring into core HTTP operation transport
- OpenAPI projection
- MCP tools
- docs/reference markdown
- Agent Skill/LLM surfaces
- config JSON Schema when general config or bindings are configured
- generated surface manifest for drift and provenance
- conformance plans from capability examples and HTTP bindings

### `@liche/build`

Used to compile a generated or handwritten CLI entrypoint into standalone Bun executables. It owns:

- `Bun.build()` compile orchestration
- target-specific compile options
- deterministic compile flag profiles
- build-time constants for release version, contract digest, source commit, and build-tool version
- path-independent compile provenance consumed by release manifests

### `@liche/releases`

Used when shipping the CLI. It packages final binaries and records runtime expectations such as:

```txt
MYAPP_API_URL
MYAPP_TOKEN
```

It can require or attach a conformance report for release provenance, but it does not own schema-to-server conformance logic.

## Framework boundary

No framework-specific package is required for Vite or TanStack Router. The app only needs to expose HTTP routes and handlers that implement the product schema capabilities.

The same `liche.schema.ts` can target:

- a Vite dev server
- a TanStack Start server
- a Bun server
- a serverless function
- a deployed production API

There are no Vite plugins, TanStack plugins, browser client generators, or route-tree adapters.

## Third-party APIs

Generating a CLI for an API you do not own is out of scope. That use case needs different semantics:

- the schema is not authoritative over the upstream API
- generated OpenAPI would describe the adapter expectation, not the upstream truth
- conformance must compare against an external contract or observed behavior the user does not control

This is adapter-level work, not part of the core integration story.
