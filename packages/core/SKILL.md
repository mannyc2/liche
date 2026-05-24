---
name: liche-core
description: Build and maintain Bun-native CLIs with @liche/core
---

# liche-core

Use this skill when building a handwritten CLI with `@liche/core`, changing the core runtime, or reviewing whether behavior belongs in core instead of Product or an adapter.

## Core Model

`@liche/core` is the runtime for declarative command graphs. It owns command registration, typed args/options/env parsing, core global flags, config loading once an extension declares a config contract, standard output formats, lifecycle events, direct MCP projection, packaged skill content, auth request application, and outbound HTTP operation transport.

Prefer core when the CLI implementation is handwritten and the command graph is already clear. Prefer `@liche/product` when one product catalog must generate multiple surfaces such as CLI, OpenAPI, MCP, docs, conformance, diagnostics, and discovery artifacts.

## Authoring Pattern

Use `defineCli()` plus `defineCommand()` data objects. Do not use fluent registration or runtime reflection as the authoring source of truth.

```ts
import { completions, config, configDoctor } from '@liche/extensions'
import { defineCli, defineCommand, defineGlobal, z } from '@liche/core'

const profile = defineGlobal({
  description: 'Profile to use',
  key: 'profile',
  type: 'string',
  valueLabel: 'name',
})

export const cli = defineCli({
  name: 'shipyard',
  version: '0.1.0',
  globals: [profile],
  extensions: [
    completions(),
    config({
      schema: z.object({
        defaultOrg: z.string().optional(),
      }),
    }),
    configDoctor(),
  ],
  commands: [
    defineCommand({
      path: ['deploy'],
      description: 'Deploy a service',
      input: {
        config: { org: 'defaultOrg' },
        options: z.object({
          org: z.string().optional(),
          entrypoint: z.string(),
        }),
      },
      output: z.object({ deploymentId: z.string() }),
      safety: {
        destructive: false,
        idempotent: false,
        interactive: 'never',
        openWorld: true,
        readOnly: false,
      },
      run({ ctx, input }) {
        return { deploymentId: `${ctx.global.profile ?? 'default'}-${input.options.entrypoint}` }
      },
    }),
  ],
})

if (import.meta.main) await cli.serve(Bun.argv.slice(2))
```

## Command Handlers

`run` should usually return plain data. The executor treats that as success data and validates it against `output` when declared.

Use `ctx.ok(data, meta)` only when the command needs result metadata such as CTA blocks. Use `ctx.error(error)` for expected structured failures. Throwing is for unexpected or lower-level parser/schema/auth/HTTP plumbing that the executor will normalize.

Valid handler returns:

- plain data, including `null`, objects, arrays, strings, numbers, and booleans
- `void`
- `Promise` of plain data or `void`
- `AsyncGenerator` for streaming output
- a branded `Result` from `ctx.ok()`, `ctx.error()`, `ok()`, or `fail()`

Do not hand-write result-shaped objects such as `{ ok: true, data }`; they are domain data unless created by the result factories.

Commands can set `format` to choose their default output format. Explicit global flags still win, so `--json` always returns JSON even when a command defaults to Markdown.

## Globals and Extensions

Use `defineGlobal()` or `defineCli({ globals })` for CLI-wide flags that belong to the command runtime. Globals feed parsing, help, and `ctx.global`; they do not run side effects, load config, or resolve auth.

Optional first-party helper commands live in `@liche/extensions`, not core:

- `completions()` adds `completions [bash|zsh|fish]`, which prints shell integration source to stdout.
- `config(...)` declares the config contract that core loads for command input binding.
- `configDoctor()` adds `config doctor`.
- `agents()` bundles MCP and skill installers.
- `mcpInstaller()` and `skillsInstaller()` can be installed separately.
- `auth()` declares standard auth globals and generated auth helper commands.

All extension helpers register as normal commands. They use the same option parsing, help, completions, lifecycle, output formatting, and MCP visibility rules as authored commands. Local helper commands are `agent: false`, so they are hidden from MCP `tools/list` and cannot be called through MCP by guessing the tool name.

Common user commands:

```sh
my-cli completions zsh
my-cli config doctor --json
my-cli mcp add --agent claude-code --json
my-cli skills add --agent cursor --json
```

`mcp add --json` and `skills add --json` emit normal command data:

```json
{ "path": "/path/to/file" }
```

Use `--full-output` when a caller needs the full `{ ok, data, error }` envelope.

## Packaged Skill Content

A CLI can provide authored agent guidance through core skill metadata. Use `@liche/extensions` when the CLI should also expose a local install command:

```ts
import { skillsInstaller } from '@liche/extensions'
import { defineCli } from '@liche/core'

defineCli({
  name: 'shipyard',
  extensions: [
    skillsInstaller({
      skill: {
        index: '# shipyard\nDeploy services.',
        markdown: '---\nname: shipyard\ndescription: Deploy services\n---\n\n# shipyard',
      },
    }),
  ],
  commands: [],
})
```

If `skill.markdown` or `skill.index` is absent, core reflects command contracts without executing handlers. Client-specific publishing workflows belong in adapters; the first-party installer is an extension command.

## Boundary Rules

- Add public core API only when a handwritten CLI or extension lane cannot solve the need through existing commands, config, lifecycle events, middleware, hooks, or `CommandContract`.
- Keep Product catalog generation, OpenAPI projection, conformance, generated docs, and generated local ops in `@liche/product`.
- Keep release packaging and publish planning in `@liche/releases`.
- Keep Bun build and compile planning in `@liche/build`.
- Keep nonessential renderers and broad vendor publishing workflows outside core.

## Verification

When changing core behavior, run:

```sh
bun run --filter @liche/core check
bun run --filter @liche/core test
```

When a change affects generated Product CLIs, package boundaries, or public docs, also run:

```sh
bun run check
bun run test
git diff --check
```
