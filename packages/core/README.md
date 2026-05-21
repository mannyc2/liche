# @lili/core

Bun-native CLI runtime for handwritten and generated Lili CLIs.

Use `@lili/core` when you want to own the command implementation directly and still get typed parsing, config discovery, output envelopes, MCP tools, command manifests, lifecycle events, auth/session helpers, HTTP operation transport, local diagnostics, and opt-in telemetry.

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

## Runtime Surfaces

- `Cli.create()` defines command trees for CLI, JSON, MCP, and command-manifest surfaces.
- `Config.object()` loads typed project/user config files.
- `resolveAuth()`, `createFileSessionStore()`, and OAuth device helpers support generated and handwritten auth flows.
- `callHttpOperation()` is the shared outbound HTTP transport for remote commands.
- `runLocalDoctor()` reports local PATH and package-manager diagnostics.
- `createLocalTelemetrySink()` writes redacted JSONL lifecycle events only when a CLI opts in.

`@lili/product` generates Product CLIs on top of this runtime. `@lili/build` compiles CLIs. `@lili/releases` packages compiled artifacts.
