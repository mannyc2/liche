# @liche/core

Bun-native CLI runtime for handwritten and generated Liche CLIs.

This package is published as Bun-only TypeScript source. Use Bun `>= 1.3.0`; the current package format does not ship `dist` or declaration artifacts.

Use `@liche/core` when you want to own the command implementation directly and still get typed parsing, JSON/JSONL/YAML/Markdown/CSV output envelopes, serializable command contracts, lifecycle events, global inputs, extension composition, and HTTP operation transport. Optional helpers such as config authoring, completions, MCP/skill installers, auth/session workflows, and telemetry sinks live in `@liche/extensions`.

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

- `defineCli()` and `defineCommand()` define serializable command graphs for CLI, JSON, MCP, and command-contract surfaces. Commands can attach `formats` for per-command result-stage renderers and accept single-segment aliases as bare strings.
- `defineGlobal()` and `defineCli({ globals })` declare CLI-wide flags that feed parsing, help, and `ctx.global`. Globals support `default` for pre-resolved fallback values.
- `defineCli({ extensions })` composes extension-provided commands, globals, input sources, output renderers, events, hooks, middleware, and packaged skill content.
- `help()`, `version()`, `outputControls()`, and `reflectionControls()` install the standard Core-owned globals explicitly. `help({ renderer })` can replace or wrap `defaultHelpRenderer()`. Per-command non-boolean options render with `<key>` value tokens in the help table; override via `z.string().meta({ valueLabel: 'path' })`.
- `defineOutputRenderer()` declares a named final-value renderer. `--json` selects the built-in `json` renderer through the same renderer registry that powers `--format`.
- `ctx.ok()`, `ctx.error()`, `ok()`, `fail()`, and `commandError()` produce the standard machine result/error objects without public error classes.
- `callHttpOperation()` is the shared outbound HTTP transport for remote commands.
- `secret()` and `applyAuth()` are low-level redaction and already-resolved auth/header primitives.

Core output renderers are `json`, `jsonl`, `yaml`, `md`, and `csv`. Additional renderers register through `CliExtension.outputRenderers`; expose them deliberately with `outputControls({ format: true, formats: ["json", "custom"] })`.

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

Commands can set `format` to choose their default output format. Explicit output-control globals still win when installed, so `--json` returns JSON even when a command defaults to Markdown.

## Extensions

Core has no default helper commands or implicit global flags. A plain `defineCli({ name, commands })` exposes authored commands; install controls explicitly for user-visible flags such as `--help`, `--version`, `--json`, `--format`, and `--schema`.

Official optional helpers are installed through `@liche/extensions`:

```ts
import { defineCli, help, outputControls, reflectionControls, version } from "@liche/core";
import { agents, completions, config, configDoctor, files } from "@liche/extensions";

defineCli({
  name: "shipyard",
  extensions: [
    help(),
    version(),
    outputControls({ json: true, fullOutput: true }),
    reflectionControls({ schema: true }),
    completions(),
    configDoctor(),
    config({ sources: [files({ files: ["shipyard.jsonc"] })] }),
    agents(),
  ],
  commands: [],
});
```

These helpers register as normal commands, so they use the same option parser, help rendering, completions, lifecycle events, output formatting, and MCP visibility rules as authored commands. `completions()` adds shell integration source generation. `config()` registers the config input-source provider, while `configDoctor()` adds `config doctor`. `agents()` bundles MCP and skill installers; the leaf `mcpInstaller()` and `skillsInstaller()` helpers are also available.

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
