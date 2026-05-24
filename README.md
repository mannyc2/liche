# Liche

Liche is a Bun-native toolkit for building CLIs that are useful to humans, scripts, and agents.

The v1 packages are Bun-only source publications. They export TypeScript source and Bun entrypoints directly, require Bun `>= 1.3.0`, and do not publish `dist` or declaration artifacts.

```sh
bun add @liche/core
bun add -d @liche/product @liche/build @liche/releases
```

The v1 workflow is:

1. Write a CLI directly with `@liche/core`, or describe a product once with `@liche/product`.
2. Generate runtime surfaces from the Product catalog when you need CLI, OpenAPI, MCP, docs, conformance, diagnostics, or telemetry wiring.
3. Compile standalone binaries with `@liche/build`.
4. Render package-manager artifacts and plan publishing with `@liche/releases`.

## Handwritten CLI

Use `@liche/core` when the command tree is already clear and you want a normal TypeScript CLI.

```ts
import { defineCli, defineCommand, z } from "@liche/core";

export const cli = defineCli({
  name: "shipyard",
  version: "0.1.0",
  commands: [
    defineCommand({
      path: ["deploy"],
      summary: "Deploy the shipyard",
      input: {
        options: z.object({ entrypoint: z.string() }),
      },
      output: z.object({ deployment_id: z.string() }),
      safety: {
        destructive: false,
        idempotent: false,
        interactive: "never",
        openWorld: true,
        readOnly: false,
      },
      run({ input }) {
        return { deployment_id: `dep-${input.options.entrypoint}` };
      },
    }),
  ],
});

if (import.meta.main) await cli.serve(Bun.argv.slice(2));
```

`@liche/core` provides declarative command graphs, typed args/options/env parsing, config loading, object-first result/error factories, JSON/JSONL/YAML/Markdown output envelopes, direct MCP stdio projection from command contracts, lifecycle events, auth/session helpers, and HTTP operation transport. Config-owned diagnostics such as `config doctor`, plus `mcp add` and `skills add`, are explicit opt-ins; broader provider workflows, telemetry sinks, and nonessential renderers stay outside the required core path.

## Product Schema

Use `@liche/product` when a product needs multiple generated surfaces from one catalog.

```ts
import { Auth, Command, Field, Runtime, Shape, defineProduct } from "@liche/product";

export default defineProduct({
  id: "workers",
  name: "Workers",
  version: "1.0.0",
  auth: Auth.none(),
  remote: { baseUrl: Runtime.env("WORKERS_API_BASE_URL") },
  commands: {
    deploy: Command.remoteHttp({
      summary: "Deploy a Worker",
      input: Shape.object({ name: Field.string("Worker name") }),
      output: Shape.object({ id: Field.string("Deployment ID") }),
      http: { method: "POST", path: "/deployments", bind: { body: true } },
    }),
  },
});
```

Generate and check surfaces:

```sh
liche-product generate ./product.ts --out ./generated
liche-product generate ./product.ts --out ./generated --check --json
```

Generated Product outputs include the CLI source, OpenAPI, command manifest, MCP tools, agent reference, docs reference, config schema, catalog JSON, discovery JSON, compile entrypoint, and drift manifest.

## Compile

Use `@liche/build` or `liche-build` to produce standalone Bun binaries with recorded compile flags and build provenance.

```sh
liche-build build ./src/cli.ts \
  --targets native \
  --release-version 0.1.0 \
  --commit 0000000 \
  --contract-digest sha256:example \
  --out ./dist/bin \
  --record ./dist/build-record.json \
  --json
```

## Package And Publish

Use `@liche/releases` or `liche-release` after binaries exist. It consumes build records and final binary bytes, renders package-manager artifacts, verifies final artifacts, and creates dry-run publish plans.

```sh
liche-release package ./dist/build-record.json --out ./dist/release --json
liche-release publish ./dist/release/manifest.json --ecosystems npm --dry-run --json
```

Release renderers cover npm, PyPI, Homebrew, and Scoop. Publisher planning is separate from rendering, so CI can consume generated handoff artifacts instead of reconstructing package order in workflow YAML.

## Examples

Run the example smoke suite:

```sh
bun test examples
```

The examples cover handwritten CLIs, generated Product CLIs, auth/context resolution, remote HTTP transport, compile/release shape, package renderers, and release dry-run workflows.

## Packages

- `@liche/core`: CLI runtime, config, auth/session, HTTP transport, command contracts, direct MCP projection, config-owned diagnostics, and opt-in local telemetry primitives.
- `@liche/product`: Product schema, generated surfaces, conformance, auth/session generated commands, local ops generated commands, catalog and discovery artifacts.
- `@liche/build`: Bun build and compile planning, compile flag profiles, build records, target resolution.
- `@liche/releases`: release manifest, binary verification, package renderers, package artifact verification, official-flow handoffs, publish and yank planning.

## Repository Checks

```sh
bun run check
bun run test
bun run test:examples
bun run release:check
```

`bun run release:check` is the local release-candidate gate. It does not publish packages or require network access. Run `bun run --silent release:names` separately near publication time to check current public npm registry status for the package names.
