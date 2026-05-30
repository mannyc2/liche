# Behavior and coverage

This is the source of truth for tests. Tests are derived from these behavior cases and coverage rows, not from implementation details.

See [core-run-and-arg-codecs-plan.md](./core-run-and-arg-codecs-plan.md) for the planned public invocation and argument codec contract, [env-vars.md](./env-vars.md) for the env var contract, [config-primitive.md](./config-primitive.md) for the config contract, [auth-session.md](./auth-session.md) for auth/session requirements, [build-system.md](./build-system.md) for build/generate requirements, and [release-and-distribution.md](./release-and-distribution.md) for release/manifest requirements.

## Goals

- Keep the public authoring API centered on `defineCli()`, `defineCommand()`, `run(cli)`, `cli.fetch()`, `middleware()`, and `z`. Command declaration is data-first only; lifecycle events, hooks, and middleware are declared through `defineCli()` data, not fluent instance mutators.
- Use Bun-native edges for process/runtime work: `Bun.argv`, `Bun.env`, `Bun.file`, `Bun.write`, Bun Shell, Bun stdin/stdout, and `bun:test`.
- Use small runtime dependencies where they provide concrete feature parity: `zod` for public schema compatibility and JSON Schema conversion, `yaml` for config/output stringification. Token-aware output (`tokenx`) is opt-in via the `@liche/tokens` extension and is auto-included by `@liche/agents`.
- Keep stdout/stderr channel discipline explicit: stdout carries only the requested output format; stderr carries warnings, CTA blocks, prompts, and human diagnostics.
- Keep implementation modules small enough for focused review and mutation testing.

## Test-authoring rules

- A generated test must point to at least one behavior case ID.
- A generated test must state what bad implementation it would catch when adding a new behavior case.
- Tests should prefer public CLI/fetch APIs over private module calls, except property tests for parser/formatter invariants.
- Tests should use external oracles when available.
- Mutation testing is used to verify sensitivity, not to reward test volume.

## Behavior cases

