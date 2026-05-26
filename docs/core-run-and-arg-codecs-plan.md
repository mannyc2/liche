# Core run and argument codecs plan

This plan covers two related `@liche/core` improvements:

- public command execution APIs that do not require consumers to compose `getCliState`, `selectCommand`, and `execute`
- first-class CLI argument codecs that replace repeated `z.coerce.number().int().positive().optional()` style schemas with reusable, strict, schema-projected primitives

The design is intentionally a hard cutover plan for the pre-`1.0.0` core API. It does not add legacy compatibility shims.

## Success criteria

1. Handwritten CLIs can use a top-level `run(cli, argv?)` entrypoint instead of spelling `await cli.serve(Bun.argv.slice(2))`.
2. Tests, extensions, and adapters can execute a CLI through a public, side-effect-controlled API that returns a `Result` without importing internal state or executor helpers.
3. Tests and adapters can parse and resolve an invocation without running the handler through `parseInvocation`.
4. CLI authors can declare strict numeric and boolean argument schemas through `arg.*` helpers that remain ordinary Zod schemas.
5. Custom string decoders can produce richer handler values while command contracts, help, fetch, JSON Schema, and extension transports such as MCP still describe the external input shape.
6. Validation errors identify the failing field and the source of the value: argv flag, positional, env, config provider, fetch query/body, extension transport, or programmatic input.

## External evidence

- Zod codecs support divergent input and output types through `z.codec(inputSchema, outputSchema, { decode, encode })`, including async decode variants: <https://zod.dev/codecs>
- Zod JSON Schema conversion supports `io: "input"` so projection can describe boundary input instead of decoded handler output: <https://zod.dev/json-schema>
- Zod metadata/registries support schema-attached display metadata, but metadata copied into JSON Schema must be handled deliberately: <https://zod.dev/metadata>
- Zod error issues carry structured fields such as `code`, `path`, and `expected`, so Core should not infer error facts from formatted messages: <https://zod.dev/error-customization>
- Bun exposes process argv as `Bun.argv`, including executable and script path, which makes `Bun.argv.slice(2)` the default CLI argument vector for source-run CLIs: <https://bun.sh/docs/guides/process/argv>
- Bun automatically loads `.env` files and exposes env through `process.env`, `Bun.env`, and `import.meta.env`; Core tests must continue injecting env explicitly when asserting source behavior: <https://bun.sh/docs/runtime/environment-variables>
- Bun child process APIs provide stdout/stderr capture, exit-code assertions, and PTY support for TTY-specific behavior: <https://bun.sh/docs/runtime/child-process>

## Boundary decisions

### Keep this in core

These improvements belong in `@liche/core` because moving them out would duplicate parser, executor, schema, provenance, and error-envelope behavior:

- `run`, `dispatch`, and `parseInvocation` are reusable runtime lanes over command selection and execution.
- `arg` helpers are Zod schemas that feed the existing command input contract.
- source-aware validation errors belong to the common executor path because CLI, fetch, config, generated commands, and extension-driven transports need the same failure shape.

### Keep this out of core

These remain extension or application concerns:

- broad file, directory, glob, URL-fetch, stdin, and HTTP-body batteries
- vendor-specific shell completion or agent publishing behavior
- config file discovery and config mutation UX
- Product catalog generation, OpenAPI emission policy, and server conformance

Core may expose primitives that make those features possible. It should not own their workflows.

## Cleanup audit before freezing the invocation API

The follow-up audit is mostly right, but not every item should block `run` / `dispatch` / `parseInvocation`.

The prep blocker is vocabulary that would become public API if `dispatch` lands first:

- Core currently enumerates MCP in shared types: `InvocationKind`, `CliEventType`, `CliEventSurface.kind`, and `CliEvent.mcp`.
- Runtime machine-output mode and static agent-surface discovery both use the field name `agent`.
- `OutputPolicy` also says `agent-only` even though the behavior is machine-output visibility, not agent identity.

Fix those names before widening the public invocation API. Otherwise `DispatchOptions`, `RunContext`, `CliEvent`, command contracts, generated CLI source, and first-party extensions will all encode the wrong vocabulary.

The cleanup direction (as shipped):

