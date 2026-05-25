# Error handling

Core has one machine error contract:

```ts
type Result =
  | { ok: true; data: unknown; error: null; meta?: ResultMeta }
  | { ok: false; data: null; error: CommandError; meta?: ResultMeta };
```

Everything agent-facing, script-facing, MCP-facing, and generated-CLI-facing reduces to that shape. The `error` branch is a normal `CommandError` object, not an `Error` instance.

## Two lanes

### Lane 1: command-authored outcomes return objects

Command handlers, generated command code, helper commands, release/build/product CLI wrappers, and extension lanes return standardized result objects for expected outcomes:

```ts
return ok(data, meta);
return fail(commandError({
  code: "AUTH_MISSING",
  message: "Authentication required.",
  suggested_fix: "Run `app login` before retrying.",
}));
```

This lane handles user-recoverable, domain, policy, validation, auth, remote, and preflight outcomes that the command deliberately reports.

Command authors never construct or throw `LicheError`.

### Lane 2: internal runtime plumbing may throw

Internal parser, schema, config loading, auth resolution, HTTP transport, and framework invariant code may throw typed internal errors when returning unions would spread boilerplate through many helper calls.

This lane is allowed only behind executor-owned normalization:

```ts
catch (error) {
  return fail(toCommandError(error));
}
```

The thrown value does not cross a public machine-output boundary. It is implementation control flow, not the output contract.

## Why this split

Returning `Result` everywhere sounds simpler, but it is not simpler inside deep helper stacks. It forces every parser, schema, auth, session, and HTTP helper to return `T | Result` or `Result<T, E>`, then forces every caller to branch and rewrap. That duplicates executor behavior and makes successful data flow harder to read.

Throwing everywhere is also wrong. It makes normal command failures look exceptional, forces `ctx.ok()` / `ctx.error()` to use hidden control flow, and encourages public authors to import classes instead of returning serializable objects.

The split:

- return standardized result objects at command boundaries
- throw only inside internal helpers where stack unwinding is cheaper than union plumbing
- normalize every throw before it reaches CLI/MCP/fetch output

## Standard factories

```ts
ok(data?: unknown, meta?: ResultMeta): Result;
fail(error: CommandError, meta?: ResultMeta): Result;
commandError(input: CommandError): CommandError;
```

Rules:

- `ok()` always sets `error: null`.
- `fail()` always sets `data: null`.
- `commandError()` fills `code`, `message`, `detail`, `title`, `type`, and `exitCode` defaults.
- `commandError()` accepts RFC/recovery fields directly. Recovery data goes in first-class fields, not inside `details`.
- `details` is for structured diagnostic payloads only. It does not contain raw tokens, env values, request bodies, session file contents, or full local paths.
- `fieldErrors` is reserved for schema/validation failures and uses stable paths such as `$`, `$.option`, or `$.body.id`.

## Public API

The public command-authoring API prefers values and factories:

- public: `CommandError`, `FieldError`, `Result`, `ResultMeta`
- public: `ok`, `fail`, `commandError`
- internal: `BaseError`, `LicheError`, `ParseError`, `ValidationError`, `toCommandError`

`CommandError` carries stable `code` / `message`, RFC-9457-shaped fields (`type`, `title`, `status`, `detail`, `instance`), validation fields (`fieldErrors`), and agent recovery fields (`retry_after`, `suggested_fix`, `code_actions`).

Tests may keep importing internals by source path for white-box validation, but that is not evidence that a class belongs in the package-root API.

## Runtime flow

The executor:

1. Parses argv/config/env.
2. Runs hooks and middleware.
3. Runs the command handler.
4. If the handler returns a factory-branded `Result`, uses it directly.
5. If the handler returns an async generator, streams chunks and finishes with `ok(collected)`.
6. Otherwise validates the handler value against the declared output schema and returns `ok(validatedData)`.
7. If parser/schema/auth/http/internal code throws, catches it once, normalizes through `toCommandError()`, and returns `fail(normalizedError)`.
8. Emits lifecycle events from the final `Result`.
9. Renders stdout/stderr according to the output mode.

Arbitrary `{ ok, data, error }` objects are not control results. Factory-created results carry a private brand that arbitrary user data cannot spoof, so domain data shaped like a result does not accidentally short-circuit execution.

## Rendering policy

- stdout carries only the requested output format.
- stderr carries human diagnostics, warnings, progress, prompts, and CTA text.
- Generated envelope-mode CLIs emit the full envelope for successes and failures under explicit machine output.
- Handwritten CLIs emit bare success data under `--json` unless `--full-output` is requested.
- Any non-human failure emits the full envelope so agents and scripts can always read `error`.
- Human failures may render a concise stderr line, but the underlying result is still a `CommandError`.

## MCP policy

MCP has its own JSON-RPC envelope. The full CLI `Result` is not nested into MCP content by default:

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
- helper-command write failures once they can be expressed as `CommandError`

## Review checklist

For every error-related change:

- Is this an expected command outcome? Return `fail(commandError(...))`.
- Is this deep internal plumbing where union returns would spread through several layers? Throw an internal error and normalize once.
- Will an agent know what to do next from `code`, `suggested_fix`, or `code_actions`?
- Are secrets, env values, request bodies, and local paths excluded from `details`?
- Do the CLI, MCP, fetch, lifecycle, and generated command paths see the same `CommandError` fields?
- Does the test assert the machine object, not only human stderr text?