| ID | Area | Requirement | Tests | Known-bad implementation this should catch |
|---|---|---|---|---|
| CLI-001 | Command resolution | If no subcommand matches, the root command runs. | `contract.test.ts` | Always requiring a subcommand. |
| CLI-002 | Command resolution | A subcommand takes precedence over a root command. | `contract.test.ts` | Running root before checking subcommands. |
| CLI-003 | Aliases | Command aliases resolve to the original command. | `contract.test.ts` | Registering aliases as separate empty commands. |
| RUN-001 | Public invocation | `run(cli, argv?)` is the effectful public CLI entrypoint; omitting `argv` uses `Bun.argv.slice(2)`, and explicit argv matches `run(cli, argv)` behavior. | planned: `invocation-api.test.ts`, temp-consumer proof | Requiring authors to hand-roll `Bun.argv` slicing or bypassing terminal-runner semantics. |
| DISPATCH-001 | Public invocation | `dispatch(cli, argv, options)` executes through the shared command pipeline and returns `Result` without writing stdout/stderr or calling exit; non-runnable display/control invocations such as help/version return structured `Result.fail` codes. | planned: `invocation-api.test.ts`, temp-consumer proof | Extensions or adapters must compose `getCliState`/`selectCommand`/`execute`, tests mock process I/O for result assertions, or dispatch embeds rendered help/version output in result data. |
| PARSE-001 | Public invocation | `parseInvocation(cli, argv, options)` selects the command and resolves globals/input/provenance without running the handler. Returns `Result.fail` for non-runnable invocations (`--help`/`--version`/`--schema`/`COMPLETE`/terminal-handler flags → `PARSE_ERROR`; unknown commands → `COMMAND_NOT_FOUND`; command entries with no `run` → `COMMAND_NOT_RUNNABLE`). Emits no lifecycle events. Deprecated options surface as `warnings` on the result. Handler-effective values (`format`, `formatExplicit`, `globals`, `input`, `sources`) reflect `prepareContext` patches; raw patch is exposed under `contextOverrides`. | `parse-invocation.test.ts` | Parse-only users must execute handlers or import parser/executor internals; introspection emits fake operational events or pollutes telemetry. |
| ARG-001 | Positionals | Object args bind by schema key order. | `contract.test.ts` | Treating all args as a raw array. |
| ARG-002 | Flags | `--flag`, `--no-flag`, `--flag=value`, short aliases, and `--` are parsed correctly. | `contract.test.ts`, `property.test.ts` | Treating `false` as missing, ignoring `--`, or not resolving camel/kebab names. |
| ARG-CODEC-001 | Argument codecs | `arg.number()`, `arg.int()`, `arg.positiveInt()`, `arg.port()`, and `arg.boolean()` are strict Zod schemas that decode documented string/JSON inputs without broad JavaScript coercion. | planned: `arg-codecs.test.ts`, `property.test.ts`, temp-consumer proof | Continuing to require repeated `z.coerce.*` schemas, accepting broad truthy/falsy values, or accepting empty/invalid numeric strings. |
| ARG-CODEC-002 | Custom argument codecs | `arg.fromString()` decodes string inputs into handler runtime values while command contracts project the declared input schema. | planned: `arg-codecs.test.ts`, `contract.test.ts` | Custom decoded values force userland parser code or leak runtime-only types into JSON Schema or extension tool schemas. |
| ARG-CODEC-003 | Async argument codecs | Command input and output validation awaits async codec decoders/refinements (`parseSchemaAsync` covers args, env, options, vars, command output, and HTTP operation output) and normalizes failures into the standard error envelope. | `schema-zod.test.ts`, `parse-invocation.test.ts`, `contract.test.ts`, `http-operation.test.ts`; arg-namespace coverage planned for `arg-codecs.test.ts` | Async decoders throw `ZodAsyncError`, run after the handler, or bypass structured validation errors. |
| ARG-CODEC-004 | Runtime-only surfaces | CLI-only runtime codecs are excluded by adapter-owned surface policy before tool exposure and return `UNSUPPORTED_SURFACE` if reached through `cli.fetch()`. | planned: `arg-codecs.test.ts`, extension-transport/fetch focused tests | Extension tool discovery lists commands that cannot run, or fetch attempts to serialize unsupported runtime values. |
| CFG-001 | Config | Declared input-source values load before CLI values, so CLI overrides external sources. | `contract.test.ts` | Merge order of CLI then external sources. |
| ENV-001 | Env | Command env schemas validate the supplied environment object. | `contract.test.ts` | Reading only `process.env` or skipping env validation. |
| ENV-002 | Env | The built-in env provider populates bound option values; precedence is argv > declared sources > schema default. | `contract.test.ts` | Letting env beat argv, or skipping env entirely. |
| ENV-003 | Env | `src/` reads env only through `bunEnv()`; `process.env`/`Bun.env`/`import.meta.env` are forbidden elsewhere. | `env-conventions.test.ts` | Scattering direct env reads across modules. |
| MW-001 | Middleware | Middleware runs around handlers and can share `ctx.var`. | `contract.test.ts` | Not awaiting `next()` or losing vars. |
| FMT-001 | Formatter default | Formatter output defaults to JSON. | `formatter-default.test.ts` | Defaulting to a non-JSON plugin renderer. |
| FMT-002 | JSONL | JSONL output is one valid JSON value per line. | `property.test.ts` | Joining with commas or pretty JSON. |
| FMT-003 | Output renderers | Extension-provided output renderers can be selected by `--format`, and `--json` resolves through the same renderer registry. | `define-extension.test.ts` | Special-casing JSON outside the renderer primitive or installing renderer globals implicitly. |
| FMT-006 | CSV | CSV output renders record arrays with a stable union header, scalar rows with `value`, and RFC-style comma/quote/newline escaping. | `behavior-edges.test.ts`, `property.test.ts` | Dumping JSON as one cell, dropping later record keys, or failing to escape CSV cells. |
| HTTP-001 | Fetch | `cli.fetch()` dispatches URL path segments and query/body options. | `contract.test.ts` | Ignoring query params or not wrapping results. |
| SCHEMA-001 | Schema | When `reflectionControls({ schema: true })` is installed, `--schema` is generated from Zod schemas. | `contract.test.ts` | Hand-written schema snapshots or implicit Core schema flags. |
| LLM-001 | LLM index | When `llms()` from `@liche/agents` is installed, `--llms` emits a markdown command index unless format is explicit. | `golden.test.ts`, `agents.test.ts` | Formatting the index as JSON by default or leaving the flag implicit in Core. |
| HELP-001 | Help | `help()` installs `--help`/`-h`; fallback help still shows usage, command descriptions, args/options, extension helper commands, and installed globals. | `golden.test.ts`, `global-inputs.test.ts` | Hidden helper commands, stale option names, or implicit Core help flags. |
| HELP-002 | Help hint | `hint` is rendered after `Examples:` in `--help` and as a `>` blockquote in skill markdown. | `parity.test.ts` | Dropping the hint when other sections are missing. |
| HELP-003 | Custom help renderer | `help({ renderer })` receives a serializable model and controls explicit help, fallback help, and human validation diagnostics; `defaultHelpRenderer()` is public for wrappers. | `help-render.test.ts` | Hard-wiring `renderHelp()` around custom renderers or exposing `CliState` to help customization. |
| USAGE-001 | Usage object | `usage[].prefix`/`suffix` wrap the rendered command; args/options can be objects or arrays. | `parity.test.ts` | Ignoring prefix/suffix or refusing object form. |
| STREAM-001 | Streaming | Async generator `run()` writes one line per yield in CLI mode and one NDJSON record per yield (plus a trailing envelope) over `cli.fetch()` when `accept: application/x-ndjson`. | `parity.test.ts` | Buffering yields into one array. |
| OPT-DEP-001 | Deprecated options | Zod option `.meta({deprecated:true})` produces `[deprecated]` in `--help`, **Deprecated.** in skill docs, `deprecated:[…]` in `--schema`, and a `warning: --flag is deprecated` stderr line when invoked on a TTY. | `parity.test.ts` | Silently accepting deprecated flags. |
| ERROR-001 | Structured recovery errors | Error envelopes include Problem Details fields (`type`, `title`, `status`, `detail`, `instance`) plus agent recovery hints (`retry_after`, `suggested_fix`, `code_actions`), and `ctx.error(...)` can emit the full shape. | `errors.test.ts`, `contract.test.ts` | Agents have to scrape `message` strings or lose recovery actions. |
| ERROR-002 | Object-first command outcomes | Expected command success/failure uses standardized result factories; thrown error classes are internal parser/schema/auth/HTTP plumbing and are normalized once by the executor. | `errors.test.ts`, `envelope-mode.test.ts`, `lifecycle.test.ts`, `extension-lane-coverage.test.ts`, `api-snapshot.test.ts`, `core-consumer-boundary.test.ts` | Normal command failures depend on hidden throws or public error classes. |
| ERROR-003 | Source-aware validation errors | Validation errors preserve field path, issue metadata, and value source such as argv flag, positional index, env, provider/config path, fetch query/body, extension transport, or programmatic input. | planned: `arg-codecs.test.ts`, `contract.test.ts`, fetch/extension-transport focused tests | Human and machine errors force users to guess where a bad value originated. |
| MCP-ADD-001 | mcp add flags | When `mcpInstaller()` or `agents()` from `@liche/extensions` is installed, `mcp add` accepts `-c/--command`, `--agent`, `--no-global` and writes the right file per agent; command overrides are split into MCP's executable-plus-args shape and append `--mcp` once. | `packages/extensions/test/helpers.test.ts`, `parity.test.ts` | Always writing a generic config, serializing `command: "bunx app"` as one executable string, or exposing helper commands without opt-in. |
| SKILLS-ADD-001 | skills add agent | When `skillsInstaller()` or `agents()` from `@liche/extensions` is installed, `skills add --agent <agent>` writes to the agent's skill directory; `--no-global` chooses project location; packaged skill content is used when supplied to the extension. | `packages/extensions/test/helpers.test.ts`, `skill-markdown.test.ts` | Hardcoding `~/.claude/skills/`, ignoring packaged skill content, or exposing helper commands without opt-in. |
| MCP-NAME-001 | MCP tool names | `tools/list` returns tool names with whitespace replaced by `_`; `tools/call` resolves underscored names back to the canonical command path. | `parity.test.ts` | Returning space-separated names that MCP clients reject. |
| MCP-HIDDEN-001 | MCP hidden commands | MCP tool exposure is owned by the MCP adapter. Its default policy omits commands with `interactive: true`, and configured excludes cannot be invoked through `tools/call` by guessing the tool name. | `parity.test.ts` | Hiding tools from discovery but still allowing direct MCP invocation. |
| MCP-META-001 | MCP schemas and hints | The MCP adapter includes declared command schemas, and Product-generated MCP tools include catalog-derived MCP-standard hint annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). | `declarative-authoring.test.ts`, `parity.test.ts`, `generate-surfaces.test.ts`, `generate-mcp-conformance.test.ts` | Agents see weaker tools than the adapter/Product catalog can describe. |
| AGENT-FLIP-001 | `--json` flips `formatExplicit` | Explicit `--json`/`--format` from installed output controls sets `ctx.formatExplicit` to `true` even on a TTY; consumers needing machine-output mode derive it from `!ctx.isTty || ctx.formatExplicit`. | `parity.test.ts` | Tying machine-output mode to raw TTY only, or accepting output globals without opt-in. |
| LLMS-SHAPE-001 | `--llms` JSON shape | With `llms()` and output controls installed, `--llms --format json` returns `{ manifestVersion: 'liche.v1', name, commands: […] }` with per-command `description`, `aliases`, `examples`, `hint`, `usage`, `outputPolicy`, and `schema`. | `parity.test.ts`, `agents.test.ts` | Dropping examples/hint/usage from the manifest or keeping `--llms` hard-wired in Core. |
| OPT-GLOBAL-001 | Opt-in globals | A minimal `defineCli()` has no implicit `--help`, `--version`, `--json`, `--format`, `--schema`, or `--llms`; command options may use those names. | `global-inputs.test.ts`, `envelope-mode.test.ts`, `generated.test.ts` | Core reserves user flag names or generated CLIs rely on disabled fallback globals. |
| CONFIG-002 | Config flags global | `@liche/config` contributes `--config <path>` and `--no-config` as extension globals. | `parity.test.ts` | Making Core reserve config-specific flags without the config extension. |
| CONFIG-003 | Config provider | A declared config provider exposes typed values through `ctx.sources.value("config", path)` and source provenance without folding provenance into values. | `contract.test.ts` | Returning raw loader output or losing source information. |
| CONFIG-004 | Config discovery | `--config <path>` loads exactly that file, `--no-config` disables project/user discovery, and passing both is invalid. | `parser-config.test.ts`, `parity.test.ts` | Merging explicit files with discovered files or silently accepting conflicting flags. |
| CONFIG-005 | Explicit option binding | Config values satisfy command options only through explicit option-to-config bindings. | `contract.test.ts` | Auto-binding every matching option name to a config key. |
| CONFIG-006 | Config schema strictness | Unknown config keys fail when the declared schema is strict. | `parser-config.test.ts` | Silently ignoring misspelled durable preferences. |
| CHANNEL-001 | Channel discipline | Machine output modes keep stdout parseable and put warnings, CTA blocks, prompts, and human diagnostics on stderr. | `contract.test.ts`, `parity.test.ts`, `run-options.test.ts` | Human text corrupts JSON/JSONL stdout. |
| EXT-LANE-001 | Extension lane property | Optional features that can be implemented with public command registration, lifecycle events, hooks, middleware, input sources, or generated artifacts stay out of core. Extension fixtures import only the package root, can be disabled without changing baseline command semantics, and must not depend on internals such as `CliState`, `Entry`, parser helpers, or generated source. | `extension-lane-coverage.test.ts` | Widening core for features that a public-lane extension can implement, or shipping extensions that mutate hidden runtime state. |
| OPENAPI-001 | OpenAPI emit | `GET /openapi.json` returns a `3.1.0` document keyed by command paths with `operationId` derived from the underscored command name. | `parity.test.ts` | Returning the legacy manifest. |
| OPENAPI-002 | OpenAPI ingest | `ingestOpenApi(spec)` maps path/query/body parameters into typed command descriptors. | `parity.test.ts` | Dropping body parameters. |
| VARS-001 | Vars defaults | Zod `vars` defaults populate `c.var`; middleware `set()` overrides those defaults. | `parity.test.ts` | Letting defaults clobber middleware-set values. |
| GLOBAL-DEFAULT-001 | Global default | `defineGlobal({ default })` populates `flags[key]` and `ctx.global[key]` when the flag is absent, explicit argv overrides it, and help renders `(default: …)` next to the description. `parse` does not run on the default. | `global-inputs.test.ts` | Defaults clobbering explicit values, leaking through `parse`, or missing from help. |
| FMT-007 | Per-command renderers | `defineCommand({ formats })` runs the per-command render function at the `result` stage for the matched format. `--json` still routes to the registered JSON renderer regardless. | `declarative-authoring.test.ts` | Per-command renderer hijacking structured formats or never firing for human formats. |
| HELP-004 | Option value tokens | Non-boolean per-command options render as `--name <key>` in the help options table; `z.string().meta({ valueLabel })` overrides the placeholder; boolean options have no value token. | `help-render.test.ts` | Options table missing value placeholders or showing one on boolean flags. |
| CLI-003 alias shorthand | Aliases | `defineCommand({ aliases: ['s'] })` accepts a bare string as shorthand for `[['s']]` (single-segment alias). Nested arrays still work for multi-segment forms. | `declarative-authoring.test.ts` | Bare-string aliases spreading into character arrays, or the shorthand bypassing the parent-path constraint. |

## Mutation priorities

Start with these files:

```txt
src/parser/argv.ts
src/parser/config.ts
src/command/registry.ts
src/schema/zod.ts
src/format/index.ts
src/format/filter.ts
src/format/tokens.ts
src/cli/terminal.ts
src/mcp/protocol.ts
```

Seed bugs to kill before trusting generated test expansion:

```txt
- Reverse config precedence.
- Ignore `--` end-of-options.
- Treat `false` as missing.
- Parse `--flag=false` as true.
- Choose root command before subcommand.
- Skip alias resolution.
- Skip env validation.
- Skip output validation.
- Default to a plugin or non-JSON renderer.
- Drop CTA metadata from success/error envelopes.
- Count characters instead of tokens.
```

## Coverage matrix — current behavior

Maps the behavior cases above to the tests that exercise them in the current implementation.

