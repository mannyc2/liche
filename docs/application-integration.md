# Application integration requirements

This document describes how an application developer uses the planned packages to expose an app to agents through a CLI and generated machine-readable surfaces.

The target example is a web app built with Vite and TanStack Router, but the rules are framework-agnostic.

## Mental model

```txt
application UI routes are for humans
lili operations are for agents and automation
API routes implement lili operation contracts
the generated CLI calls those API routes
OpenAPI/MCP/docs describe the same operation contracts
```

Do not generate a CLI directly from frontend routes. A TanStack route tree describes navigation and rendering. It is not the same as an operation contract.

## Primary workflow

A developer with a Vite/TanStack app should:

1. Identify agent-useful operations.
2. Define those operations in `lili.schema.ts`.
3. Implement matching API routes in the app's server layer.
4. Generate CLI/OpenAPI/MCP/docs/Agent Skill/config surfaces with `@lili/build`.
5. Run server conformance against the local dev server and, when appropriate, deployed environments.
6. Compile and package the CLI with `@lili/build` and `@lili/releases`.

Example operations:

```txt
projects.list
projects.create
deployments.status
logs.query
users.invite
```

## Owned contract rule

The schema is authoritative for operation contracts the application owner controls.

```txt
schema = source of truth for owned operation contract
local = in-process or local implementation of that operation
remote = HTTP deployment of that same owned operation
```

The MVP supports an external server in the sense that the server is outside the CLI process. It does not default to third-party API transcription.

## Product-schema systems

A Cloudflare-style product-schema system maps cleanly to the lili plan when the source-of-truth boundary stays explicit:

```txt
owned product schema
  -> canonical lili IR for operations
  -> generated CLI, OpenAPI, MCP command tools, Agent Skills, docs, and config schema
  -> generated OpenAPI downstream surfaces when those adapters exist
```

For this class of system, the schema may eventually feed product-specific surfaces such as Workers Binding RPC metadata, `wrangler.jsonc` fragments, dashboard metadata, product docs, SDK generators, Terraform providers, or a Code Mode MCP server.

Do not treat those surfaces as generic MVP behavior. Each product-specific surface needs a requirement that states:

- whether it consumes canonical IR or generated OpenAPI
- which metadata it requires beyond operation input/output schemas
- how drift is detected
- how conformance is proven against the owned API or platform runtime
- who owns publication and rollback

Generating the product API itself is a separate server-adapter track. Until that adapter exists, the app implements API routes manually and `li-build conform` proves the implementation matches the schema.

## Resource sugar

CRUD-style helpers are allowed only as optional authoring sugar. A helper such as `resource({ name: "project", operations: { list, get, delete } })` must compile down to the same operation records as hand-authored commands.

The command/operation contract remains the primitive. Workflow commands such as `deploy`, `login`, `init`, `doctor`, `dev`, `migrate`, `generate`, `sync`, `open`, and `watch` must stay first-class. A generator, lint, or docs surface that assumes every command is a resource action is wrong.

## Example schema

```ts
import { defineProgram, operation, vocabulary, z } from "@lili/build";

export default defineProgram({
  name: "myapp",
  version: "1.0.0",

  vocabulary: vocabulary({
    verbs: ["get", "list", "create", "update", "delete", "run"],
    flags: ["json", "local", "remote", "force"],
  }),

  remote: {
    baseUrl: { env: "MYAPP_API_URL" },
    auth: { type: "bearer", env: "MYAPP_TOKEN" },
  },

  operations: [
    operation({
      id: "projects.list",
      verb: "list",
      command: ["projects", "list"],
      description: "List projects",

      locality: {
        modes: ["remote"],
        default: "remote",
      },

      input: z.object({
        limit: z.number().int().min(1).max(100).default(20),
      }),

      output: z.object({
        projects: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
          }),
        ),
      }),

      remote: {
        method: "GET",
        path: "/api/projects",
        bind: {
          query: ["limit"],
        },
      },

      examples: [
        {
          argv: ["projects", "list", "--limit", "10", "--json"],
          input: { limit: 10 },
          response: {
            projects: [{ id: "proj_123", name: "Website" }],
          },
        },
      ],
    }),
  ],
});
```

The app implements `GET /api/projects` manually in MVP. The implementation must conform to the schema.

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
- conformance plans from operation examples and remote bindings

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

The app only needs to expose HTTP routes that implement the operation contract.

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
