# @liche/core

Bun-native CLI runtime for handwritten and generated Liche CLIs.

This package is published as Bun-only TypeScript source. Use Bun `>= 1.3.0`; the current package format does not ship `dist` or declaration artifacts.

Use `@liche/core` when you want to own the command implementation directly and still get typed parsing, JSON/JSONL/YAML/Markdown output envelopes, direct MCP tools, serializable command contracts, lifecycle events, global inputs, extension composition, and HTTP operation transport. Optional helpers such as config authoring, completions, MCP/skill installers, auth/session workflows, and telemetry sinks live in `@liche/extensions`.

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

## Runtime Surfaces

- `defineCli()` and `defineCommand()` define serializable command graphs for CLI, JSON, MCP, and command-contract surfaces.
- `defineGlobal()` and `defineCli({ globals })` declare CLI-wide flags that feed parsing, help, and `ctx.global`.
- `defineCli({ extensions })` composes extension-provided commands, globals, config declarations, events, hooks, middleware, and packaged skill content.
- `ctx.ok()`, `ctx.error()`, `ok()`, `fail()`, and `commandError()` produce the standard machine result/error objects without public error classes.
- `callHttpOperation()` is the shared outbound HTTP transport for remote commands.
- `secret()` and `applyAuth()` are low-level redaction and already-resolved auth/header primitives.

Core formats are `json`, `jsonl`, `yaml`, and `md`. Additional renderers belong in optional packages that consume `CommandContract` or generated Product artifacts.

## Command Handlers

Handlers usually return plain data:

```ts
defineCommand({
  path: ["status"],
  run: () => ({ ready: true }),
});
```

The executor treats plain returned values as success data and validates them against `output` when declared. Use `ctx.ok(data, meta)` when the command needs result metadata such as CTA blocks, and use `ctx.error(error)` for expected structured failures. Async generators are supported for streaming output.

Do not hand-write result-shaped objects such as `{ ok: true, data }`; only `ctx.ok()`, `ctx.error()`, `ok()`, and `fail()` create runtime result envelopes.

Commands can set `format` to choose their default output format. Explicit global flags still win, so `--json` always returns JSON even when a command defaults to Markdown.

## Extensions

Core has no default helper commands. A plain `defineCli({ name, commands })` exposes authored commands plus core-owned help/version/global behavior only.

Official optional helpers are installed through `@liche/extensions`:

```ts
import { defineCli } from "@liche/core";
import { agents, completions, config, configDoctor } from "@liche/extensions";

defineCli({
  name: "shipyard",
  extensions: [
    completions(),
    configDoctor(),
    config({ files: ["shipyard.jsonc"] }),
    agents(),
  ],
  commands: [],
});
```

These helpers register as normal commands, so they use the same option parser, help rendering, completions, lifecycle events, output formatting, and MCP visibility rules as authored commands. `completions()` adds shell integration source generation. `config()` declares the core config contract, while `configDoctor()` adds `config doctor`. `agents()` bundles MCP and skill installers; the leaf `mcpInstaller()` and `skillsInstaller()` helpers are also available.

```text
shipyard completions zsh
shipyard config doctor --json
shipyard mcp add --agent claude-code --json
shipyard skills add --agent cursor --json
```

`mcp add --json` and `skills add --json` emit normal command data like `{ "path": "..." }`. Use `--full-output` for the full `{ ok, data, error }` envelope.

## Agent Guidance

This package includes [SKILL.md](./SKILL.md) for agents that are building or maintaining handwritten `@liche/core` CLIs. A CLI can also provide packaged skill content with `defineCli({ skill: { markdown, index } })` or through an extension; `skillsInstaller()` installs authored content when mounted.

`@liche/product` generates Product CLIs on top of this runtime. `@liche/build` compiles CLIs. `@liche/releases` packages compiled artifacts.