| Requirement | Source | Test file | Test name | Oracle | Known bad implementation caught |
|---|---|---|---|---|---|
| CLI-001 root command fallback | behavior cases | test/contract.test.ts | runs a root command when no subcommand matches | behavior plan | Always requiring a subcommand |
| CLI-002 subcommand precedence | behavior cases | test/contract.test.ts | subcommands take precedence over root commands | behavior plan | root command chosen before subcommand |
| CLI-003 aliases resolve target | behavior cases | test/contract.test.ts | aliases resolve to the target command | behavior plan | alias not resolved |
| CLI-003 alias config path | behavior cases | test/contract.test.ts | aliases use the target command path for config lookup | explicit regression | alias config lookup uses alias name |
| ARG-001 positional object args | behavior cases | test/contract.test.ts | runs a root command when no subcommand matches | behavior plan | positionals kept as raw array |
| ARG-002 flags and literal boundary | behavior cases | test/contract.test.ts | parses positionals, aliases, booleans, --no flags, and -- literal boundary | behavior plan | -- end-of-options ignored |
| ARG-002 explicit false and zero | behavior cases | test/contract.test.ts | preserves explicit boolean false and numeric zero option values | explicit regression | false treated as missing |
| ARG-002 parser invariant | behavior cases | test/property.test.ts | flag parser preserves numeric values and boolean negation across generated inputs | fast-check property | boolean negation or numeric values corrupted |
| CFG-001 config before CLI | behavior cases | test/contract.test.ts | merges config before CLI options so explicit CLI values win | behavior plan | config precedence reversed |
| CFG-001 precedence invariant | behavior cases | test/property.test.ts | config/env/CLI precedence invariant keeps CLI options above config values | fast-check property | CLI options overwritten by config |
| ENV-001 env validation success | behavior cases | test/contract.test.ts | validates command env from the supplied run env | behavior plan | process env used instead of supplied env |
| ENV-001 env validation failure | behavior cases | test/contract.test.ts | returns a validation error when required env is missing | Zod | env validation skipped |
| MW-001 middleware order and vars | behavior cases | test/contract.test.ts | runs middleware around command handlers and exposes vars | behavior plan | next not awaited or vars lost |
| FMT-001 formatter default | behavior cases | test/formatter-default.test.ts | Formatter output defaults to JSON | behavior plan | non-JSON plugin renderer becomes the default |
| FMT-002 JSONL line contract | behavior cases | test/property.test.ts | jsonl formatter produces one parseable JSON value per input element | fast-check property | JSONL joined with commas or pretty JSON |
| FMT-003 renderer registry | behavior cases | test/define-extension.test.ts | extension renderers can be selected by --format and --json uses the registry | public extension primitive | JSON bypasses output renderers |
| FMT-006 CSV table contract | behavior cases | test/behavior-edges.test.ts | CSV formatter preserves headers and escapes cells | CSV escaping examples | headers drop sparse keys or comma, quote, and newline cells are not escaped |
| HTTP-001 fetch dispatch | behavior cases | test/contract.test.ts | fetch dispatches HTTP paths to commands and returns an envelope | behavior plan | query params ignored |
| SCHEMA-001 Zod JSON schema | behavior cases | test/contract.test.ts | schema output is generated from Zod, not hand-written fixtures | Zod | hand-written schema snapshot |
| OUT-001 output validation | behavior cases | test/contract.test.ts | output validation rejects handler results that do not match the output schema | Zod | output validation skipped |
| LLM-001 llms markdown default | behavior cases | test/golden.test.ts | --llms emits a markdown command index by default | behavior plan | JSON emitted when markdown default expected |
| HELP-001 help shape | behavior cases | test/golden.test.ts | help output keeps the public command/help shape stable | behavior plan | hidden helper commands or stale option names |
| HELP-001 scoped help | audit finding | test/golden.test.ts | root and group help are scoped to the selected command graph node | behavior plan | leaf/group help rendered from root state |
| HELP-003 custom renderer | behavior cases | test/help-render.test.ts | help({ renderer }) handles explicit root help, command help, fallback help, and validation help | public renderer contract | renderHelp bypasses custom renderer |
| MCP-001 protocol envelopes | audit target | test/contract.test.ts | mcp initialize, tools/list, tools/call, and unknown method use JSON-RPC envelopes | behavior plan | MCP method dispatch skipped |
| CMP-001 completions aliases | audit target | test/contract.test.ts | completions include commands and aliases without duplicates | explicit regression | completions omit aliases |
| CMP-002 completions execution path | audit finding | test/contract.test.ts | completion requests run through the public CLI path | explicit regression | COMPLETE requests render help instead of suggestions |
| CMP-003 completion helper commands | audit finding | test/contract.test.ts | completion requests include enabled top-level extension helper commands | explicit regression | extension helper commands invisible to completions or disabled helpers leaking into completions |
| EXT-HELPER-001 public helper behavior | audit finding | test/contract.test.ts | first-party helper commands are opt-in and available through public CLI behavior when enabled | behavior plan | helper commands drift from metadata, output format, or opt-in policy |
| BLD-002 product vocabulary lints | docs/build-system.md | packages/product/test/vocabulary-lints.test.ts | product lints reject vocabulary drift and invalid capability structure | requirement fixture | vocabulary drift or invalid generated-surface inputs accepted |
| SKILL-001 packaged skill content | behavior cases | test/skill-markdown.test.ts, packages/product/test/cli.test.ts | CLIs can provide authored skill markdown/index and `liche-product skills add` installs the authored guidance | behavior plan + product fixture | generic reflected skill content replaces packaged guidance |
| TOK-001 tokenx behavior | behavior cases | packages/extensions/agents/tokens/test/tokens.test.ts | token count and token limit use tokenx semantics instead of character length | explicit regression | character count used instead of tokenx |
| HTTP-002 fetch body and errors | audit finding | test/contract.test.ts | fetch dispatch merges JSON body options and normalizes not found and validation errors | behavior plan | body options ignored or errors escape envelope |
| FMT-003 filter expressions | audit finding | test/behavior-edges.test.ts | pick supports object paths, array indices, multiple paths, and invalid paths | behavior plan | comma inside array index split as a path separator |
| FMT-004 CTA formatting | audit finding | test/behavior-edges.test.ts | CTA formatting preserves args, kebab-case options, booleans, and descriptions | behavior plan | CTA metadata dropped or malformed |
| SCHEMA-002 schema adapter parsing | audit finding | test/behavior-edges.test.ts | schema adapter applies defaults and normalizes validation errors | Zod | defaults, optional schemas, or field paths mishandled |
| RUNTIME-001 file helpers | audit finding | test/behavior-edges.test.ts | runtime file helpers write, read, mkdir, expand home, and detect missing files | Bun runtime behavior | runtime IO helpers untested |
| CFG-002 config file loading | audit finding | test/behavior-edges.test.ts | loadConfig reads JSON, YAML, explicit paths, disabled config, and loader fallback | behavior plan | config files, YAML, or loader fallback ignored |
| HTTP-006 fetch HTTP edges | mutation finding | test/behavior-edges.test.ts | fetch envelopes preserve not-found messages, malformed body rejection, and explicit JSON format context; empty body still succeeds with defaults | behavior plan | HTTP fetch path loses envelope details, accepts malformed JSON silently, or drops explicit JSON context |
| FMT-005 formatter modes | mutation finding | test/behavior-edges.test.ts | formatters and token helpers preserve output modes and unbounded slices | behavior plan | formatter modes or token slicing regress |
| SCHEMA-003 adapter introspection | mutation finding | test/behavior-edges.test.ts | schema adapter reports shape, descriptions, optional wrappers, and root validation paths | Zod | schema wrapper introspection or root validation paths regress |
| REG-001 command registry helpers | mutation finding | test/behavior-edges.test.ts | registry scopes aliases, group roots, completions, policies, and collected command names | behavior plan | group root completions, aliases, or command collection regress |
| REG-002 command guard helpers | mutation finding | test/behavior-edges.test.ts | guards distinguish aliases, groups, commands, and result envelopes | behavior plan | type guards accept non-command values |
| MCP-002 protocol edge cases | mutation finding | test/behavior-edges.test.ts | MCP protocol exposes root tools, tool schemas, error content, and missing tool envelopes | MCP protocol behavior | unknown tool calls fall back to root command |
| RUNTIME-002 Bun live binding | mutation finding | test/runtime-mock.test.ts | runtime process helpers read a mocked Bun platform binding | Bun mock.module live binding | runtime captures Bun globals at module load |
| RUNTIME-003 human CLI policy | mutation finding | test/runtime-mock.test.ts | public CLI human output policy and errors use the mocked TTY runtime | Bun runtime behavior | machine-only policy or human error output ignored |
| GLOBAL-DEFAULT-001 global default | behavior cases | test/global-inputs.test.ts | global default fills ctx.global when the flag is absent and renders in help | behavior plan | default missing from ctx.global, parsed through `parse`, or absent from help |
| FMT-007 per-command renderers | behavior cases | test/declarative-authoring.test.ts | per-command formats render the result without affecting --json | behavior plan | per-command renderer hijacking --json or never firing for human formats |
| HELP-004 option value token (default) | behavior cases | test/help-render.test.ts | non-boolean option appends "<key>" value token to its options-table label | behavior plan | options-table label missing value placeholder for non-boolean options |
| HELP-004 option value token (boolean) | behavior cases | test/help-render.test.ts | boolean option has no value token in its options-table label | behavior plan | boolean flags rendered as value-bearing options |
| HELP-004 option value token (override) | behavior cases | test/help-render.test.ts | meta valueLabel overrides the default <key> token | behavior plan | meta override ignored or shadowed by `<key>` fallback |
| CLI-003 alias bare-string shorthand | behavior cases | test/declarative-authoring.test.ts | single-segment aliases accept bare strings as shorthand for [name] | behavior plan | bare-string alias spreading into character arrays |

## Coverage matrix — rewrite

### Parity additions

Implemented in current `src/` first; each behavior maps to a rewrite component:

