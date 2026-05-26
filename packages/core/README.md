# @liche/core

Write a command as a typed function. Get a terminal CLI, an HTTP endpoint, and extension-driven agent adapters from it — sharing the same parsing, validation, and result envelope.

```ts
import { defineCommand, z } from "@liche/core";

const deploy = defineCommand({
  path: ["deploy"],
  summary: "Deploy the shipyard",
  input: { options: z.object({ entrypoint: z.string() }) },
  output: z.object({ deployment_id: z.string() }),
  run({ input }) {
    return { deployment_id: `dep-${input.options.entrypoint}` };
  },
});
```

`defineCli` collects one or more commands into a runnable CLI. With the `agents()` extension installed, that single `cli` projects onto all three transports:

```ts
import { defineCli } from "@liche/core";
import { agents } from "@liche/extensions";

export const cli = defineCli({
  name: "shipyard",
  version: "0.1.0",
  extensions: [agents()], // mounts an MCP server route on cli.fetch at /mcp
  commands: [deploy],
});

if (import.meta.main) await cli.serve();   // terminal
// or: Bun.serve({ fetch: cli.fetch });    // HTTP + MCP on one handler
```

Three ways to reach the same `deploy` command:

- **Terminal** — `shipyard deploy --entrypoint app`. Argv flags become the `options` object.
- **HTTP** — `POST /deploy` with body `{"entrypoint":"app"}`. URL path selects the command; query string and JSON body merge into `options`.
- **MCP** — with the `agents()` or `mcpServer()` extension installed, the `deploy` tool appears at the `/mcp` route on `cli.fetch`. JSON-RPC `tools/call` arguments become `options`.

All three run the same `run({ input })` handler, validate against the same Zod schema, and return the same `{ ok, data, error }` envelope.

## Transports

A *transport* is how an invocation reaches your command — what form the input arrives in, and how the result goes back out. The same command graph can be reached through any of these without changing the handler:

- `cli.serve(argv?)` — terminal transport. Reads `Bun.argv.slice(2)` by default, writes stdout/stderr, exits with a status code.
- `cli.fetch(request)` — HTTP transport with the Web `fetch` shape. Pass it to `Bun.serve({ fetch: cli.fetch })`. URL path selects the command; query string and JSON body become option inputs; `Accept: application/x-ndjson` streams.
- MCP tools and other agent surfaces project the same command graph through `@liche/extensions` installers.

## Defining commands

- `defineCli()` — root: `name`, `version`, `commands`, `globals`, `extensions`, `hooks`, `middleware`.
- `defineCommand()` — one command: `path`, `input` (`args`, `options`, `env`, `vars`), `output`, `run`, optional `interactive`, `format`, and single-segment string aliases.
- `defineGlobal()` — CLI-wide flag that feeds parsing, help, and `ctx.global`. Globals have a `key`, an optional `alias`, a `type`, and choose how they're exposed.

```ts
import { defineCli, defineCommand, defineGlobal, z } from "@liche/core";

const verbose = defineGlobal({
  key: "verbose",
  alias: "v",
  type: "boolean",
  expose: "context",
});

const status = defineCommand({
  path: ["status"],
  input: { options: z.object({ region: z.string().optional() }) },
  run: ({ input, ctx }) => ({
    region: input.options.region ?? null,
    verbose: ctx.global.verbose,
  }),
});

defineCli({
  name: "shipyard",
  version: "0.1.0",
  globals: [verbose],
  commands: [status],
});
```

## CLI input codecs

Numeric and boolean flags arrive from argv as strings. The `arg` namespace exposes strict Zod schema factories that reject the usual sloppy coercions (`"+3"`, `"1e3"`, `"Infinity"`, leading zeroes, whitespace) while staying composable with `.optional()`, `.default(...)`, and `.describe(...)`:

```ts
import { arg, defineCommand, z } from "@liche/core";

defineCommand({
  path: ["deploy"],
  input: {
    options: z.object({
      replicas: arg.positiveInt().default(1).describe("Number of replicas"),
      port: arg.port().default(3000),
      yes: arg.boolean().default(false),
    }),
  },
  run({ input }) {
    input.options.replicas; // number
  },
});
```

