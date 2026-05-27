# Liche

Liche is a Bun-native toolkit for building CLIs that are useful to humans, scripts, and agents.

The current public packages are Bun-only source publications. They export TypeScript source and Bun entrypoints directly, require Bun `>= 1.3.0`, and do not publish `dist` or declaration artifacts.

```sh
bun add @liche/core
bun add @liche/extensions
bun add -d @liche/product @liche/build @liche/releases
```

The current package workflow is:

1. Write a CLI directly with `@liche/core`, or describe a product once with `@liche/product`.
2. Generate runtime surfaces from the Product catalog when you need CLI, OpenAPI, MCP, docs, conformance, diagnostics, or telemetry wiring.
3. Compile standalone binaries with `@liche/build`.
4. Render package-manager artifacts and plan publishing with `@liche/releases`.

## Highlights

- **One command, every surface.** The same `run({ input })` handler drives terminal argv, `cli.fetch()` HTTP, and MCP tools — no re-parsing, no per-transport result shapes.
- **Strict string-boundary codecs.** `arg.int()`, `arg.port()`, `arg.boolean()`, and friends reject the sloppy values plain `z.coerce.*` lets through (`"+3"`, `"1e3"`, `"Infinity"`, leading zeros, whitespace). `arg.fromString()` covers domain types — URLs, paths, ranges — with async decode and per-surface visibility.
- **Errors point at the caller.** A failed `arg.port()` doesn't just say "expected port at `$.port`" — the `FieldError` names where the value entered: `--port`, `$PORT`, `?port=`, an MCP tool argument, or a JSON body field.
- **Parse without running.** `parseInvocation(cli, argv)` resolves the command, decoded input, sources, and warnings without invoking the handler, emitting events, writing output, or exiting — for previews, tests, and tool servers that need the contract before dispatch.

## Handwritten CLI

Use `@liche/core` when the command tree is already clear and you want a normal TypeScript CLI.

```ts
import { arg, defineCli, defineCommand, run, z } from "@liche/core";

export const cli = defineCli({
  name: "shipyard",
  version: "0.1.0",
  commands: [
    defineCommand({
      path: ["deploy"],
      summary: "Deploy the shipyard",
      input: {
        options: z.object({
          entrypoint: z.string(),
          replicas: arg.positiveInt().default(1),
        }),
      },
      output: z.object({ deployment_id: z.string() }),
      run({ input }) {
        return {
          deployment_id: `dep-${input.options.entrypoint}-${input.options.replicas}`,
        };
      },
    }),
  ],
});

if (import.meta.main) await run(cli);
```

`@liche/core` covers the runtime essentials: declarative command graphs, strict input parsing, source-aware validation errors, the `{ ok, data, error }` result envelope across JSON/JSONL/YAML/Markdown renderers, lifecycle events, global inputs, extension composition, reflection helpers, side-effect-free invocation parsing, and outbound HTTP transport. Config authoring, completions, MCP/skills adapters, `mcp add`/`skills add` installers, auth/session workflows, and telemetry sinks ship as opt-in modules in `@liche/extensions`.

Core command handlers usually return plain data. Use `ctx.ok()` when a command needs result metadata, `ctx.error()` for expected structured failures, and async generators for streaming. Do not hand-write result-shaped objects; only the result factories create runtime envelopes.

Official extensions mount optional helper commands without making them part of the core runtime:

```ts
import { defineCli } from "@liche/core";
import { agents, completions, config, configDoctor, files } from "@liche/extensions";

defineCli({
  name: "shipyard",
  extensions: [
    completions(),
    config({ sources: [files({ files: ["shipyard.jsonc"] })] }),
    configDoctor(),
    agents(),
  ],
  commands: [],
});
```

Commands can set `format` to choose their default output format while still letting explicit globals win. `completions()` uses that path: it adds shell integration source generation and returns raw shell source by default because the command defaults to Markdown. `config()` registers the config input-source provider, `configDoctor()` adds `config doctor`, and `agents()` bundles MCP and skill installers. All extension helpers register as normal commands.

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

The examples cover handwritten CLIs, strict CLI input codecs, source-aware validation failures, generated Product CLIs, auth/context resolution, remote HTTP transport, compile/release shape, package renderers, and release dry-run workflows.

## Packages

- `@liche/core`: CLI runtime, strict arg codecs, source-aware validation errors, side-effect-free invocation parsing, global inputs, extension protocol, HTTP transport, command contracts, reflection helpers, and low-level redaction primitives.
- `@liche/extensions`: optional first-party config, completions, MCP/skills adapters with surface policy, agent helper installers, auth/session workflows, and telemetry adapters.
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