| Behavior ID | Rewrite component | Test |
|---|---|---|
| STREAM-001 | `@liche/core` runtime (cli/execute + cli/terminal + cli/fetch) | `parity.test.ts` |
| OPT-DEP-001 | `@liche/core` schema metadata + help renderer | `parity.test.ts` |
| MCP-ADD-001 | `@liche/extensions` MCP installer | `packages/extensions/test/helpers.test.ts` |
| SKILLS-ADD-001 | `@liche/extensions` skill installer | `packages/extensions/test/helpers.test.ts` |
| MCP-NAME-001 | `@liche/core` mcp transport | `parity.test.ts` |
| MCP-CONFORMANCE-001 | `@liche/core` MCP JSON-RPC transport + `@liche/product` generated MCP tools | `packages/core/test/mcp-conformance.test.ts`, `packages/product/test/generate-mcp-conformance.test.ts` |
| AGENT-FLIP-001 | `@liche/core` execute context | `parity.test.ts` |
| LLMS-SHAPE-001 | `@liche/core` command/registry | `parity.test.ts` |
| OPENAPI-001 | `@liche/core` command/openapi (emit) | `parity.test.ts` |
| OPENAPI-002 | `@liche/core` command/openapi (ingest) | `parity.test.ts` |
| CONFIG-002 | `@liche/core` parser/globals + parser/config | `parity.test.ts` |
| HELP-002 / USAGE-001 | `@liche/core` help renderer | `parity.test.ts` |
| VARS-001 | `@liche/core` execute context | `parity.test.ts` |

Before adding rewrite tests:

1. Find the requirement in a `docs/*.md` page.
2. Add or update the relevant docs page.
3. Add coverage here.
4. State the known-bad implementation the test catches.

### Build system

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| BUILD-001 | Handwritten core CLI works without `@liche/product` or `@liche/build`. | invariant.md | Package boundary test imports only `@liche/core`. | Public API | Product/build dependency leaks into core runtime. |
| BUILD-002 | Runtime product schema normalizes into a canonical catalog. | build-system.md | Normalize representative schema and snapshot canonical catalog. | Requirement fixture | Generator reads erased TypeScript types, class identity, or raw source formatting. |
| BUILD-003 | Catalog digest ignores source formatting. | invariant.md | Two differently formatted schemas normalize to same digest. | Canonical catalog | Digest computed from source bytes. |
| BUILD-004 | Closed vocabulary is a positive allowlist. | build-system.md | Lint an absent verb, then add a product-specific verb and verify it passes. | Requirement fixture | Vocabulary drift accepted or project-specific vocabulary blocked. |
| BUILD-005 | Public capabilities require output schema when selected surfaces need one. | build-system.md | Lint public capability without output for CLI/agent/docs surfaces. | Requirement fixture | Generated surfaces have unknown output contract. |
| BUILD-006 | Execution mode is required and bound. | build-system.md | Lint command without execution, local command without handler, and HTTP capability without HTTP binding. | Requirement fixture | Local/remote/hybrid behavior inferred, omitted, or declared without an implementation binding. |
| BUILD-007 | Execution shape is one input/output contract. | build-system.md | Lint attempts to define divergent local/remote contracts for one capability. | Requirement fixture | Alternate execution paths return different shapes. |
| BUILD-008 | HTTP binding must account for all input fields. | build-system.md | Lint GET capability with unbound input field. | Requirement fixture | Generated HTTP requests silently drop input. |
| BUILD-009 | Schema portability rejects unsupported Zod constructs. | build-system.md | Lint transform/custom-refinement fixture. | Zod + requirement | Generated OpenAPI/JSON Schema lies about behavior. |
| BUILD-010 | Schema does not eagerly import local implementations. | build-system.md | Lint schema that imports its `local.module`. | Module graph | Lint/docs/codegen execute implementation side effects. |
| BUILD-011 | Example argv parses to declared input. | build-system.md | Lint mismatched `examples[].argv` and `examples[].input`. | Core parser | Docs examples drift from runtime parsing. |
| BUILD-012 | Generated command declares through `defineCli()` / `defineCommand()`. | build-system.md | Inspect generated TS and execute command through core. | Public core API | Generator invents a parallel runtime or falls back to fluent registration. |
| BUILD-013 | Generated remote-http capability calls core HTTP transport. | build-system.md | Fixture generated command invokes mocked `callHttpOperation`. | Core transport primitive | Build layer owns duplicated transport behavior. |
| BUILD-014 | Generated local or hybrid command imports implementation lazily. | build-system.md | Assert module is not imported during lint/generate and imports during local execution. | Module side-effect counter | Schema import triggers implementation side effects. |
| BUILD-015 | Generated and handwritten behavior converges. | build-system.md | Run equivalent handwritten and generated CLIs over same inputs and compare output/status. | Public behavior | Generated code diverges from core semantics. |
| BUILD-016 | Drift check fails on hand-edited generated file. | build-system.md | Mutate generated header/body and run `--check`. | Generated fixture | Manual edits accepted. |
| BUILD-017 | Compile command emits expected target artifact. | build-system.md | Compile fixture schema for one supported target after unit-level profile tests pass. | Bun executable behavior | Compile path not wired to generated entry. |
| BUILD-018 | Application workflow is capability-first, not UI-route-first. | application-integration.md | Example Vite/TanStack app defines resources/commands/bindings and API routes, not generated frontend route commands. | Requirement fixture | CLI generator couples to UI route tree. |
| BUILD-019 | Runtime authoring classes and canonical catalog stay separate. | schema-ir-openapi.md | Canonical digest fixture contains plain data only, no class instances/functions. | Canonical catalog | Runtime objects leak into digest or generated snapshots. |
| BUILD-020 | Default generated vocabulary is replaceable. | build-system.md | Normalize a product schema with an explicit vocabulary object and verify defaults are absent. | Requirement fixture | Defaults become mandatory instead of a convenience preset. |
| BUILD-021 | Generated commands explicitly install `--json` as the machine-output contract. | build-system.md | Generated CLI fixture asserts `--json` is present through `outputControls()`, `--format` is absent or rejected, and help surfaces match. | Generated CLI fixture | Generated CLI preserves an implicit Core `--format` contract as the primary agent path. |
| BUILD-022 | Generated helper commands honor `--json`. | build-system.md | Run generated helper commands with `--json` and parse structured envelopes. | JSON parser + fixture | Helper commands emit ad hoc text like `wrote ...` under `--json`. |
| BUILD-023 | Effects are required and policy-consistent. | schema-ir-openapi.md | Lint fixtures missing `effects`, using invalid `effects.kind`, and declaring dangerous delete with non-destructive policy. | Requirement fixture | Dangerous or executable commands cannot be distinguished by agents or conformance. |
| BUILD-024 | Resource helpers compile down to plain capabilities. | application-integration.md | Resource-authored and explicit capability fixtures normalize to equivalent catalog records. | Canonical catalog | CRUD helper becomes a privileged parallel model. |
| BUILD-025 | Workflow commands remain first-class. | application-integration.md | Fixture includes `deploy`, `doctor`, or `migrate` command with no HTTP binding and verifies generation/lints still pass. | Canonical catalog | Generator assumes every command is a resource action or HTTP endpoint. |
| BUILD-026 | Product schema uses declarative authoring and digests normalized plain data. | product-schema.md | Build equivalent `defineProduct()` schemas through separately allocated objects and compare catalog digests. | Canonical catalog | Digest depends on object identity, private fields, or construction side effects. |
| BUILD-027 | Resources, commands, and bindings are sibling catalog nodes. | product-schema.md | Workers fixture includes one resource, `deploy`, `dev`, and one binding, then snapshots normalized catalog kinds. | Canonical catalog | Commands or bindings are forced under fake resources. |
| BUILD-028 | Field metadata is first-class in shape projections. | product-schema.md | Fixture fields use `secret`, `identifier`, `humanLabel`, and `mutability`; generated catalog preserves metadata. | Field projection | Metadata is lost before CLI/OpenAPI/docs generation. |
| BUILD-029 | Surface membership is normalized once. | product-schema.md | Fixture omits some surface hints and asserts defaults for CLI/docs/dashboard/agent/OpenAPI. | Normalized surfaces | Each generator guesses different defaults. |
| BUILD-030 | Generated CLI consumes flattened capabilities. | ROADMAP.md | Generated CLI fixture includes a resource operation and top-level `deploy`/`dev` commands. | Public CLI behavior | CLI generator remains tied to operation-only records. |
| BUILD-032 | Compile profile is the source of truth for `Bun.build()` and `compileFlagsDigest`. | build-system.md | Unit-test compile profile construction, path-independent digesting, internal entrypoint rendering, and injected `Bun.build()` options. | Bun build API docs + canonical digest | Shell-string compile logic drifts from recorded flags, or release rebuilds from workspace state. |
| BUILD-033 | `@liche/build` stays generic and does not depend on Product or releases. | invariant.md | Package boundary test inspects runtime dependencies and source imports. | Package graph | Build users who only want standalone CLI compilation pull in Product generation or release rendering. |
| CORE-PLUGIN-001 | Core is simplified around a serializable `CommandContract`; optional renderers/installers/vendor helpers live in plugins or separate packages. | api-boundary.md | Contract fixture emits schema, manifest, help, and MCP tools without executing handlers; manifest JSON contains no internal state/functions; dependency tests prove plugin packages do not leak into core. | Serializable contract fixture + package graph | Runtime reflection over `Entry`/`CliState` remains the canonical surface, plugin renderers or installer helpers stay hard-wired into core, or plugins are required for normal command execution. |
| RUN-001 / DISPATCH-001 / PARSE-001 | Public invocation APIs replace internal executor composition. | core-run-and-arg-codecs-plan.md | `invocation-api.test.ts` plus a temp-consumer package-root import proof. | Public `Result` and parse-invocation fixtures | Adapters must keep importing `CliState`, `SelectedCommand`, or `execute` to run commands. |
| ARG-CODEC-001 / ARG-CODEC-002 / ARG-CODEC-003 / ARG-CODEC-004 | Strict Zod-backed CLI argument codecs. | core-run-and-arg-codecs-plan.md | `arg-codecs.test.ts`, command schema projection tests, extension-transport/fetch surface tests, and property tests for numeric grammar. | Zod codec docs + JSON Schema input projection | Broad coercion remains the documented path or runtime-only outputs leak into contracts. |
| ERROR-003 | Source-aware validation errors. | core-run-and-arg-codecs-plan.md | Validation failures from argv/env/provider/fetch/extension transports preserve source metadata in machine and human output. | Structured Zod issues + Core source provenance | Error rendering scrapes messages or drops source context. |