Available built-ins: `arg.number()`, `arg.int()`, `arg.positiveInt()`, `arg.port()`, `arg.boolean()`. Plain Zod schemas (`z.string()`, `z.enum(...)`, `z.object(...)`, refinements) remain valid; reach for `arg.*` only when a value crosses a string boundary (argv, env, query string, JSON body) and the runtime value is not a string.

## Returning results

Handlers usually return plain data; the executor validates it against `output` and wraps it in a success envelope:

```ts
defineCommand({ path: ["status"], run: () => ({ ready: true }) });
```

Use `ctx.ok(data, meta)` when you need result metadata such as CTA blocks, and `ctx.error(error)` for expected structured failures. `ok()` and `fail()` are the same primitives outside a `ctx`. Async generators are supported for streaming output.

```ts
defineCommand({
  path: ["deploy"],
  input: { options: z.object({ entrypoint: z.string() }) },
  run({ ctx, input }) {
    if (!input.options.entrypoint.startsWith("./")) {
      return ctx.error({
        code: "INVALID_ENTRYPOINT",
        message: "Entrypoint must be a relative path",
      });
    }
    return ctx.ok(
      { deployment_id: `dep-${input.options.entrypoint}` },
      { cta: { primary: { label: "View deployment", url: "https://example.com/deps" } } },
    );
  },
});
```

Never hand-write `{ ok, data, error }` objects — only these helpers produce real envelopes.

## Rendering output

Built-in renderers: `json`, `jsonl`, `yaml`, `md`, `csv`. Commands can set their default `format`; explicit output-control globals (e.g. `--json`) override it. Register a custom renderer with `defineOutputRenderer()` and expose it through `outputControls`:

```ts
import { defineCli, defineOutputRenderer, outputControls } from "@liche/core";

const xml = defineOutputRenderer({
  name: "xml",
  mediaType: "application/xml",
  render(value) {
    return toXml(value);
  },
});

defineCli({
  name: "shipyard",
  outputRenderers: [xml],
  extensions: [outputControls({ format: true, formats: ["json", "xml"] })],
  commands: [deploy],
});
```

## Built-in controls

Core has **no implicit behavior**. There is no automatic `--help`, `--version`, `--json`, or `--schema`. Install controls explicitly:

```ts
import { defineCli, help, outputControls, reflectionControls, version } from "@liche/core";

defineCli({
  name: "shipyard",
  extensions: [help(), version(), outputControls({ json: true }), reflectionControls({ schema: true })],
  commands: [],
});
```

## Extensions

`defineCli({ extensions })` composes bundles of commands, globals, input sources, output renderers, events, hooks, middleware, and packaged skill content.

Canonical optional helpers — config files, shell completions, MCP and skill installers, agent installation flows, auth, telemetry — live in [`@liche/extensions`](../extensions/README.md). For example, `agents()` bundles MCP server routing and the `mcp add` / `skills add` installers:

```ts
import { defineCli, help, version, outputControls } from "@liche/core";
import { agents } from "@liche/extensions";

defineCli({
  name: "shipyard",
  extensions: [
    help(),
    version(),
    outputControls({ json: true }),
    agents(),
  ],
  commands: [deploy],
});
```

One line, and `shipyard` is also an MCP server. Run `shipyard mcp add` to install it into Claude Code, Cursor, or any MCP-aware client. `shipyard skills add` publishes its bundled skill docs into the same environments, so agents discover the tool *and* know how to drive it. Live tool calls hit `cli.fetch` at `/mcp`. See the [`@liche/extensions` README](../extensions/README.md) for the full catalog.

## Lower-level primitives

- `callHttpOperation()` — *outbound* HTTP for remote commands that call external APIs. (Not to be confused with `cli.fetch`, which is the *inbound* HTTP server.)
- `secret()` — redaction primitive for values that should not stringify or inspect as raw secrets. Auth workflow and header helpers live in `@liche/auth`.

## Requirements

Bun `>= 1.3.0`. This package ships Bun-only TypeScript source — no `dist`, no declaration artifacts.

## Going further

- [`SKILL.md`](./SKILL.md) — guidance for agents authoring or maintaining `@liche/core` CLIs. A CLI can publish its own skill via `defineCli({ skill: { markdown, index } })`, installed by `skillsInstaller()`.
- [`@liche/extensions`](../extensions/README.md) — the canonical optional helper bundle.
- `@liche/product` generates Product CLIs on top of this runtime. `@liche/build` compiles CLIs. `@liche/releases` packages compiled artifacts.
