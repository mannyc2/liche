# @lili/core

Bun-native CLI runtime for handwritten and generated Lili CLIs.

Use `@lili/core` when you want to own the command implementation directly and still get typed parsing, config discovery, JSON/JSONL/YAML/Markdown output envelopes, direct MCP tools, serializable command contracts, lifecycle events, auth/session helpers, and HTTP operation transport. Config-owned diagnostics and telemetry sinks are opt-in; nonessential renderers and client/vendor installers are not required core behavior.

```ts
import { defineCli, defineCommand, z } from "@lili/core";

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

## Runtime Surfaces

- `defineCli()` and `defineCommand()` define serializable command graphs for CLI, JSON, MCP, and command-contract surfaces.
- `Config.object()` loads typed project/user config files.
- `resolveAuth()`, `createFileSessionStore()`, and OAuth device helpers support generated and handwritten auth flows.
- `callHttpOperation()` is the shared outbound HTTP transport for remote commands.
- `runLocalDoctor()` reports local PATH and package-manager diagnostics.
- `createLocalTelemetrySink()` writes redacted JSONL lifecycle events only when a CLI opts in.

Core formats are `json`, `jsonl`, `yaml`, and `md`. Additional renderers belong in optional packages that consume `CommandContract` or generated Product artifacts.

`@lili/product` generates Product CLIs on top of this runtime. `@lili/build` compiles CLIs. `@lili/releases` packages compiled artifacts.
