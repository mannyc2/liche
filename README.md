# Lili

Lili is a Bun-native toolkit for building CLIs that are useful to humans, scripts, and agents.

The v1 workflow is:

1. Write a CLI directly with `@lili/core`, or describe a product once with `@lili/product`.
2. Generate runtime surfaces from the Product catalog when you need CLI, OpenAPI, MCP, docs, conformance, diagnostics, or telemetry wiring.
3. Compile standalone binaries with `@lili/build`.
4. Render package-manager artifacts and plan publishing with `@lili/releases`.

## Handwritten CLI

Use `@lili/core` when the command tree is already clear and you want a normal TypeScript CLI.

```ts
import { Cli, z } from "@lili/core";

export const cli = Cli.create({ name: "shipyard", version: "0.1.0" })
  .command("deploy", {
    options: z.object({ entrypoint: z.string() }),
    run(ctx) {
      return ctx.ok({ deployment_id: `dep-${ctx.options.entrypoint}` });
    },
  });

if (import.meta.main) await cli.serve(Bun.argv.slice(2));
```

`@lili/core` provides typed args/options/env parsing, config loading, JSON/JSONL/YAML/Markdown output envelopes, direct MCP stdio, serializable command contracts, lifecycle events, auth/session helpers, and HTTP operation transport. Config-owned diagnostics such as `config doctor` and telemetry sinks are opt-in; client/vendor installers and nonessential renderers stay outside the required core path.

## Product Schema

Use `@lili/product` when a product needs multiple generated surfaces from one catalog.

```ts
import { Auth, Command, Field, Product, Runtime, Shape } from "@lili/product";

export default Product.create({ id: "workers", name: "Workers", version: "1.0.0" })
  .auth(Auth.none())
  .remote({ baseUrl: Runtime.env("WORKERS_API_BASE_URL") })
  .command("deploy", Command.remoteHttp({
    summary: "Deploy a Worker",
    input: Shape.object({ name: Field.string("Worker name") }),
    output: Shape.object({ id: Field.string("Deployment ID") }),
    http: { method: "POST", path: "/deployments", bind: { body: true } },
  }));
```

Generate and check surfaces:

```sh
li-product generate ./product.ts --out ./generated
li-product generate ./product.ts --out ./generated --check --json
```

Generated Product outputs include the CLI source, OpenAPI, command manifest, MCP tools, agent reference, docs reference, config schema, catalog JSON, discovery JSON, compile entrypoint, and drift manifest.

## Compile

Use `@lili/build` or `li-build` to produce standalone Bun binaries with recorded compile flags and build provenance.

```sh
li-build build ./src/cli.ts \
  --targets native \
  --release-version 0.1.0 \
  --commit 0000000 \
  --contract-digest sha256:example \
  --out ./dist/bin \
  --record ./dist/build-record.json \
  --json
```

## Package And Publish

Use `@lili/releases` or `li-release` after binaries exist. It consumes build records and final binary bytes, renders package-manager artifacts, verifies final artifacts, and creates dry-run publish plans.

```sh
li-release package ./dist/build-record.json --out ./dist/release --json
li-release publish ./dist/release/manifest.json --ecosystems npm --dry-run --json
```

Release renderers cover npm, PyPI, Homebrew, and Scoop. Publisher planning is separate from rendering, so CI can consume generated handoff artifacts instead of reconstructing package order in workflow YAML.

## Examples

Run the example smoke suite:

```sh
bun test examples
```

The examples cover handwritten CLIs, generated Product CLIs, auth/context resolution, remote HTTP transport, compile/release shape, package renderers, and release dry-run workflows.

## Packages

- `@lili/core`: CLI runtime, config, auth/session, HTTP transport, command contracts, direct MCP projection, config-owned diagnostics, and opt-in local telemetry primitives.
- `@lili/product`: Product schema, generated surfaces, conformance, auth/session generated commands, local ops generated commands, catalog and discovery artifacts.
- `@lili/build`: Bun build and compile planning, compile flag profiles, build records, target resolution.
- `@lili/releases`: release manifest, binary verification, package renderers, package artifact verification, official-flow handoffs, publish and yank planning.

## Repository Checks

```sh
bun run check
bun run test
bun run test:examples
```
