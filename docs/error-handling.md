# Core error handling

Status: authoritative design note for `@liche/core`. This document decides the simple error model core should converge on. It does not reopen the settled result envelope, structured recovery fields, config precedence, or agent-native output contract.

## Goal

Core has one machine error contract:

```ts
type Result =
  | { ok: true; data: unknown; error: null; meta?: ResultMeta }
  | { ok: false; data: null; error: CommandError; meta?: ResultMeta };
```

Everything agent-facing, script-facing, MCP-facing, and generated-CLI-facing must reduce to that shape. The `error` branch is a normal `CommandError` object, not an `Error` instance.

## Audit summary

The flow now follows the split this document defines:

- `CommandError` is already the inner machine object. It carries stable `code` / `message`, RFC-9457-shaped fields (`type`, `title`, `status`, `detail`, `instance`), validation fields, and agent recovery fields (`retry_after`, `suggested_fix`, `code_actions`).
- `Result` is already a total envelope with explicit null branches.
- `toCommandError()` already normalizes thrown internal errors into `CommandError`.
- `ok()`, `fail()`, and `commandError()` are public package-root factories for command-authored outcomes.
- `ctx.ok()` and `ctx.error()` return factory-branded `Result` objects instead of throwing a sentinel.
- `serveCli()` already serializes non-human failures as the full result envelope, even for handwritten CLIs.
- `MCP tools/call` already maps command failures to `CallToolResult.isError` content.
- Error classes (`BaseError`, `LicheError`, `ParseError`, `ValidationError`) and `toCommandError()` stay internal source-path implementation details, not package-root authoring APIs.

## Decision

Use two lanes.

### Lane 1: command-authored outcomes return objects

Command handlers, generated command code, helper built-ins, release/build/product CLI wrappers, and extension lanes should return standardized result objects for expected outcomes:

```ts
return ok(data, meta);
return fail(commandError({
  code: "AUTH_MISSING",
  message: "Authentication required.",
  suggested_fix: "Run `app login` before retrying.",
}));
```

This lane is for user-recoverable, domain, policy, validation, auth, remote, and preflight outcomes that the command deliberately reports.

No command author should need to construct or throw `LicheError`.

### Lane 2: internal runtime plumbing may throw

Internal parser, schema, config loading, auth resolution, HTTP transport, and framework invariant code may throw typed internal errors when returning unions would spread boilerplate through many helper calls.

This lane is allowed only behind executor-owned normalization:

```ts
catch (error) {
  return fail(toCommandError(error));
}
```

The thrown value must not cross a public machine-output boundary. It is implementation control flow, not the output contract.

## Why this is the simplest split

Returning `Result` everywhere sounds simpler, but it is not simpler inside deep helper stacks. It forces every parser, schema, auth, session, and HTTP helper to return `T | Result` or `Result<T, E>`, then forces every caller to branch and rewrap. That duplicates executor behavior and makes successful data flow harder to read.

Throwing everywhere is also wrong. It makes normal command failures look exceptional, forces `ctx.ok()` / `ctx.error()` to use hidden control flow, and encourages public authors to import classes instead of returning serializable objects.

The optimal split is therefore:

- return standardized result objects at command boundaries
- throw only inside internal helpers where stack unwinding is cheaper than union plumbing
- normalize every throw before it reaches CLI/MCP/fetch output

## Standard factories

The target public authoring helpers are:

```ts
ok(data?: unknown, meta?: ResultMeta): Result;
fail(error: CommandError, meta?: ResultMeta): Result;
commandError(input: CommandError): CommandError;
```

Rules:

- `ok()` always sets `error: null`.
- `fail()` always sets `data: null`.
- `commandError()` fills `code`, `message`, `detail`, `title`, `type`, and `exitCode` defaults.
- `commandError()` accepts RFC/recovery fields directly; do not put recovery data inside `details` when a first-class field exists.
- `details` is for structured diagnostic payloads only. It must not contain raw tokens, env values, request bodies, session file contents, or full local paths.
- `fieldErrors` is reserved for schema/validation failures and should use stable paths such as `$`, `$.option`, or `$.body.id`.