### Config primitive

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| CONFIG-PRIM-001 | Handwritten CLIs declare config through `@liche/config`; Core owns generic input-source resolution and provenance. | config-primitive.md | Package consumer imports `config` from `@liche/config`, declares config through `defineCli({ extensions })`, and receives typed config values through `ctx.sources`. | Public API snapshot | Config remains a private loader hook, Product-only feature, or root `defineCli({ config })` field. |
| CONFIG-PRIM-002 | CLIs without the config extension do not accept config-specific globals. | config-primitive.md | Invoke no-config CLI with each flag and assert normal unknown-flag behavior. | CLI parser | Config flags silently no-op or Core reserves config-specific flags. |
| CONFIG-PRIM-003 | Explicit config path and disabled config behavior are exclusive and source-aware. | config-primitive.md | `--config` loads only one file; `--no-config` disables discovery; both together fail. | Temp filesystem fixture | Explicit files are merged with discovered files or conflicting flags are accepted. |
| CONFIG-PRIM-004 | Project/user discovery follows documented precedence. | config-primitive.md | Create user and nested project config files, run from a child cwd, and inspect resolved values/provenance. | Temp filesystem fixture | User config beats project config or upward discovery misses the nearest project file. |
| CONFIG-PRIM-005 | Config-to-option binding is explicit. | config-primitive.md | Matching config and option names do not bind until `input.sources.options` declares a provider/path binding. | CLI output fixture | Every matching option name is treated as durable config. |
| CONFIG-PRIM-006 | Unknown config keys fail under strict schema. | config-primitive.md | Config fixture includes a misspelled top-level field and asserts validation failure. | Core schema validation | Misspelled durable preferences are silently ignored. |
| CONFIG-PRIM-007 | Product config and bindings emit one config schema surface. | config-primitive.md | Product fixture with general config and bindings generates schema/docs and surface manifest entries. | Canonical catalog | Binding schema remains the only config surface or general config becomes a separate system. |
| CONFIG-PRIM-008 | General product config rejects secrets. | config-primitive.md | Product fixture marks a config field secret and lints fail. | Product lint | Tokens enter docs, config schema, release manifest, or agent surfaces. |

### Remote transport

Current status: `@liche/http` exports `serializeHttpOperationRequest` and `callHttpOperation`. `packages/extensions/http/test/http-operation.test.ts` covers `REMOTE-001` through `REMOTE-009`, plus `REMOTE-015` and `REMOTE-016`, at the transport primitive layer. Generated Product wiring calls the shared transport for literal, env, and config-backed remote base URLs; Product linting and generation fail for HTTP-backed capabilities without `remote.baseUrl`.

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| REMOTE-001 | Core exposes outbound HTTP operation transport without `@liche/product` or `@liche/build`. | build-system.md | Handwritten CLI calls transport directly. | Public API | Remote calls are generation-only. |
| REMOTE-002 | Transport serializes path/query/body mapping. | build-system.md | Fixture capability captures outgoing Request. | Fetch Request | Input fields serialized to wrong location. |
| REMOTE-003 | Missing base URL maps to structured error. | build-system.md | Omit env/config and run remote command. | Error envelope | Raw config exception leaks. |
| REMOTE-004 | Missing auth maps to structured error. | build-system.md | Omit token env and run authenticated command. | Error envelope | Raw env exception leaks. |
| REMOTE-005 | Network failure maps to structured error with retryable metadata. | http-operation-transport.md | Mock fetch rejection. | Error envelope | Raw fetch error leaks. |
| REMOTE-006 | Timeout maps to structured error with retryable metadata. | http-operation-transport.md | Mock delayed response beyond timeout. | Error envelope | Command hangs or throws raw abort. |
| REMOTE-007 | Non-2xx response maps to structured HTTP error. | build-system.md | Fixture 500 JSON/text/HTML responses. | Error envelope | HTML or raw body emitted as success. |
| REMOTE-008 | Malformed success body maps to structured error. | build-system.md | 200 with invalid JSON for JSON operation. | Error envelope | JSON parse error leaks. |
| REMOTE-009 | Output schema validates untrusted response. | build-system.md | 200 body violates output schema. | Zod + error envelope | Malformed server response returned as success. |
| REMOTE-010 | Mixed local/remote conformance holds. | build-system.md | Same input through fixture local impl and fixture backend, compare parsed output. | Output schema | Local and remote implementations drift. |
| REMOTE-011 | Server conformance uses schema as reference. | build-system.md | `liche-product conform` sends example request to fixture server and validates output. | Output schema + fixture server | OpenAPI emitted but server behavior unverified. |
| REMOTE-012 | Server conformance is separate from `generate --check`. | build-system.md | Artifact freshness check runs without server; conformance requires target. | Capability contract | CI gate conflates generated drift with live server verification. |
| REMOTE-013 | Bind coverage lints request placement. | build-system.md | Missing, unknown, and conflicting bind entries fail lint. | Input schema | Dead parameter or broken request accepted. |
| REMOTE-014 | Destructive conformance requires opt-in fixture. | build-system.md | Destructive capability without fixture is skipped with reason, not executed. | Capability policy | Conformance mutates production accidentally. |
| REMOTE-015 | Pure serializer works without network. | http-operation-transport.md | Serialize request and assert URL/method/headers/body without fetch. | Core serializer | Conformance depends on a live network call to inspect bind output. |
| REMOTE-016 | Transport throws structured core errors. | http-operation-transport.md | Mock failures and assert execution envelope contains normalized codes. | Error envelope | Transport returns mixed result shapes or leaks raw errors. |
| REMOTE-017 | Generated capabilities report applied execution mode. | build-system.md | Mixed execution fixture covers flag/config/default precedence when supported and asserts `meta.execution.mode` and `meta.execution.source`. | Standard result envelope | Agent cannot tell whether the command touched local simulation, remote HTTP, or a hybrid workflow. |
| REMOTE-018 | `--local` and `--remote` are mutually exclusive. | build-system.md | Generated mixed-mode command invoked with both flags fails before execution. | Parser error fixture | Command silently chooses one mode when the user's intent is ambiguous. |
| REMOTE-019 | Generated remote commands can resolve base URL from declared config. | config-primitive.md | Product remote fixture uses `Runtime.config("apiBaseUrl")`, config file supplies it, generated command calls `callHttpOperation`. | Core transport mock | Generated remote wiring stays env/literal-only or reads app config ad hoc. |

### Core supportability

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| CORE-OBS-001 | Lifecycle subscribers are observe-only and receive redacted command events. | ROADMAP.md | Declare `defineCli({ events: [subscriber] })`, run a command with sensitive args/options/env, and inspect captured events. | Event schema | Telemetry sees raw inputs or only command success paths. |
| CORE-OBS-002 | Subscriber failures never change command results. | ROADMAP.md | Subscriber throws during `command.started`; command output and exit code remain successful. | Command result envelope | Telemetry sink failure breaks CLI execution. |
| CORE-OBS-003 | Local lifecycle events cover non-command supportability surfaces without expanding telemetry. | ROADMAP.md | Subscribe to `*`, exercise help/version/completion/schema/not-found/MCP surfaces, and assert event names plus absence of raw argv/request payloads. | Event stream snapshot | Framework hooks become the telemetry API or leak unresolved user input. |
| CORE-OBS-004 | Telemetry sinks consume an explicit allowlist, not every lifecycle event. | ROADMAP.md | Attach a fixture telemetry subscriber that forwards only the documented allowlist while broad local events are also emitted. | Telemetry allowlist | Help, completion, schema, or MCP discovery events are exported by default. |
| CORE-OBS-005 | Telemetry config resolves from the reserved `liche.telemetry` namespace without treating command options or declared app config as telemetry controls. | ROADMAP.md | Config fixture contains `liche.telemetry`, command-option config, and unrelated declared product config keys; resolver applies precedence and leaves command option parsing unchanged. | Telemetry control resolver | Telemetry reads raw app config, collides with product keys, or ignores `--no-config`. |
| CORE-HOOK-001 | Mutation hooks run at documented points before middleware/handler execution. | ROADMAP.md | `beforeExecute` mutates context vars; middleware and handler observe the mutation in order. | Hook contract | Hooks run too late or are conflated with middleware. |
| CORE-HOOK-002 | Hook failures are command failures, unlike subscriber failures. | ROADMAP.md | `beforeExecute` throws a structured error; command returns the normalized error envelope. | Error envelope | Mutation hooks fail silently or look like telemetry failures. |

