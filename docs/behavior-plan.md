# Lili behavior plan

This file is the source of truth for tests. Tests should be derived from these cases, not from implementation details.

See [env-vars.md](./env-vars.md) for the env var contract (option defaults via `optionEnv`, validated env via the `env:` schema, and the `bunEnv()` access rule). See [config-primitive.md](./config-primitive.md) for the target first-class config contract; the existing `CFG-*` rows cover the current compatibility loader until that implementation slice lands.

## Goals

- Keep the public authoring API centered on `defineCli()`, `defineCommand()`, `.serve()`, `.fetch()`, `middleware()`, and `z`. Command declaration is data-first only; lifecycle events, hooks, and middleware are declared through `defineCli()` data, not fluent instance mutators.
- Use Bun-native edges for process/runtime work: `Bun.argv`, `Bun.env`, `Bun.file`, `Bun.write`, Bun Shell, Bun stdin/stdout, and `bun:test`.
- Use small runtime dependencies where they provide concrete feature parity:
  - `zod` for public schema compatibility and JSON Schema conversion.
  - `tokenx` for token count and slicing.
  - `yaml` for config/output stringification.
- Keep implementation modules small enough for focused review and mutation testing.

## Behavior cases

| ID | Area | Requirement | Tests | Known-bad implementation this should catch |
|---|---|---|---|---|
| CLI-001 | Command resolution | If no subcommand matches, the root command runs. | `contract.test.ts` | Always requiring a subcommand. |
| CLI-002 | Command resolution | A subcommand takes precedence over a root command. | `contract.test.ts` | Running root before checking subcommands. |
| CLI-003 | Aliases | Command aliases resolve to the original command. | `contract.test.ts` | Registering aliases as separate empty commands. |
| ARG-001 | Positionals | Object args bind by schema key order. | `contract.test.ts` | Treating all args as a raw array. |
| ARG-002 | Flags | `--flag`, `--no-flag`, `--flag=value`, short aliases, and `--` are parsed correctly. | `contract.test.ts`, `property.test.ts` | Treating `false` as missing, ignoring `--`, or not resolving camel/kebab names. |
| CFG-001 | Config | Config values load before CLI values, so CLI overrides config. | `contract.test.ts` | Merge order of CLI then config. |
| ENV-001 | Env | Command env schemas validate the supplied environment object. | `contract.test.ts` | Reading only `process.env` or skipping env validation. |
| ENV-002 | Env | `optionEnv` populates option defaults; precedence is argv > env > config > default. | `contract.test.ts` | Letting env beat argv, or skipping env entirely. |
| ENV-003 | Env | `src/` reads env only through `bunEnv()`; `process.env`/`Bun.env`/`import.meta.env` are forbidden elsewhere. | `env-conventions.test.ts` | Scattering direct env reads across modules. |
| MW-001 | Middleware | Middleware runs around handlers and can share `ctx.var`. | `contract.test.ts` | Not awaiting `next()` or losing vars. |
| FMT-001 | Formatter default | Formatter output defaults to JSON. | `formatter-default.test.ts` | Defaulting to a non-JSON plugin renderer. |
| FMT-002 | JSONL | JSONL output is one valid JSON value per line. | `property.test.ts` | Joining with commas or pretty JSON. |
| HTTP-001 | Fetch | `cli.fetch()` dispatches URL path segments and query/body options. | `contract.test.ts` | Ignoring query params or not wrapping results. |
| SCHEMA-001 | Schema | `--schema` is generated from Zod schemas. | `contract.test.ts` | Hand-written schema snapshots. |
| LLM-001 | LLM index | `--llms` emits a markdown command index unless format is explicit. | `golden.test.ts` | Formatting the index as JSON by default. |
| HELP-001 | Help | Help shows usage, command descriptions, args/options, builtins, and globals. | `golden.test.ts` | Hidden builtins or stale option names. |
| HELP-002 | Help hint | `hint` is rendered after `Examples:` in `--help` and as a `>` blockquote in skill markdown. | `parity.test.ts` | Dropping the hint when other sections are missing. |
| USAGE-001 | Usage object | `usage[].prefix`/`suffix` wrap the rendered command; args/options can be objects or arrays. | `parity.test.ts` | Ignoring prefix/suffix or refusing object form. |
| STREAM-001 | Streaming | Async generator `run()` writes one line per yield in CLI mode and one NDJSON record per yield (plus a trailing envelope) over `cli.fetch()` when `accept: application/x-ndjson`. | `parity.test.ts` | Buffering yields into one array. |
| OPT-DEP-001 | Deprecated options | Zod option `.meta({deprecated:true})` produces `[deprecated]` in `--help`, **Deprecated.** in skill docs, `deprecated:[…]` in `--schema`, and a `warning: --flag is deprecated` stderr line when invoked on a TTY. | `parity.test.ts` | Silently accepting deprecated flags. |
| MCP-ADD-001 | mcp add flags | When the `mcp` helper built-in is enabled, `mcp add` accepts `-c/--command`, `--agent`, `--no-global` and writes the right file per agent: `~/.claude.json` / `./.mcp.json` for claude-code; `~/.cursor/mcp.json` / `./.cursor/mcp.json` for cursor; generic `~/.config/lili/mcp/<name>.json` otherwise. | `parity.test.ts` | Always writing a generic config or exposing helper commands without opt-in. |
| SKILLS-ADD-001 | skills add agent | When the `skills` helper built-in is enabled, `skills add --agent <agent>` writes to the agent's skill directory; `--no-global` chooses the project location; packaged skill content is used when `DefineCliOptions.skill` is set. | `parity.test.ts`, `skill-markdown.test.ts` | Hardcoding `~/.claude/skills/`, ignoring packaged skill content, or exposing helper commands without opt-in. |
| MCP-NAME-001 | MCP tool names | `tools/list` returns tool names with whitespace replaced by `_`; `tools/call` resolves underscored names back to the canonical command path. | `parity.test.ts` | Returning space-separated names that MCP clients reject. |
| AGENT-FLIP-001 | `--json` flips agent | Explicit `--json`/`--format` sets `c.agent` to `true` even on a TTY. | `parity.test.ts` | Leaving `c.agent` tied to the raw TTY check. |
| LLMS-SHAPE-001 | `--llms` JSON shape | `--llms --format json` returns `{ manifestVersion: 'lili.v1', name, commands: […] }` with per-command `description`, `aliases`, `examples`, `hint`, `usage`, `outputPolicy`, and `schema`. | `parity.test.ts` | Dropping examples/hint/usage from the manifest. |
| CONFIG-002 | Config flags global | `--config <path>` and `--no-config` are always accepted; passing `--config` to a CLI without a `config` schema is a `ParseError`. | `parity.test.ts` | Treating `--config` as a positional. |
| CONFIG-003 | First-class config | A declared config primitive produces typed `ctx.config` and source provenance without folding provenance into values. | planned | Returning raw loader output or losing source information. |
| CONFIG-004 | Config discovery | `--config <path>` loads exactly that file, `--no-config` disables project/user discovery, and passing both is invalid. | planned | Merging explicit files with discovered files or silently accepting conflicting flags. |
| CONFIG-005 | Explicit option binding | Config values satisfy command options only through explicit option-to-config bindings. | planned | Auto-binding every matching option name to a config key. |
| CONFIG-006 | Config schema strictness | Unknown config keys fail by default under strict schema validation. | planned | Silently ignoring misspelled durable preferences. |
| OPENAPI-001 | OpenAPI emit | `GET /openapi.json` returns a `3.1.0` document keyed by command paths with `operationId` derived from the underscored command name. | `parity.test.ts` | Returning the legacy manifest. |
| OPENAPI-002 | OpenAPI ingest | `ingestOpenApi(spec)` maps path/query/body parameters into typed command descriptors. | `parity.test.ts` | Dropping body parameters. |
| VARS-001 | Vars defaults | Zod `vars` defaults populate `c.var`; middleware `set()` overrides those defaults. | `parity.test.ts` | Letting defaults clobber middleware-set values. |

## Test-authoring rules

- A generated test must point to at least one behavior case ID.
- A generated test must state what bad implementation it would catch when adding a new behavior case.
- Tests should prefer public CLI/fetch APIs over private module calls, except property tests for parser/formatter invariants.
- Tests should use external oracles when available.
- Mutation testing is used to verify sensitivity, not to reward test volume.

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
src/cli/serve.ts
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
