# @lili/core

Bun-native CLI runtime for handwritten and generated Lili CLIs.

Use `@lili/core` when you want to own the command implementation directly and still get typed parsing, config discovery, JSON/JSONL/YAML/Markdown output envelopes, direct MCP tools, serializable command contracts, lifecycle events, auth/session helpers, and HTTP operation transport. Config-owned diagnostics and telemetry sinks are opt-in; nonessential renderers and client/vendor installers are not required core behavior.

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

- `Cli.create()` defines command trees for CLI, JSON, MCP, and command-contract surfaces.
- `Config.object()` loads typed project/user config files.
- `resolveAuth()`, `createFileSessionStore()`, and OAuth device helpers support generated and handwritten auth flows.
- `callHttpOperation()` is the shared outbound HTTP transport for remote commands.
- `runLocalDoctor()` reports local PATH and package-manager diagnostics.
- `createLocalTelemetrySink()` writes redacted JSONL lifecycle events only when a CLI opts in.

Core formats are `json`, `jsonl`, `yaml`, and `md`. Additional renderers belong in optional packages that consume `CommandContract` or generated Product artifacts.

`@lili/product` generates Product CLIs on top of this runtime. `@lili/build` compiles CLIs. `@lili/releases` packages compiled artifacts.