### Generated surfaces

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| SURFACE-001 | OpenAPI emits only HTTP resource operations. | build-system.md | Mixed product schema with resource HTTP ops, remote commands, hybrid commands, and local commands. | Requirement fixture | Command capability appears as an OpenAPI route before command projection is specified. |
| SURFACE-002 | OpenAPI is generated from the normalized catalog. | build-system.md | Compare OpenAPI output from equivalent product schemas. | Canonical catalog | OpenAPI generated from raw source or runtime reflection. |
| SURFACE-003 | MCP tools are generated from the catalog for schema-driven CLIs. | build-system.md | Compare generated MCP tool definitions to catalog capabilities. | Canonical catalog | Core reflection silently wins for generated CLI. |
| SURFACE-004 | Docs/reference markdown uses command vocabulary and examples. | build-system.md | Golden generated docs fixture. | Requirement fixture | Docs drift from schema examples. |
| SURFACE-005 | Generated JSON Schema is portable. | build-system.md | Generate schema for supported Zod shapes. | JSON Schema validator | Unsupported Zod construct emitted incorrectly. |
| SURFACE-006 | OpenAPI consumes HTTP bind placement and field metadata. | build-system.md | Generate OpenAPI with path/query/header/body fields plus secret/identifier metadata and inspect parameters, requestBody, descriptions, and extensions. | OpenAPI schema | All input fields emitted as body, omitted, or stripped of metadata. |
| SURFACE-007 | Schema-driven OpenAPI does not use current runtime reflection fallback. | build-system.md | Mixed product fixture proves HTTP methods, paths, operation IDs, and excluded local-only commands come from the catalog. | Canonical catalog + OpenAPI schema | Every command is emitted as `POST` regardless of REST contract or execution mode. |
| SURFACE-008 | Generated surface manifest records every emitted surface. | build-system.md | Generate a fixture with CLI, OpenAPI, MCP, docs, Agent Skill, and config schema outputs and inspect manifest records. | Surface manifest schema | Generated artifacts exist but drift/provenance cannot name their source. |
| SURFACE-009 | Surface drift reports stale surface IDs. | build-system.md | Hand-edit one generated surface and run `generate --check`. | Generated fixture | Drift failure is generic or misses non-CLI surfaces. |
| SURFACE-010 | OpenAPI-derived downstream surfaces consume OpenAPI, not raw schema or CLI output. | schema-ir-openapi.md | Adapter fixture receives only OpenAPI plus digest and fails if it reads schema/generated CLI files. | OpenAPI document + digest | SDK/Terraform/Code Mode generator couples to schema internals. |
| SURFACE-011 | Command MCP tools and Code Mode MCP are separate surfaces. | schema-ir-openapi.md | Fixture with local-only command appears in command MCP manifest but not in OpenAPI-derived downstream manifest. | Canonical catalog + OpenAPI eligibility | HTTP-only downstream MCP overwrites command MCP semantics. |
| SURFACE-012 | Product-specific surfaces require explicit adapters. | application-integration.md | Request `wrangler.jsonc`, Workers Binding RPC, dashboard metadata, or generated server/API output before adapter registration. | Requirement gate | Build silently emits partial product-specific artifacts. |
| SURFACE-013 | Command manifest is catalog-derived and includes effects/execution. | build-system.md | Generate `schema --json` or command manifest output and assert argv, input/output schemas, effects, execution mode, and examples. | Canonical catalog | Agent manifest loses CLI-only semantics or mirrors OpenAPI instead. |
| SURFACE-014 | Config JSON Schema is generated from declared general config and bindings, with only explicitly reserved runtime namespaces allowed outside strict product fields. | config-primitive.md | Product fixture declares general config fields and bindings; generated config schema includes both plus reserved runtime namespaces and rejects unknown app keys. | Canonical catalog config + bindings | Config docs/schema are absent, binding-only, hand-written separately, or silently accept misspelled product fields. |
| BUILD-031 | `@liche/product` has package-local mutation testing. | build-system.md | Add `packages/product/stryker.conf.mjs`, `mutate` script, root-catalog Stryker dev deps, and config typecheck inclusion; run the package-local mutate command for an initial report. | Stryker + Bun runner | Product package silently lacks the mutation-testing workflow already available in core. |

Test coverage:

| ID | Notes | Test file(s) |
|---|---|---|
| SURFACE-003 | Catalog-derived MCP tools gated by `surfaces.agent` | `packages/product/test/generate-surfaces.test.ts` |
| SURFACE-004 | Generated docs/reference markdown from catalog summaries, schemas, auth requirements, bindings, and capability examples | `packages/product/test/generate-surfaces.test.ts` |
| SURFACE-008 | CLI, OpenAPI, command manifest, MCP tools, agent reference, docs reference, and config schema surfaces | `packages/product/test/generate-check.test.ts` |
| SURFACE-009 | Generated artifact content and manifest metadata drift, with targeted surface ids | `packages/product/test/generate-check.test.ts` |
| SURFACE-013 | Command path, input/output/env schemas, execution, auth/context/permission requirements, effects, policy, examples; lints reject missing safety metadata for agent/OpenAPI-visible capabilities | `packages/product/test/generate-surfaces.test.ts`, `packages/product/test/vocabulary-lints.test.ts` |
| SURFACE-014 | Binding-derived config schema | `packages/product/test/generate-surfaces.test.ts` |

### Auth and session

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| AUTH-001 | Auth providers and capability requirements normalize into the catalog. | auth-session.md | Product fixture declares provider, permissions, contexts, and capability `requires`; inspect catalog. | Canonical catalog | Auth modeled as ad hoc generated CLI behavior. |
| AUTH-002 | `SecretString` redacts through string and JSON paths. | auth-session.md | Wrap token and assert `String(secret)`, JSON, error details, and metadata redact. | Redaction type | Token leaks through logs or envelopes. |
| AUTH-003 | Env bearer/API key resolution is deterministic. | auth-session.md | Resolve auth with env present/missing across CLI, CI, and agent invocations. | Resolution table | Agent or CI falls back to interactive/session behavior unexpectedly. |
| AUTH-004 | Context resolution follows flag > env > allowed stored profile context. | auth-session.md | Fixture covers explicit flag, context env, stored profile, env credential plus explicit profile. | Resolution table | Wrong org/project selected silently. |
| AUTH-005 | Generated auth commands are catalog capabilities. | auth-session.md | Provider fixture emits `whoami`/`switch` and later `login`/`logout` with auth effects and surfaces. | Catalog snapshot | Auth commands become hard-coded built-ins or agent-visible mutators. |
| AUTH-006 | Normal operations never trigger login implicitly. | auth-session.md | Auth-required command without credential fails; generated `login` is the only device-flow path. | CLI behavior | Agent or CI command opens browser/device flow. |
| AUTH-007 | Session store handles permissions, locking, and corruption. | auth-session.md | Temporary store asserts mode, atomic write, lock timeout, corrupt rename. | Filesystem fixture | Corrupt sessions silently reset or concurrent writes corrupt state. |
| AUTH-008 | 401/403 map through auth-aware error rules. | http-operation-transport.md | Mock 401/403 with/without auth requirement and known scopes. | Error envelope | Every 401 is called expired or every 403 becomes generic HTTP. |
| AUTH-009 | Agent/MCP auth metadata is useful and secret-free. | auth-session.md | Generated MCP/tool metadata includes requirements/status and excludes tokens, env values, paths, user codes. | Metadata snapshot | Agent gets secrets or cannot explain missing auth. |
| AUTH-010 | Release manifest records non-secret auth expectations. | distribution.md | Manifest fixture includes auth providers, env names, commands, contexts, session posture, no secrets. | Manifest schema | Release artifact hides auth requirements or leaks runtime state. |
| AUTH-011 | Auth global flags are generated only for auth-enabled CLIs. | auth-session.md | Compare generated help for auth and no-auth product fixtures. | CLI help snapshot | `--profile`/`--no-session` pollute unauthenticated CLIs. |
| AUTH-012 | Local scope checks are best-effort and server remains authoritative. | auth-session.md | Known missing scope fails locally; unknown scopes call server and map 403. | Scope fixture + HTTP mock | CLI blocks valid tokens or treats local scopes as definitive authorization. |

Test coverage:

| ID | Notes | Test file(s) |
|---|---|---|
| AUTH-001 | env-only resolution | `packages/product/test/catalog-normalization.test.ts` |
| AUTH-002 | redaction through all paths | `packages/core/test/auth/secret.test.ts`, `packages/core/test/auth/errors.test.ts` |
| AUTH-003 | env-only resolution across CLI/CI/agent | `packages/core/test/auth/resolve.test.ts` |
| AUTH-004 | flag/env/stored-profile fallback | `packages/core/test/auth/resolve.test.ts`, `packages/product/test/generate-cli-auth.test.ts` |
| AUTH-005 | whoami/switch/login/logout as generated capabilities | `packages/product/test/` |
| AUTH-006 | missing-env fails with `AUTH_MISSING`, never reaches transport | `packages/product/test/generate-cli-auth.test.ts` |
| AUTH-007 | file store with permissions/lock/atomic write/corrupt rename | `packages/core/test/` |
| AUTH-008 | 401/403 mapping | `packages/core/test/` |
| AUTH-009 | static requirements/status metadata + resolved session status | `packages/product/test/generate-cli-auth.test.ts` |
| AUTH-010 | env modes/contexts + session/OAuth-device entries | `packages/product/test/catalog-normalization.test.ts` |
| AUTH-011 | no-auth product emits no auth runtime | `packages/product/test/generate-cli-auth.test.ts` |
| AUTH-012 | local `AUTH_SCOPE_MISSING` + server-deferred unknown scopes | `packages/core/test/auth/errors.test.ts`, `packages/core/test/auth/resolve.test.ts` |