- **Delete `InvocationKind` from core.** Core never branches on the value; it is pure observability tagging that had accreted into `MiddlewareContext`, `RunContext`, `CliEvent`, and `ExecuteInput`. After deletion, no runtime context field tags "where this call came from"; subscribers and commands that care derive their own tag (CI from env via `detectInvocation` in `@liche/auth`, MCP from the wrapping lane's `LICHE_INVOCATION` env override). The type now lives in `@liche/auth`, the only consumer that actually branches on it.
- Replace `CliEvent.mcp` with a generic extension-safe metadata bag `attributes?: Record<string, unknown>`. MCP emits `{ mcpMethod, mcpToolCount }` there, and telemetry decides which extension attributes it forwards. `CliEventSurface.kind === 'mcp'` is removed; surfaces stay a closed core-owned set. `CliEventType` opens to `(string & {})` so extensions can emit their own event names.
- **Delete the synthesized runtime boolean entirely.** A field originally named `agent` and renamed mid-cleanup to `machine` turned out to be derived state (`!isTty || formatExplicit`) that no runtime caller actually read for branching — every site was a write. It came off `RunContext`, `MiddlewareContext`, `CliEvent`, and `ExecuteInput`. Consumers needing machine-output mode derive it from `isTty` + `formatExplicit` at the read site. The real primitives stay on context: `isTty`, `formatExplicit`, `format`.
- Replace static command visibility (`CommandContract.agent?: boolean`, where `false` meant "hide from agents") with a **flat `interactive?: boolean`** on `CommandContract` and `CommandDefinition`. Polarity flips: the old `agent: false` becomes `interactive: true`. The new name describes the command, not the discovery surface — only commands that genuinely require human interaction (prompts, TTY flows) get the flag. Setup/management commands that were marked `agent: false` for "hide from MCP discovery" reasons are unmarked and become MCP-visible. MCP/skills-runtime filters became `!command.interactive`.
- Rename `OutputPolicy` value `agent-only` to `machine-only`.

Do not start by collapsing all command representations. The six-shape command pipeline is real, but it is a deeper internal-shape problem. The public API risk is exposing or depending on those shapes. `dispatch` and `parseInvocation` should hide `CliState`, `Entry`, `SelectedCommand`, and `CommandRuntime` from callers; a later internal refactor can collapse shapes once the public lanes are in place.

Declared command `env` and env-backed option sources stay distinct *authoring surfaces*: `input.env` is a typed env-shape requirement, `input.sources.options` binds named provider values into options. The internal cleanup is that both paths read through the same `envProvider` instance so env reads have one chokepoint (and one provenance story via `ctx.sources`). No user-visible API merges.

`CommandError` already has a requirement doc in `docs/error-handling.md`, so the problem is not undocumented vocabulary. The remaining issue is whether `commandError()` should synthesize Problem Details defaults automatically; that can be reviewed with the source-aware validation work, not before `dispatch`.

## Target public API

### `run`

```ts
await run(cli)
await run(cli, argv)
await run(cli, argv, options)
```

`run` is the effectful command-line entrypoint. It writes stdout/stderr and exits through the same behavior as `cli.serve`. With no `argv`, it uses `Bun.argv.slice(2)`.

This is mostly ergonomic, but it gives the package a cmd-ts-style entrypoint without teaching users to reach for `Bun.argv` directly.

### `dispatch`

```ts
const result = await dispatch(cli, ["deploy", "--replicas", "3"], {
  env,
  format: "json",
  isTty: false,
})
```

`dispatch` is the public result-returning execution API. It runs command selection, global parsing, input-source resolution, middleware, hooks, handler execution, output validation, lifecycle events, streaming collection, and error normalization, then returns `Result`.

It must not write stdout/stderr or call `process.exit`. It publishes a generic primitive for any extension or adapter that needs to drive a command without composing `getCliState`, `selectCommand`, `execute`, and lifecycle helpers.

For streaming handlers, `dispatch` always returns the collected chunk array as `Result.data`. It also accepts `onChunk?: (chunk) => Awaitable<void>` for callers that want progressive delivery. This matches the current executor behavior and keeps `serve`, `fetch`, and `dispatch` on one streaming path.

`dispatch` only executes runnable commands. It does not render help, version, schema, completions, or extension serve-handlers. Those are `serve` display concerns. Non-runnable invocations return `Result.fail` instead of throwing:

- global parsing failures return `PARSE_ERROR`
- unknown flag-like tokens with no selected command return `PARSE_ERROR`
- unknown command paths return `COMMAND_NOT_FOUND`
- `--help`, `--version`, `--schema`, completion requests, and extension serve-handler flags return `PARSE_ERROR` with a message that the control is only available through `serve`
- selected entries without a runnable command handler keep using `COMMAND_NOT_RUNNABLE`

### `parseInvocation`

```ts
const parsed = await parseInvocation(cli, ["deploy", "--replicas", "3"], { env })
```

`parseInvocation` resolves one invocation without running the handler. The name is intentionally not `parse`: Core already has public `parseSchema`, internal parser helpers, and Zod's own parse vocabulary. A specific name avoids a vague root export and makes the public API easier to grep.

The return value should include:

- selected command path and serializable command contract
- parsed globals and selected output format
- decoded args, options, env, and vars
- source provenance for option values
- validation warnings such as deprecated options

No `parse` alias should be exported. If a shorter alias is wanted later, it needs a separate public API review.

### `arg`

```ts
import { arg, defineCommand, z } from "@liche/core"

defineCommand({
  path: ["deploy"],
  input: {
    options: z.object({
      replicas: arg.positiveInt().optional(),
      port: arg.port().default(3000),
      yes: arg.boolean().default(false),
    }),
  },
  run({ input }) {
    input.options.replicas
    // number | undefined
  },
})
```

`arg` is a namespace of Zod schema factories. It must not become a separate type system, and command authors are not forced to use it. Existing `z` schemas remain valid anywhere command input accepts schemas today.

Use `arg.*` when the value is crossing a CLI-like string boundary and the intended runtime value is not a string. Keep using ordinary Zod for already-typed or naturally string-shaped inputs such as `z.string()`, `z.enum(...)`, `z.object(...)`, literals, unions, refinements, and application-specific schemas. Public CLI examples should prefer `arg.number()`, `arg.int()`, `arg.positiveInt()`, `arg.port()`, and `arg.boolean()` over broad `z.coerce.*` forms because the `arg` helpers define stricter CLI grammar and better error behavior. Users may still write plain Zod coercions if they intentionally want Zod's coercion semantics.

Initial helpers:

| Helper | Output | External input policy |
|---|---|---|
| `arg.number()` | `number` | decimal string or finite JSON number |
| `arg.int()` | safe integer `number` | integer string or JSON integer |
| `arg.positiveInt()` | positive safe integer `number` | positive integer string or JSON integer |
| `arg.port()` | integer `1..65535` | integer string or JSON integer |
| `arg.boolean()` | `boolean` | `true`/`false` strings, `1`/`0` strings, or JSON boolean |
| `arg.fromString()` | custom output | string input only unless the helper explicitly accepts another input schema |

Numeric helpers must not use broad JavaScript coercion. They reject empty strings, strings with leading or trailing whitespace, floats for integer helpers, booleans, arrays, objects, `null`, `NaN`, and infinity.

String grammar is ASCII decimal only:

- `arg.number()` accepts `-?(0|[1-9][0-9]*)(\.[0-9]+)?`.
- `arg.int()` accepts `-?(0|[1-9][0-9]*)` and then enforces JavaScript safe-integer range.
- `arg.positiveInt()` accepts `[1-9][0-9]*` and then enforces safe-integer range.
- `arg.port()` uses the positive-integer grammar and range `1..65535`.
- Leading `+`, leading zeroes other than `"0"`, numeric separators, exponent notation, `Infinity`, `NaN`, `.5`, and `5.` are rejected.
- JSON number inputs are accepted when finite and within the helper's integer/range constraints; JSON numbers do not use the string grammar.

Boolean string grammar is exact: only `"true"`, `"false"`, `"1"`, and `"0"` are accepted. Uppercase variants, `"yes"`, `"no"`, and other truthy/falsy strings are rejected.

Custom decoder shape:

```ts
const readStream = arg.fromString({
  input: z.string().meta({ valueLabel: "file" }),
  output: z.instanceof(ReadableStream),
  surface: "cli",
  decode: async (path, ctx) => {
    // validate and return the runtime value
  },
})
```

Runtime-only custom decoders are allowed for CLI execution, but they need an explicit surface policy before they are exposed through fetch or extension transports such as MCP.

`arg.fromString()` accepts an optional `encode` function. When `encode` is omitted, Core supplies a throwing encoder and treats the codec as runtime-only. That means runtime defaults cannot be rendered, `z.encode()` is not a supported operation for that schema, and transport exposure must stay limited by the surface policy.

Default policy:

- `arg.fromString()` without an explicit surface policy is CLI/programmatic-dispatch only.
- A command using a CLI-only runtime codec must set `agent: false`, otherwise `defineCli` fails. Extension-driven tool discovery must not advertise tools that cannot be called.
- `cli.fetch()` remains a generic command-dispatch surface. If it reaches a command whose input contains a codec unsupported on `fetch`, execution returns a structured `UNSUPPORTED_SURFACE` error instead of attempting partial decoding.
- `dispatch()` defaults to the programmatic agent invocation and may execute CLI-only codecs unless the caller sets a restricted invocation such as `{ invocation: "mcp" }`.
- A codec can opt into `fetch`, `all`, or named extension transports such as `mcp` only when its decode result is safe for that surface and all required transport behavior is documented.

## Internal architecture changes

### 1. Split effectful serving from invocation preparation

Extract a reusable invocation pipeline:

```txt
argv/global parse
-> command selection
-> prepare context hooks
-> source-aware raw input assembly
-> schema decode/validation
-> middleware/hook execution
-> handler execution
-> output validation
-> Result
```

`serveCli`, `fetchCli`, `run`, `dispatch`, and `parseInvocation` should call the shared pipeline with different effect adapters.

Start by extracting the existing private `runPrepareContext` and `contextGlobals` helpers from `serve.ts` into `packages/core/src/cli/invocation.ts`. Do not re-export them from `serve.ts` and do not duplicate them into `dispatch.ts`; `serve.ts` should remain an adapter, not the owner of shared invocation preparation.

Place public `run` and `dispatch` in `packages/core/src/cli/dispatch.ts`. `dispatch.ts` should unwrap the `CliInstance` to its internal state, prepare the invocation, and call the shared executor. `run` belongs beside `dispatch` because it is the effectful wrapper over the same public invocation lane; keeping both in one file is clearer than adding a trivial standalone `run.ts`.

### 2. Add async schema parsing

Core currently has sync `parseSchema`. Add `parseSchemaAsync` and use it in command input and output validation paths. Keep sync `parseSchema` only for places that are intentionally sync, such as small utility tests and non-command projection helpers.

This is required because Zod codecs can have async decoders.

### 3. Track raw value source during input assembly

Extend the parser/input-source boundary so each raw value carries source metadata before schema decoding:

```ts
type RawInputValue = {
  value: unknown
  source:
    | { kind: "argv"; flag?: string; positional?: number }
    | { kind: "env"; name: string }
    | { kind: "provider"; provider: string; path: string }
    | { kind: "fetch-query"; key: string }
    | { kind: "fetch-body"; key: string }
    | { kind: "extension"; transport: string; key: string }
    | { kind: "programmatic"; key: string }
}
```

The public `SourceInspector` can stay focused on option provenance, but validation error normalization should be able to attach the raw source to a field error.

### 4. Project input schemas, not runtime outputs

Command contracts must continue using `z.toJSONSchema(schema, { io: "input" })`. Tests should lock that:

- `arg.int()` projects as string-or-integer boundary input, not just decoded `number`.
- `arg.fromString()` projects as its declared input schema.
- runtime-only outputs do not leak unrepresentable types into JSON Schema.

### 5. Split public projection metadata from runtime metadata

Use `.meta()` only for metadata that may be projected through JSON Schema, help, command manifests, extension tool schemas, generated docs, or AI-facing structured outputs.

Allowed public projection metadata includes:

- `description`
- `deprecated`
- `examples`
- `valueLabel`

Runtime-only Core metadata must use a private Core registry, not `.meta()` / `z.globalRegistry`. That includes execution policy, decoder identity, source policy, runtime-only flags, and unsupported-surface behavior. Zod's `.meta()` writes to `z.globalRegistry`, and Zod JSON Schema generation consumes that registry, so private executor facts stored there can leak into public schemas.

When Core intentionally needs a Liche-specific fact to appear in JSON Schema, use an explicit `x-liche-*` key. Otherwise keep it in a private registry:

```ts
const runtimeArgMeta = z.registry<{
  codecKind?: "arg.boolean" | "arg.fromString" | "arg.int" | "arg.number" | "arg.port" | "arg.positiveInt"
  runtimeOnly?: boolean
  surface?: "all" | "cli" | "fetch" | { kind: "extension"; transport: string }
}>()

const schema = z.string()
  .meta({ description: "File to read", valueLabel: "file" })
  .register(runtimeArgMeta, { codecKind: "arg.fromString", runtimeOnly: true, surface: "cli" })
```

Implementation detail: registry entries are keyed by schema instance. Zod's `.register()` returns the same schema instance, while `.meta()` returns a new instance. Core `arg.*` factories should control the final schema instance and registration order so private metadata stays attached to the schema that command authors actually use.

### 6. Normalize Zod errors structurally

Update error normalization to use Zod issue fields directly. Stop parsing `received` from issue messages.

Field errors should preserve:

- JSON path
- issue code
- expected value/type when available
- received value/type when available
- message
- missing flag
- raw input source when available

## Reviewable implementation sequence

### Commit 0A: Public vocabulary cleanup

Goal: remove extension-specific and overloaded names from public core types, and delete the `InvocationKind` observability enum, before the invocation API is widened.

Motivation: a working-tree audit found that core type definitions know about specific extensions (MCP appears as `InvocationKind = ...'mcp'`, `CliEventSurface.kind = ...'mcp'`, `CliEvent.mcp`, and the MCP-discovery gate is named `CommandContract.agent`); that two completely different runtime concepts both go by the name `agent` (`MiddlewareContext.agent` = machine-output mode vs `CommandContract.agent` = MCP visibility); and that `InvocationKind` itself is pure observability tagging — core has no branch on its value. All three leaks make Commit 1's "generic primitive" framing dishonest.

This commit is a deletion-and-rename pass. It does not redesign the replaced concepts; replacements that need their own design come in later slices once we see what actually breaks.

Decisions as shipped (the cleanup went further than originally planned — two of the renames turned into outright deletions after audit):

- **Delete `InvocationKind` from core.** Removes the type from `types.ts` and the duplicate in `auth/types.ts`. Drops `MiddlewareContext.invocation`, `RunContext.invocation`, `CliEvent.invocation`, and `ExecuteInput.invocation`. The `isCiEnv` heuristic in `serve.ts` is deleted with it (its only consumer was the `invocation` field). The type is moved to `@liche/auth` since auth is the only consumer that actually branches on the value. A new `detectInvocation({ sources })` helper in `@liche/auth` reads CI from env via `ctx.sources.value('env', ...)` and honors a `LICHE_INVOCATION=mcp|agent|cli|ci` env override (set by the MCP server when it executes commands). Core no longer enumerates.
- **Remove `CliEvent.mcp` and `kind: 'mcp'` from `CliEventSurface`.** Add `attributes?: Record<string, unknown>` to `CliEvent` as a generic extension-safe metadata bag. MCP emits `{ mcpMethod, mcpToolCount }` there; telemetry decides which attributes it forwards. `CliEventSurface.kind` stays a closed core-owned set. `CliEventType` opens to `(string & {})` so extension event names (`mcp.tool_call.started`, etc.) round-trip without needing core to enumerate them.
- **Delete the synthesized runtime boolean entirely.** The audit started by renaming `agent: boolean` → `machine: boolean` on `RunContext`/`MiddlewareContext`/`CliEvent`/`ExecuteInput`, but a follow-up pass found no caller actually *reads* it for branching — every site was a write of `!isTty || formatExplicit`. It came off all four shapes. The real primitives stay on context: `isTty`, `formatExplicit`, `format`. Consumers who want "machine output mode" derive `!isTty || formatExplicit` at the read site. Lifecycle events carry `isTty` instead.
- **Replace `CommandContract.agent` with a flat `interactive?: boolean`.** The original audit proposed nesting under `surfaces.agent` for Product-catalog parity. The audit-on-audit decided that conflated two concepts (one was Product's surface enumeration; one was core's discovery gate) and went flatter with semantic accuracy: `interactive: true` describes the command (needs a human/TTY/prompt), not its visibility on a surface. Polarity flips relative to the old `agent: false`. MCP/skills-runtime filters became `!command.interactive`. Setup/management commands previously marked `agent: false` for "hide from MCP" reasons (telemetry status, config doctor, completions install, mcp install, skills add/list) are unmarked under the new semantic and become MCP-visible.
- **Rename `OutputPolicy` value `agent-only` to `machine-only`.** Stable string enum on `CommandContract.outputPolicy`. Its gate in `serve.ts` reads the same `isTty`/`formatExplicit` derivation; no field needed.

What's deliberately *not* in this commit:

- Any redesign of how extensions declare command visibility beyond `interactive`. If a non-interactive command still needs to be hidden from a specific surface, that's a follow-up — but no command in the current codebase actually has that requirement.
- Any change to `serve`'s display branches. Tangled display logic in `serve.ts` is a known issue but waits for the larger pipeline refactor (`Internal architecture changes §1`).

Files touched:

- `packages/core/src/types.ts` (delete `InvocationKind`, `CliEventMcp`; open `CliEventType` to extension strings; remove `'mcp'` from `CliEventSurface.kind`; drop `invocation` and `machine` from `RunContext`/`CliEvent`; add `attributes?` to `CliEvent`; flip `CommandContract.agent` → `interactive?`; rename `OutputPolicy` value)
- `packages/core/src/auth/types.ts` (delete duplicate `InvocationKind`)
- `packages/core/src/cli/execute.ts`, `serve.ts`, `fetch.ts`, `dispatch.ts` (drop `invocation` and `machine`/`agent` field writes; delete `isCiEnv` in `serve.ts`)
- `packages/core/src/cli/lifecycle.ts` (replace `mcp` cloning with `attributes` cloning in snapshot)
- `packages/core/src/command/contract.ts` (read `definition.interactive` instead of `definition.agent`)
- `packages/core/src/index.ts` (remove `InvocationKind`/`CliEventMcp` exports)
- `packages/extensions/auth/src/types.ts` (define local `InvocationKind`)
- `packages/extensions/auth/src/invocation.ts` (new — `detectInvocation` helper)
- `packages/extensions/auth/src/index.ts` (export `detectInvocation` and `InvocationKind`)
- `packages/extensions/agents/mcp-server/src/protocol.ts` (filter `!command.interactive`; emit lifecycle events with `attributes` + `surface.kind: 'command'`; inject `LICHE_INVOCATION=mcp` into env when executing commands)
- `packages/extensions/agents/skills-runtime/src/generate.ts` (filter `!command.interactive`)
- `packages/extensions/telemetry/src/internal/schema.ts` (drop `agent`/`invocation`/`mcp` fields; add `isTty` and `attributes`)
- `packages/extensions/telemetry/src/index.ts` (telemetry status command uses local `detectInvocation` from env)
- `packages/extensions/telemetry/src/internal/sinks.ts` (drop `cli.invocation` OTLP attribute)
- `packages/extensions/src/index.ts` (re-export `detectInvocation` from auth)
- `packages/extensions/config/src/index.ts`, `packages/extensions/completions/src/index.ts`, `packages/extensions/agents/mcp-installer/src/index.ts`, `packages/extensions/agents/skills-installer/src/index.ts` (drop spurious `agent: false`/`interactive: true` from non-interactive commands so they become agent-callable)
- `packages/product/src/generate/cli/auth.ts`, `capability.ts`, `imports.ts`, `runtime.ts` (emit `detectInvocation(ctx)` for auth runtime invocation; drop spurious `agent:`/`interactive:` emissions for workflow capabilities; add `detectInvocation` to the auth import line)
- `packages/product/test/fixtures/workers.generated.ts` (regenerated to match)
- API snapshot, package-root consumer, lifecycle, parity, telemetry schema, and generated CLI tests (renames + deletions)
- `docs/api-boundary.md`, `docs/coverage.md`, `docs/auth-session.md`, `docs/opt-in-globals-plan.md` (updated to new vocabulary)

Verification:

- `rg "InvocationKind|CliEventMcp|mcp\\?:|kind: 'mcp'|agent-only|ctx\\.agent|event\\.agent|ctx\\.invocation|event\\.invocation|CommandContract.*agent|\\bagent\\?: boolean|\\bmachine\\?: boolean|ctx\\.machine|event\\.machine" packages/core/src packages/core/test packages/extensions/agents packages/extensions/telemetry packages/extensions/auth/src` finds nothing in core or first-party extensions (the auth extension keeps its own local `InvocationKind`).
- `rg "Bun\\.env|commandFormat\\(selected\\)" packages/core/src/cli` matches only the `defaultEnv`/`resolveFormat` helpers in `invocation.ts`.
- MCP extension tests still prove interactive commands are not listed or callable through MCP, now via `!command.interactive` (test in `packages/core/test/parity.test.ts` updated to use a `login` fixture for accuracy).
- Lifecycle subscribers see `event.isTty` instead of `event.machine`/`event.invocation`; telemetry wire schema asserts `isTty` and `attributes`.
- All 15 packages pass `bun run check` and `bun run test`.

### Commit 0B: Shared invocation defaults

Goal: collapse duplicated adapter defaults into helpers so behavior changes happen in one place.

Motivation: a working-tree audit found the same `options.env ?? Bun.env` cast in three adapters (`serve.ts:26`, `dispatch.ts:49`, `fetch.ts:45+72`), and the same five-step output-format fallback chain — `options.format ?? (flags.json ? 'json' : flags.format) ?? commandFormat(selected) ?? state.def.format ?? DEFAULT_FORMAT` — at four sites (`serve.ts:51`, `serve.ts:99`, `dispatch.ts:75`, `dispatch.ts:187`). These are not architectural decisions, just copy-paste. Drying them up makes later behavior changes single-edit and surfaces the intended convention.

Decisions:

- **Add `defaultEnv()`** to `cli/invocation.ts`. Returns `Bun.env as Dict<string | undefined>`. Single source for the default env Dict. Adapters read `options.env ?? defaultEnv()`.
- **Add `resolveFormat({ explicit, flags, selected, defaultFormat })`** to `cli/invocation.ts`. Returns `{ format, formatExplicit }`. Encodes the fallback chain once. Adapters pass what they have; the helper computes both fields.
- **Keep adapter-specific I/O knobs out of these helpers.** `defaultEnv` and `resolveFormat` are pure data helpers — no Bun-stream defaults, no exit handlers, no TTY sniff. Those stay in `serve.ts` and `fetch.ts` because they are adapter-specific.

Files likely touched:

- `packages/core/src/cli/invocation.ts`
- `packages/core/src/cli/serve.ts`
- `packages/core/src/cli/dispatch.ts`
- `packages/core/src/cli/fetch.ts`
- focused serve, dispatch, fetch, and env convention tests

Verification:

- `rg "Bun\\.env" packages/core/src/cli` matches only `defaultEnv()` in `invocation.ts`.
- `rg "commandFormat\\(selected\\)" packages/core/src/cli` matches only `resolveFormat` in `invocation.ts`.
- `serve`, `dispatch`, and `fetch` all use `defaultEnv()` and `resolveFormat()` instead of inline copies.
- Existing output-format, generated envelope, completion, help, schema, and dispatch tests pass unchanged except for deliberate name updates from Commit 0A.
- The planned `ENV-003` coverage row is either backed by a real env-convention test in this commit or moved out of "implemented behavior" wording until the helper exists.

### Commit 0C: Route env reads through `envProvider` (internal-only)

Goal: make the built-in `envProvider` the single chokepoint for all env reads, without merging the two *authoring surfaces*.

Motivation: a working-tree audit found env is read two ways. (1) A command's declared `env: Schema` is schema-parsed straight off the raw env Dict at `input-sources.ts:73` — `env: parseObject(input.runtime.env, input.env)`. (2) Options with `sources: { options: { foo: [{ provider: 'env', path: 'FOO' }] }}` route through the built-in `envProvider()` like any other input source. The first path bypasses the very abstraction core wrote for env access. Net effect: `ctx.env.FOO` and `ctx.sources.option('foo')` use different machinery to read the same OS env table, and there is no single chokepoint to layer secrets-handling, redaction, observability, or mock env on.

The two **authoring surfaces stay distinct** — that part of the previous audit holds. `input.env` declares a typed env-shape requirement that surfaces as `ctx.env`. `input.sources.options` binds named provider values into options that surface as `ctx.options.foo`. Neither user-visible shape changes here. What changes is purely *how the values are fetched inside the resolver*.

Decisions:

- **Keep `input.env: Schema` as the authoring surface and `ctx.env` as the result.** No command needs to change.
- **Reshape `resolveCommandInput` so the declared-env path goes through `envProvider`.** `parseObject(input.runtime.env, input.env)` is replaced by a flow that, for every key in the env schema, calls `envProvider.get(key)` and assembles the result. The schema parses the assembled object. envProvider's source(path) is recorded in `ctx.sources` for each declared-env key, matching how option-source bindings already work.
- **Route declared-env reads through the envProvider instance only, not the first matching provider.** Today, declared env reads `input.env` raw — no other provider can intercept. Preserve that by calling envProvider.get directly, not by querying the provider chain. This ensures behavior is byte-identical for users.
- **Defer the schema-driven sources sugar.** A natural follow-up is treating `env: z.object({ FOO: z.string() })` as implicit `sources: { env: { ... } }`, so users can declare an env source override on the same command. Out of scope for this commit.

Files likely touched:

- `packages/core/src/cli/input-sources.ts`
- `packages/core/src/cli/execute.ts` (no change expected to public shape; verifying that `ctx.env` is still the parsed value)
- focused env-reading tests; new test confirming `ctx.sources.source('env', 'FOO')` returns provenance when `FOO` is consumed via the declared env schema
- no extension package changes expected; `packages/extensions/config` registers its own provider with a different id and is unaffected

Verification:

- `ctx.env.FOO` still equals what `Bun.env.FOO` resolves to when a command declares `env: z.object({ FOO: z.string() })`.
- `ctx.sources.source('env', 'FOO')` returns `{ kind: 'env', name: 'FOO' }` whether `FOO` is read via the declared env schema or via an option-source binding.
- A provider registered with `id: 'env'` (collision) still throws — registration-time uniqueness check is unchanged.
- A non-env provider registered before envProvider in `inputSources` cannot intercept declared-env reads. The order of providers in `inputSources` does not affect declared-env resolution.
- No test in `packages/core/test` reads `input.env` directly; all reads go through `envProvider.get`.

### Commit 1: Public invocation pipeline scaffolding

Goal: expose the shape without changing argument semantics.

This commit is core-only. It introduces the generic dispatch primitive and shared invocation helpers. It does not migrate the MCP extension, skills runtime, or any other extension to `dispatch`; those migrations are follow-up slices once the public primitive is stable.

Files likely touched:

- `packages/core/src/cli/dispatch.ts`
- `packages/core/src/cli/invocation.ts`
- `packages/core/src/cli/create.ts`
- `packages/core/src/cli/serve.ts`
- `packages/core/src/cli/execute.ts`
- `packages/core/src/types.ts`
- `packages/core/src/index.ts`
- `packages/core/test/api-snapshot.test.ts`
- `packages/core/test/core-consumer-boundary.test.ts` or Product consumer-boundary equivalent

Verification:

- `run(cli, argv)` produces the same stdout/stderr/exit behavior as `cli.serve(argv)`.
- `dispatch(cli, argv)` returns the same `Result` data that `serve` prints under `--json`.
- `dispatch` does not write stdout/stderr or call `exit`.
- `dispatch(cli, [])`, `dispatch(cli, ["--help"])`, `dispatch(cli, ["--version"])`, and `dispatch(cli, ["unknown-cmd"])` return `Result.fail` with structured codes, not display envelopes or thrown errors.
- API snapshot and package-root consumer tests lock the new exports.

### Commit 2: Parse-only public API

Goal: make selection and resolved input observable without running handlers.

Files likely touched:

- invocation pipeline files from commit 1
- input-source resolution types
- lifecycle tests if `parseInvocation` emits or deliberately does not emit lifecycle events

Verification:

- `parseInvocation(cli, argv)` returns command path, contract, globals, format, decoded input, and provenance.
- Handler is not called.
- Validation failures return/throw through the same normalized error path as dispatch.
- Deprecated option warnings are represented without writing stderr.

### Commit 3: Async schema parsing

Goal: allow Zod async codecs/refinements in command inputs.

Files likely touched:

- `packages/core/src/schema/zod.ts`
- `packages/core/src/parser/argv.ts`
- `packages/core/src/cli/input-sources.ts`
- `packages/core/src/cli/execute.ts`
- schema and contract tests

Verification:

- Async codec in args/options/env resolves before handler.
- Async validation errors normalize into the standard `VALIDATION_ERROR`.
- Sync schemas still work with no behavior change.
- Output validation supports async schemas through the same async parse helper used for command inputs.

### Commit 4: `arg` namespace with strict built-ins

Goal: replace repeated `z.coerce.*` CLI schemas with strict reusable codecs.

Files likely touched:

- new `packages/core/src/schema/arg.ts`
- `packages/core/src/index.ts`
- `packages/core/README.md`
- `packages/core/SKILL.md`
- core contract/property/help/schema tests

Verification:

- `arg.positiveInt().optional()` infers `number | undefined`.
- `arg.int()` accepts `"3"` and `3`, rejects `"3.1"`, `"1e3"`, `"+3"`, `"03"`, `""`, `"   "`, `true`, `null`, arrays, and objects.
- `arg.boolean()` accepts the documented string and JSON boolean forms, rejects broad truthy/falsy coercion such as `"hello"`.
- Default values and `.optional()` still behave as normal Zod schemas.

### Commit 5: Custom codecs and projection policy

Goal: support cmd-ts-style custom decoded runtime values without losing contracts.

Files likely touched:

- `packages/core/src/schema/arg.ts`
- command schema projection tests
- extension-transport/fetch tests if unsupported-surface policy is enforced there

Verification:

- `arg.fromString()` can return a custom object from a string before handler execution.
- `--schema`, command manifest, and extension tool schemas show the declared input string shape.
- CLI-only runtime codecs force `agent: false` at declaration time, execute through CLI/programmatic dispatch, and fail with a structured unsupported-surface error if reached through fetch.

### Commit 6: Source-aware validation errors

Goal: make failures better than both raw Zod and cmd-ts by identifying where the bad value came from.

Files likely touched:

- parser/input-source assembly
- `FieldError` type
- `normalizeZodError`
- human validation renderer
- fetch/extension-transport validation tests

Verification:

- Invalid argv option reports the flag, such as `--replicas`.
- Invalid positional reports the index/display field.
- Invalid env/config/provider value reports provider/path.
- Invalid fetch query/body value reports query/body source.
- Machine JSON errors preserve the same source metadata that human output summarizes.

### Commit 7: Public docs and examples hard cutover

Goal: teach the new API and remove the old repeated-coercion guidance.

Files likely touched:

- `packages/core/README.md`
- `packages/core/SKILL.md`
- examples using numeric CLI args
- docs that currently show `z.coerce.number()` for CLI inputs

Verification:

- `rg "z.coerce.number" packages/core docs examples` leaves only intentional historical or non-CLI-boundary examples.
- Example smoke tests pass.
- Docs and package READMEs show `run`, `dispatch`, `parseInvocation`, and `arg`.

## Test plan

Run focused checks after each commit:

```sh
bun run --filter @liche/core check
bun run --filter @liche/core test
```

Run broader checks before merging the slice:

```sh
bun run check
bun run test
bun run test:examples
```

For public package confidence, add a temp-consumer proof that imports only `@liche/core` and exercises:

- `run`
- `dispatch`
- `parseInvocation`
- `arg.positiveInt`
- `arg.fromString`

## Decisions from codebase audit

Audit evidence:

- `packages/extensions/agents/mcp-server/src/protocol.ts` currently imports `selectCommand`, `execute`, and lifecycle helpers from `@liche/core` to implement `tools/call`. This extension is the clearest current example of adapter pressure for a public `dispatch` lane, not a reason to couple core to MCP.
- `packages/extensions/agents/mcp-server/test/helpers.ts` and `packages/extensions/agents/skills-runtime/test/helpers.ts` still import `getCliState` to inspect runtime state. `parseInvocation` should cover parse/selection needs without exposing mutable `CliState`.
- `packages/core/src/cli/execute.ts` already collects async-generator chunks and calls `onChunk` when supplied. `dispatch` should expose that existing behavior instead of creating another streaming contract.
- `packages/core/src/schema/zod.ts` exports sync `parseSchema`, and `packages/extensions/config/src/index.ts` plus `packages/extensions/telemetry/src/internal/schema.ts` use it through the package root for non-command schema boundaries. That makes `parseSchema` still legitimate public API.
- `packages/core/src/command/schema.ts` already projects schemas through `toJsonSchema`, and `toJsonSchema` uses Zod's input mode. The codec plan should preserve that direction instead of projecting decoded runtime values.
- `agent: false` is already the agent/tool visibility gate in command contracts. Runtime-only CLI codecs should use that existing gate for extension transports such as MCP rather than inventing a separate discovery filter.

1. **Name the parse-only API `parseInvocation`.** Current public and internal code already has `parseSchema`, parser helpers, and Zod parse vocabulary. A specific name keeps the root export clear.
2. **Keep streaming collection and `onChunk` together.** The current executor already collects async-generator chunks and calls `onChunk` when supplied. `dispatch` should expose that behavior directly instead of forking streaming semantics.
3. **Use canonical decimal grammar for built-in numeric codecs.** Broad `Number()` coercion is the bug class this plan is removing. Decimal-only strings plus JSON numeric inputs are enough for CLI/env/config/fetch use and easier to test.
4. **Fail early for agent-visible CLI-only codecs, fail at runtime for fetch.** Extension tool discovery is a contract surface, so uncallable tools should not be listed. Fetch is a generic inbound dispatcher today, so unsupported runtime codecs should return a structured `UNSUPPORTED_SURFACE` error there.
5. **Keep `parseSchema` public and add `parseSchemaAsync`.** First-party extensions already use `parseSchema` for config and telemetry wire validation through package-root imports. `dispatch` and `parseInvocation` reduce command-execution pressure, but they do not replace low-level schema-boundary parsing.
6. **Support async output validation.** Once command input parsing moves to `parseSchemaAsync`, output validation should use the same helper so async codecs/refinements behave consistently across input and output boundaries.
7. **`dispatch` returns `Result.fail` for non-runnable invocations.** It should never throw typed parse/control errors and should not embed rendered help or version text in `Result.data`. Help, version, schema, completions, and extension serve-handlers remain `serve` display behavior.
8. **Move shared invocation helpers to `cli/invocation.ts`.** `runPrepareContext` and `contextGlobals` are shared preparation helpers, not `serve` exports. This keeps the first commit aligned with the later pipeline refactor.
9. **Put `run` and `dispatch` in `cli/dispatch.ts`.** The file owns the public result-returning invocation lane and the trivial effectful wrapper. `create.ts` should continue constructing instances rather than accumulating public entrypoint implementations.
10. **Treat extension migration as follow-up work.** The MCP server is evidence that extensions need a public command-driving primitive, but Commit 1 should not modify MCP or any other extension. After `dispatch` is proven at the package root, adapters can migrate one by one.
