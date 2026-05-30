---
name: liche-core
description: Build and maintain Bun-native CLIs with @liche/core
---

# liche-core

Use this skill when building a handwritten CLI with `@liche/core`, changing the core runtime, or reviewing whether behavior belongs in core instead of Product or an adapter.

## Core Model

`@liche/core` is the runtime for declarative command graphs. It owns command registration, typed args/options/env parsing, opt-in standard controls, standard output formats, lifecycle events, command contracts, packaged skill metadata, auth request application, and outbound HTTP operation transport.

Prefer core when the CLI implementation is handwritten and the command graph is already clear. Prefer `@liche/product` when one product catalog must generate multiple surfaces such as CLI, OpenAPI, MCP, docs, conformance, diagnostics, and discovery artifacts.

## Authoring Pattern

Use `defineCli()` plus `defineCommand()` data objects. Do not use fluent registration or runtime reflection as the authoring source of truth.

```ts
import { completions, config, configDoctor } from '@liche/extensions'
import { defineCli, defineCommand, defineGlobal, help, outputControls, reflectionControls, run, version, z } from '@liche/core'

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
    outputControls({ json: true }),
    reflectionControls({ schema: true }),
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
        options: z.object({
          org: z.string().optional(),
          entrypoint: z.string(),
        }),
        sources: {
          options: {
            org: [{ provider: 'config', path: 'defaultOrg' }],
          },
        },
      },
      output: z.object({ deploymentId: z.string() }),
      run({ ctx, input }) {
        return { deploymentId: `${ctx.global.profile ?? 'default'}-${input.options.entrypoint}` }
      },
    }),
  ],
})

if (import.meta.main) await run(cli)
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

Commands can set `format` to choose their default output format. Explicit output-control globals still win when installed, so `--json` returns JSON even when a command defaults to Markdown.

Use `formats` on `defineCommand` to attach a per-command renderer for one or more formats. The function runs at the `result` stage when the chosen output format matches; structured formats stay machine-readable.

```ts
defineCommand({
  path: ['report'],
  formats: {
    md: (value) => (value as { rows: Row[] }).rows.map((r) => `- ${r.label}: ${r.count}`).join('\n'),
  },
  run: () => ({ rows: getRows() }),
})
```

Aliases accept a bare string as shorthand for a single-segment alias:

```ts
defineCommand({ path: ['corpus', 'search'], aliases: ['find', ['s']], run })
```

## Documenting Options

Per-command option help reads `.describe()` from the schema. Without it the description column in `--help` is blank.

Numeric and boolean flags arrive from argv as strings. Prefer the `arg.*` namespace over `z.coerce.*` when a value crosses a CLI/env/fetch boundary — `arg.*` codecs use ASCII decimal grammar instead of broad `Number()` coercion and reject the usual sloppy inputs (`"+3"`, `"1e3"`, `"Infinity"`, leading zeroes, whitespace, etc.); `arg.boolean()` accepts only `"true"`/`"false"`/`"1"`/`"0"` plus JSON booleans. The helpers return ordinary Zod schemas, so `.optional()`, `.default(...)`, and `.describe(...)` compose normally:

```ts
import { arg, defineCommand, z } from '@liche/core'

defineCommand({
  path: ['deploy'],
  description: 'Deploy a service',
  input: {
    options: z.object({
      entrypoint: z.string().describe('Path to the service entrypoint'),
      replicas: arg.positiveInt().default(1).describe('Number of replicas'),
      port: arg.port().default(3000).describe('Listen port'),
      yes: arg.boolean().default(false).describe('Skip the confirmation prompt'),
    }),
  },
  // ...
})
```

Plain Zod schemas (`z.string()`, `z.enum(...)`, `z.object(...)`, refinements) remain valid; use them for already-typed or naturally string-shaped inputs. Reach for `arg.*` only when the value is crossing a string boundary and the runtime value is not a string.

Non-boolean options render as `--name <name>` in the help table by default. Override the placeholder via zod meta when the key reads poorly:

```ts
options: z.object({ entrypoint: z.string().meta({ valueLabel: 'path' }) })
// → --entrypoint <path>
```

## Middleware and Resource Lifecycle

Use `middleware()` to scope resources around the handler — open on entry, close in `finally`, share via `ctx.var`. Declare the shape with `vars` on `defineCli` so handlers can read it back type-safely.

```ts
import { defineCli, middleware, z } from '@liche/core'

const withDb = middleware(async (ctx, next) => {
  const db = await openDb(ctx.global.db)
  ctx.var['db'] = db
  try {
    await next()
  } finally {
    await db.close()
  }
})

defineCli({
  // ...
  middleware: [withDb],
  commands: [/* handlers read ctx.var.db (run-context scratch, untyped) */],
})
```

Middleware on `defineCli` wraps every command; attach `middleware` on individual `defineCommand` entries to scope it. `PrepareContextHook` is the lower-level alternative that runs before argv parsing and is the right place when the loaded value must feed input binding.

## Globals and Extensions

Use `defineGlobal()` or `defineCli({ globals })` for CLI-wide flags that belong to the command runtime. Globals feed parsing, help, and `ctx.global`; they do not run side effects, load config, or resolve auth.

Set `default` to a pre-resolved value (not an argv string). Defaults populate `ctx.global` when the flag is absent and render as `(default: …)` in help. `parse` does not run on the default.

```ts
defineGlobal({ key: 'db', type: 'string', default: 'twitte.sqlite', valueLabel: 'path' })
```

Help and version are first-class `defineCli` fields, on by default and registered internally through the public `TerminalHandler` contract: `--help` is always present (`help: false` opts out; `help: { renderer }` customizes explicit/fallback/validation help — wrap `defaultHelpRenderer()` to preserve the standard layout), and `--version` registers whenever a `version` string is set. `outputControls()` and `reflectionControls()` remain opt-in controls for `--json`/`--format` and `--schema`. Output renderers use `defineOutputRenderer()` and `CliExtension.outputRenderers`; expose custom format names with `outputControls({ format: true, formats: [...] })`. A minimal `defineCli()` reserves `--help` (and `--version` with a version string), but not `--json`, `--format`, `--schema`, or `--llms`.

Optional first-party helper commands live in `@liche/extensions`, not core:

- `completions()` adds `completions [bash|zsh|fish]`, which prints shell integration source to stdout.
- `config(...)` declares the config contract that core loads for command input binding.
- `configDoctor()` adds `config doctor`.
- `agents()` bundles MCP and skill installers.
- `mcpInstaller()` and `skillsInstaller()` can be installed separately.
- `auth()` declares standard auth globals and generated auth helper commands.

All extension helpers register as normal commands. They use the same option parsing, help, completions, lifecycle, output formatting, and adapter visibility rules as authored commands. MCP and skill adapters own their include/exclude policy; generated Product CLIs pass the catalog's agent-visible command list into those adapters.

Common user commands:

```sh
my-cli completions zsh
my-cli config doctor --json
my-cli mcp add --agent claude-code --json
my-cli skills add --agent cursor --json
```

`mcp add --json` and `skills add --json` emit the standard envelope:

```json
{ "ok": true, "data": { "path": "/path/to/file" }, "error": null }
```

Machine formats (`json`, `jsonl`, `yaml`) always emit the full envelope. Domain renderers (`md`, `csv`, custom) receive bare data.

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