### Distribution

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| RELEASE-001 | Manifest validates against schema. | distribution.md | Validate generated fixture manifest. | Zod manifest schema | Renderer consumes invalid manifest. |
| RELEASE-002 | Manifest records subject/contract provenance. | distribution.md | Assert subject id/name/version/commit/contract kind/contract digest. | Build record fixture | Binary not traceable to the source contract. |
| RELEASE-003 | Manifest records runtime env/config expectations. | distribution.md | Remote config fixture includes env expectations. | Catalog | Binary runtime contract discoverable only by failing at runtime. |
| RELEASE-004 | Binary hash and size use final signed bytes. | distribution.md | Sign/mutate fixture bytes before hashing. | sha256/file size | Hash computed before signing. |
| RELEASE-005 | npm renderer pins exact platform package versions. | distribution.md | Render umbrella package and inspect optionalDependencies. | Manifest | Version skew accepted. |
| RELEASE-006 | npm renderer emits no lifecycle scripts. | distribution.md | Inspect package JSONs. | npm package JSON | Install-time execution added. |
| RELEASE-007 | npm renderer writes package directories and derived `.tgz` artifacts whose binary hash matches the manifest. | distribution.md | Inspect package directories; pack, unpack, hash executable. | sha256 | Renderer only emits opaque tarballs or staging verification misses packed artifact drift. |
| RELEASE-008 | npm shim gives actionable missing optional error. | distribution.md | Simulate missing platform package. | Requirement fixture | Module resolution error leaks. |
| RELEASE-009 | Renderer interface is pure manifest plus verified binary records to staged package. | distribution.md | Renderer test runs without schema/build output. | Dependency boundary | Renderer reads non-manifest state. |
| RELEASE-010 | Yank command uses one manifest reference. | distribution.md | Dry-run yank fixture for npm and future ecosystems. | Manifest | Yank requires ad hoc package names. |
| RELEASE-011 | npm platform packages verify directory contents and final `.tgz` binaries. | npm-binary-packaging.md | Inspect package directory fields; pack, unpack, hash, and inspect package fields. | Manifest + sha256 | Directory output and packed artifact drift apart. |
| RELEASE-012 | Renderer selection supports zero to all renderers inside `@liche/releases`. | release-and-distribution.md | Release config fixtures cover `[]`, one renderer, multiple renderers, and `all`. | Decision record | npm-only flow or separate `release-extra` package becomes the architecture. |
| RELEASE-013 | `@liche/releases` consumes build output as manifest/data, not by importing `@liche/core`, `@liche/build`, or `@liche/product`; concrete renderers stay behind subpath exports. | invariant.md | Package boundary test inspects runtime dependencies, imports `@liche/releases` without concrete renderers, and checks renderer subpath exports. | Package graph | Release code reaches around the manifest into core/build/product internals or root imports every renderer. |
| RELEASE-014 | Publish automation derives npm/PyPI/Homebrew/Scoop mutations from one manifest. | ROADMAP.md | Dry-run publish plan for all implemented publishers from one manifest fixture. | Manifest + verified artifact records | Publisher requires ad hoc package names, versions, or workspace state. |
| RELEASE-015 | Selected publisher credentials and repository settings fail before mutation. | ROADMAP.md | Missing npm/PyPI token or Homebrew/Scoop repo config fails during preflight. | Dry-run/preflight fixture | Partial publishes happen before config errors surface. |
| RELEASE-016 | Publish rechecks final artifact hashes immediately before upload/update. | ROADMAP.md | Tamper with a packed artifact after verification and before publish. | sha256 | Stale or tampered artifact is published. |
| RELEASE-017 | npm publish ordering publishes platform packages before the umbrella package. | ROADMAP.md | Capture publish calls and assert platform packages precede umbrella package. | Publish call log | Umbrella package becomes installable before optional binary packages exist. |
| RELEASE-018 | Binary target string agrees with platform, arch, libc, and cpu variant. | distribution.md | Fixture includes baseline x64, musl, and mismatched target records. | Bun target parser | Wrong binary selected for package renderer or release matrix. |
| RELEASE-019 | Verified artifact records include renderer, ecosystem, kind, version, sha256, and size. | distribution.md | Fixture renderer emits artifact records and verifier rejects incomplete records. | Manifest package IDs + packed artifact hash | Publishing cannot map verified artifacts back to manifest IDs. |
| RELEASE-020 | Renderer preflight is separate from publisher credential preflight. | distribution.md | Renderer selection with absent credentials still stages artifacts; publisher preflight fails before mutation. | Renderer/publisher boundary | Rendering is blocked by missing registry credentials or publishing starts during render. |
| RELEASE-021 | Release provenance integrates supported registry/CI attestations without replacing hash verification. | distribution.md | Fixture records npm/PyPI/GitHub provenance metadata and still rejects tampered package bytes. | Attestation metadata + sha256 | Attestation presence bypasses binary/package hash verification. |

Test coverage:

| ID | Notes | Test file(s) |
|---|---|---|
| RELEASE-001 / 002 / 003 | manifest schema, provenance, runtime env/config | `packages/releases/test/manifest.test.ts` |
| RELEASE-004 / 018 | final-bytes hash and target normalization | `packages/releases/test/binary.test.ts` |
| RELEASE-005 / 006 / 007 / 008 / 011 / 019 | npm/PyPI/Homebrew/Scoop renderers and artifact records | `packages/releases/test/ecosystem-renderers.test.ts` |
| RELEASE-009 / 012 / 020 | shared renderer contract + selection + orchestration | `packages/releases/test/release-package.test.ts`, `packages/releases/test/renderer-selection.test.ts` |
| RELEASE-010 | dry-run yank planning | `packages/releases/test/yank.test.ts` |
| RELEASE-013 | release package boundary | `packages/releases/test/package-boundary.test.ts` |

### V1 public-readiness

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| V1-001 | Every publishable package can be packed and consumed from a temp Bun project. | ROADMAP.md | Pack each package, install packed artifacts into a temp project, and import documented root/subpath exports. | Package READMEs + export maps | Package works only through workspace source paths or unpublished internals. |
| V1-002 | Public README and package READMEs describe runnable v1 workflows. | ROADMAP.md | Execute README quickstart and package README code blocks through examples or temp projects. | Public docs | Documentation points at internal planning docs or stale package names. |
| V1-003 | V1 examples dogfood package boundaries. | ROADMAP.md | `bun run examples:smoke` runs handwritten, generated, remote/conformance, compile, and release examples. | Example fixtures | Examples import source-relative internals or skip the release path. |
| V1-004 | Public docs are curated separately from internal requirement docs. | ROADMAP.md | Package/website file-list check excludes internal requirement docs unless explicitly curated. | Package `files` lists + site inputs | Internal agent/planning docs are shipped wholesale as user docs. |
| V1-005 | LOC, export, dependency, and boundary metrics are tracked before release candidates. | ROADMAP.md | `bun run --silent metrics` records package source LOC, test LOC, public exports, runtime dependencies, and boundary exceptions; the release-candidate gate runs it. | Metrics baseline | Simplification is asserted without a measured baseline or regression signal. |
| V1-006 | Hosted service/platform work is V2 and does not block package publication. | ROADMAP.md | Release checklist fails if hosted-service tasks are required for package pack/temp-consumer/example/release dry-run success. | V1/V2 cutline | A website/backend product becomes an accidental dependency of publishing the libraries. |
| V1-007 | V1 telemetry is opt-in local instrumentation, not hosted ingestion. | ROADMAP.md | Fixture command emits lifecycle events to a local sink only when enabled; redaction tests cover secrets, env values, context values, and local paths; subscriber failures do not alter results. | Telemetry event schema | Telemetry leaks secrets, becomes mandatory for command execution, or uses mutation hooks as its collection path. |
| V1-008 | Generated diagnostics are available without a hosted service. | ROADMAP.md | `doctor` fixtures cover local install/PATH/package-manager checks plus Product catalog/config/remote/auth/session/context/static-notice/agent-readiness checks and emit structured envelopes. | Diagnostic schema | Supportability depends on manual debugging, leaks secrets, drops undeclared env vars, or requires a SaaS backend. |
| V1-009 | Local catalog/discovery artifacts are versioned and drift-checked. | ROADMAP.md | Generate CLI, command manifest, surface manifest, MCP/agent discovery, and release metadata; mutate one artifact and assert targeted drift. | Generated catalog manifests | Hosted catalog assumptions hide stale local artifacts. |
| V1-010 | Install/update/channel UX works from static release metadata. | ROADMAP.md | Fixture `ops.release` metadata drives generated docs, discovery JSON, `release --json`, `doctor --json` release checks, version/update status, channel selection, yanked-version notices, and package-manager wrapper diagnostics. | Static Product release metadata | Generated CLIs need a hosted update service or a runtime `@liche/releases` dependency to explain install or channel state. |
| V1-011 | Public release metadata and support policy are explicit before publication. | release-and-distribution.md | Offline metadata gate checks LICENSE/SECURITY/SUPPORT/CHANGELOG, package LICENSE files, narrow package file lists, no placeholder package metadata, and release scripts; live npm-name probe stays manual. | Public release metadata policy | Packages publish without license/support/security policy, with placeholder URLs, or with registry-name assumptions treated as ownership. |

### Docs

| ID | Requirement | Source | Test shape | Oracle | Known-bad implementation caught |
|---|---|---|---|---|---|
| DOCS-001 | `docs/` stays internal — never shipped as package or command. | invariant.md | File presence and package exports check. | Repo tree | Docs shipped as package or command. |
| DOCS-003 | Reading order is maintained. | AGENTS.md | Docs lint requires reading-order entry for docs page changes. | Repo tree | Docs pages drift without navigation. |
| DOCS-004 | Claims trace to requirement, upstream, or user instruction. | AGENTS.md | Spot-check or docs lint for citations. | Docs rules | Unsupported claims become agent lore. |

## Test plans

### Build system

Priority order:

1. Core package boundary.
2. Product package schema normalization and canonical catalog digest.
3. Schema lints.
4. Generated command tree through public core APIs.
5. Core-owned remote transport.
6. Server conformance against owned HTTP deployments.
7. Generated surface manifest and drift checks.
8. Generated surfaces.
9. Product package mutation testing.
10. Generic build compile command.

First useful slice proves:

- a handwritten core CLI still works without product/build packages
- a schema normalizes into a deterministic catalog
- one generated command declares through `defineCli()` / `defineCommand()`
- generated and handwritten command outputs match for the same input
- fixtures include both CRUD-like commands and workflow commands