Implementation note: these factories live with the internal error normalizer in `packages/core/src/errors/error.ts` and are exported from the package root.

## Public API policy

The public command-authoring API prefers values and factories:

- keep public: `CommandError`, `FieldError`, `Result`, `ResultMeta`
- keep public: `ok`, `fail`, `commandError`
- keep internal: `BaseError`, `LicheError`, `ParseError`, `ValidationError`, `toCommandError`

Tests may keep importing internals by source path for white-box validation, but that is not evidence that a class belongs in the package-root API.

## Runtime flow

The executor should converge on this flow:

1. Parse argv/config/env.
2. Run hooks and middleware.
3. Run the command handler.
4. If the handler returns a factory-branded `Result`, use it directly.
5. If the handler returns an async generator, stream chunks and finish with `ok(collected)`.
6. Otherwise validate the handler value against the declared output schema and return `ok(validatedData)`.
7. If parser/schema/auth/http/internal code throws, catch it once, normalize through `toCommandError()`, and return `fail(normalizedError)`.
8. Emit lifecycle events from the final `Result`.
9. Render stdout/stderr according to the output mode.

Important: do not treat arbitrary `{ ok, data, error }` objects as control results. That reintroduces the ambiguity where domain data can accidentally short-circuit execution. Factory-created results need a private brand or another internal guard that arbitrary user data cannot spoof.

## Rendering policy

The result rendering rules stay unchanged:

- stdout carries only the requested output format.
- stderr carries human diagnostics, warnings, progress, prompts, and CTA text.
- Generated envelope-mode CLIs emit the full envelope for successes and failures under explicit machine output.
- Handwritten CLIs emit bare success data under `--json` unless `--full-output` is requested.
- Any non-human failure emits the full envelope so agents and scripts can always read `error`.
- Human failures may render a concise stderr line, but the underlying result is still a `CommandError`.

## MCP policy

MCP has its own JSON-RPC envelope. Do not nest the full CLI `Result` into MCP content by default.

- successful command call: `CallToolResult.isError = false`, content is `result.data`
- failed command call: `CallToolResult.isError = true`, content is `result.error`
- protocol/JSON-RPC failures use JSON-RPC `error`, not `CommandError`

This preserves the same command error object while respecting the MCP protocol envelope.

## Internal throw policy

Allowed internal throws:

- parse/global/config errors before command execution
- schema validation failures from Zod parsing
- auth/session resolution failures
- outbound HTTP serialization/network/status/body/schema failures
- impossible framework invariants and programmer errors
- unexpected observer/hook exceptions before executor normalization

Disallowed throws:

- normal command-domain failures in handwritten commands
- generated command control flow such as locality conflicts or missing generated base URL
- build/product/release CLI preflight errors that already know the stable `CommandError`
- helper built-in write failures once they can be expressed as `CommandError`

## Implementation status

The hard cutover has landed:

1. `ok`, `fail`, and `commandError` are package-root exports.
2. Factory-created results carry a private runtime brand.
3. `RunContext.ok/error` return `Result` instead of `never`.
4. The executor no longer has a `Done` sentinel.
5. Command tests prove `return ctx.error(...)` does not throw.
6. Package-root error class exports were removed.
7. `toCommandError()` and typed error classes remain source-path internals for parser/schema/auth/HTTP white-box coverage.

Remaining internal cleanup is optional: auth/session and HTTP helpers may continue throwing `LicheError` behind executor normalization, but any command-authored path should return `fail(commandError(...))` or `ctx.error(...)`.

## Review checklist

For every future error-related change, answer these questions:

- Is this an expected command outcome? Return `fail(commandError(...))`.
- Is this deep internal plumbing where union returns would spread through several layers? Throw an internal error and normalize once.
- Will an agent know what to do next from `code`, `suggested_fix`, or `code_actions`?
- Are secrets, env values, request bodies, and local paths excluded from `details`?
- Does the CLI, MCP, fetch, lifecycle, and generated command path see the same `CommandError` fields?
- Does the test assert the machine object, not only human stderr text?