The surface graph slice proves a single surface manifest tracks CLI, command manifest, OpenAPI, MCP, Agent Skill, docs, and config schema, with `generate --check` reporting stale surface IDs and product-specific adapters failing clearly without explicit registration.

The remote slice proves handwritten and generated CLIs share core transport, output schemas validate untrusted HTTP responses, and non-2xx/malformed responses become structured errors.

The application integration slice proves a Vite/TanStack-style fixture app defines capabilities (not derives commands from UI routes), implements matching API routes manually, generates CLI calling through core HTTP transport, and conforms against the fixture dev server.

The conformance slice proves `generate --check` runs without a server, `conform` requires a base URL/target, read-only examples run against a fixture server, and destructive capabilities skip unless explicitly fixture-backed.

The compile slice proves `@liche/build` constructs a plain compile flag profile from which both `Bun.build()` options and `compileFlagsDigest` derive; local/temp/output paths and metafile/build logs do not affect the digest; `Bun.build()` is injected in tests; `@liche/releases` consumes only final binary facts plus the compile flag digest.

### Auth and session

Priority order:

1. Catalog normalization for auth providers, contexts, permissions, and capability requirements.
2. Secret redaction.
3. Env token resolution and structured auth errors.
4. Context resolution.
5. Generated auth command surfaces.
6. Transport integration and 401/403 mapping.
7. Session store behavior.
8. Agent/MCP metadata.
9. Release manifest auth metadata.

Env auth and capability requirements:

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/product/test/auth-catalog.test.ts` | AUTH-001 | Product schema auth providers, permissions, contexts, and `requires` normalize into plain catalog data. | Auth is generated as hidden CLI behavior instead of catalog metadata. |
| `packages/core/test/secret-string.test.ts` | AUTH-002 | `SecretString` redacts through string, JSON, error, and metadata paths; only explicit reveal returns raw value. | Token leaks through logging or envelopes. |
| `packages/core/test/resolve-auth-env.test.ts` | AUTH-003 | Env bearer/API key resolution works across CLI/CI/agent modes and missing env returns structured errors. | CI/agent silently use sessions or raw env errors leak. |
| `packages/core/test/resolve-context.test.ts` | AUTH-004 | Context flags beat env, env beats stored context, and stored context is used only when allowed. | Wrong org/project selected silently. |
| `packages/product/test/generated-auth-flags.test.ts` | AUTH-011 | Auth-enabled generated CLIs get `--profile`, `--non-interactive`, and `--no-session`; no-auth CLIs do not. | Auth globals pollute public unauthenticated CLIs. |
| `packages/product/test/generated-auth-runtime.test.ts` | AUTH-003, AUTH-004, AUTH-006 | Generated command resolves auth/context before transport and never starts login implicitly. | Generated code passes raw tokens or starts device flow from normal commands. |

Sessions and auth commands:

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/product/test/auth-command-capabilities.test.ts` | AUTH-005 | `whoami` and `switch` emit normal catalog capabilities with auth effects, policies, and surfaces. | Auth commands are hard-coded built-ins or agent-visible mutators. |
| `packages/core/test/session-store.test.ts` | AUTH-007 | File store uses restricted permissions, lock file, atomic write/rename, corrupt-file rename, and profile naming validation. | Corrupt sessions reset silently or concurrent writes corrupt state. |
| `packages/product/test/auth-agent-metadata.test.ts` | AUTH-009 | Agent/MCP metadata includes auth requirements/status and excludes tokens, env values, paths, and device codes. | Agent cannot recover from auth failure or receives secrets. |

OAuth device login:

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/product/test/oauth-device-commands.test.ts` | AUTH-005, AUTH-006 | `login`/`logout` are generated capabilities only when OAuth/session source is configured. | OAuth commands appear for env-only products or as hidden built-ins. |
| `packages/core/test/oauth-device-flow.test.ts` | AUTH-006 | Device user code appears only for interactive login; noninteractive, CI, agent, and MCP fail with `AUTH_INTERACTIVE_REQUIRED`. | Agent/CI receives device code or browser flow starts unexpectedly. |

Transport and release:

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/core/test/auth-http-status.test.ts` | AUTH-008, AUTH-012 | 401/403 map according to auth requirement and known scopes; unknown scopes defer to server response. | All 401s become expired or local scope checks block valid tokens. |
| `packages/releases/test/auth-manifest.test.ts` | AUTH-010 | Release manifest records provider IDs, modes, env var names, auth command names, context selectors, and session posture without secrets. | Release artifact leaks runtime session state or hides auth requirements. |

Fixture rules:

- Do not use real OAuth services.
- Do not write to the user's actual config directory; always pass a temporary store root.
- Do not place raw token strings in golden snapshots.
- Any expected error fixture must assert that token values, env values, user codes, and full local paths are absent.

### Release guard rails

Priority order:

1. Manifest schema validation.
2. Product/catalog and runtime provenance.
3. Conformance report metadata when release policy requires it.
4. Final binary hash and size.
5. npm package rendering.
6. Final `.tgz` verification.
7. Renderer purity.
8. Yank dry run.
9. Target normalization and package artifact records.
10. Extra renderers when justified.

The first release slice is the manifest, binary verification, renderer registry, renderer selection, and final-artifact verification loop. The test plan covers `renderers: []` so manifest-only release verification is valid.

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/releases/test/manifest.test.ts` | RELEASE-001, RELEASE-002, RELEASE-003 | Manifest schema validates metadata, executable metadata, subject/contract provenance, runtime env/config, conformance metadata, and binary target entries. | Renderer accepts invalid or untraceable manifest data. |
| `packages/releases/test/binary.test.ts` | RELEASE-004 | Hash and size are computed from final binary bytes after a simulated signing mutation. | Release hashes pre-signing bytes or ignores size drift. |
| `packages/releases/test/target-normalization.test.ts` | RELEASE-018 | Exact Bun target strings agree with normalized platform, arch, libc, and cpu variant fields. | Release matrix silently labels a baseline/musl artifact incorrectly. |
| `packages/releases/test/renderer-selection.test.ts` | RELEASE-009, RELEASE-012, RELEASE-020 | Empty, one, many, and all selections work; unsupported or underconfigured selected renderers fail before staging; absent publisher credentials do not block rendering. | npm-only control flow, implicit all-renderer behavior, or credential checks mixed into renderer selection. |
| `packages/releases/test/release-package.test.ts` | RELEASE-009, RELEASE-012, RELEASE-019, RELEASE-020 | The orchestration path validates the manifest, verifies binaries, invokes a fixture renderer with manifest data plus verified binary records, packs artifacts, records verified artifact metadata, and verifies the packed output. | Renderer reads product schema/build workspace state, omits artifact records, or verifies only staging directories. |
| `packages/releases/test/yank.test.ts` | RELEASE-010 | Yank dry run derives affected artifacts from one manifest reference. | Yank requires ad hoc package names or ecosystem-specific manual input. |
| `packages/releases/test/package-boundary.test.ts` | RELEASE-013 | `@liche/releases` has no runtime dependency on `@liche/core`, `@liche/build`, or `@liche/product`; build output is consumed as data; concrete renderers stay behind renderer subpath exports. | Release code reaches around the manifest into build/core/product internals, or the root export pulls every renderer implementation. |
| `packages/releases/test/ecosystem-renderers.test.ts` | RELEASE-005, RELEASE-006, RELEASE-007, RELEASE-008, RELEASE-011, RELEASE-019 | npm/PyPI/Homebrew/Scoop renderers produce package artifacts from one manifest plus verified binary records; npm tarballs, PyPI wheels, Homebrew formulae, and Scoop JSON are inspected. | Renderer emits invalid package-manager artifacts, accepts lifecycle scripts, loses binary hashes, or only verifies staging directories. |

Publishing automation tests (post-renderer artifact phase):

| Test file | Requirement IDs | Must prove | Known-bad implementation caught |
|---|---|---|---|
| `packages/releases/test/publish-plan.test.ts` | RELEASE-014 | A dry-run plan derives npm, PyPI, Homebrew, and Scoop mutations from one manifest plus verified artifact records. | Publisher requires ad hoc package names, versions, or workspace reads. |
| `packages/releases/test/publish-preflight.test.ts` | RELEASE-015 | Selected publishers fail on missing credentials or repository settings before mutation; unselected publishers are ignored. | Partial publishes happen before config errors surface. |
| `packages/releases/test/publish-artifacts.test.ts` | RELEASE-016 | Artifact hashes are rechecked immediately before publish. | Stale or tampered packed artifacts are uploaded. |
| `packages/releases/test/npm-publish-order.test.ts` | RELEASE-017 | npm platform packages publish before the umbrella package. | Users can install the umbrella before optional platform packages exist. |
| `packages/releases/test/provenance.test.ts` | RELEASE-021 | npm/PyPI/GitHub provenance metadata can be recorded when configured, but sha256 verification still gates publish. | Attestation metadata is treated as a substitute for artifact verification. |

Fixture rules:

- Use temporary files with synthetic executable bytes; do not require a real Bun-compiled binary for guard-rail tests.
- Simulate signing by mutating bytes before manifest hash calculation, then mutate again to assert verification failure.
- Keep fixture renderers inside tests. They may pack a simple final artifact, but they must not become npm package scaffolding.
- Fixture renderer outputs must include verified artifact records with renderer, ecosystem, kind, version, sha256, and size.
- Do not import `@liche/core`, `@liche/build`, or `@liche/product` from `@liche/releases` tests except from the explicit package-boundary test that proves they are absent.

Final artifact rule: never accept a staging directory verification as the final proof. For the shared release spine, verify final artifact file bytes against package records. For ecosystem renderers, pack the artifact, unpack it, inspect it, and hash the binary bytes inside the packed artifact.
