# Stdio primitive — hard cutover plan

Status: **planned, hard cutover** (no back-compat shim; nothing depends on `@liche/core` yet, so we replace `isTty` outright rather than carrying a deprecated alias). Companion to [config-primitive.md](./config-primitive.md) and [api-boundary.md](./api-boundary.md); follows the cutover style of [core-run-and-arg-codecs-plan.md](./core-run-and-arg-codecs-plan.md) and [opt-in-globals-plan.md](./opt-in-globals-plan.md).

## Problem

Core exposes a single boolean, `RunContext.isTty`, and uses "stdout is a terminal" as a proxy for several unrelated facts. Two concrete leaks, by file:line:

- `packages/core/src/cli/terminal.ts:25` — `const isTty = options.isTty ?? process.stdout.isTTY === true`. This one bit is then overloaded:
  - `terminal.ts:51` — `const human = !flags.formatExplicit && !flags.json && isTty` (human-vs-machine rendering).
  - `terminal.ts:189` — deprecation warnings gated on `isTty`.
  - threaded to every handler as `RunContext.isTty` (`types.ts:226`, set in `execute.ts:80`) and into telemetry (`CliEvent.isTty`, `types.ts:288`; wire schema `packages/extensions/telemetry/src/internal/schema.ts:23`).
- `packages/product/src/generate/cli/auth.ts:219` — generated CLIs emit `interactive: ctx.isTty`, which flows into `oauthDeviceLogin(... interactive ...)` (`packages/extensions/auth/src/device.ts:26`): `if (... || input.interactive === false) throw authInteractiveRequired(...)`. So **"stdout is a terminal" decides whether a human can complete a device-code login.**

`isTty` answers exactly one OS question — "does the tty ioctl succeed on fd 1" — and is being asked five. `!isTty` conflates pipe, regular file, socket, `/dev/null`, and any non-terminal char device. See the standard-I/O study guide, §0/§2 (the `isatty` vs `fstat` motif) and §7 (libuv's `uv_guess_handle` is what populates `.isTTY`, computed once at startup).

> **Razor (from the I/O guide).** To know fact X, call the primitive that proves X; never infer X from a primitive that merely correlates with it. The real file type comes only from `fstat` + `S_IS*`; `isatty` is a derived leaf bit.

## What is already right (do not rebuild)

This cut is small because the codebase already applies the matching razors elsewhere:

- **Env provenance / typed reads.** Commands declare an `env` schema; values are validated per-command with provenance through the input-source primitive (`src/cli/input-sources.ts`, `SourceInspector`, `OptionValueSource`). This is the env guide's "typed getenv + provenance" already done. No change.
- **Single env boundary.** `defaultEnv()` (`src/cli/invocation.ts:7`) is the one `Bun.env` read; it is threaded as `env`. No scattered `process.env`. No change.
- **Explicit "may I prompt" signal.** `--non-interactive` / `GlobalOptions.nonInteractive` (`types.ts:32,582`) already exists and is consumed by auth (`device.ts:26`, `session.ts:14`). This is the correct explicit primitive; `isTty` should never substitute for it.
- **"How was I invoked" done as policy, declared-first.** `detectInvocation(ctx)` (`packages/extensions/auth/src/invocation.ts:16`) reads the **DECLARED** marker `LICHE_INVOCATION` via `ctx.sources.value('env', 'LICHE_INVOCATION')` first, then falls back to the `CI`/`GITHUB_ACTIONS`/… **convention**. It does **not** read `isTty`. This is the env guide's "prefer declared over sniffed," and `api-boundary.md` intentionally keeps `InvocationKind` out of core. **Untouched by this cut.**

The gap is strictly the I/O side: there is no file-type classification of fd 0/1/2, no stdin/stderr classification, no color/width primitive, and no flush/`EPIPE` discipline.

## The primitive

Replace the `isTty` boolean with a `Stdio` value: the **facts** about fd 0/1/2, captured once at the boundary, injected through the context. Each field proves one thing.

```ts
// packages/core/src/cli/stdio.ts  (NEW)
import { fstatSync } from 'node:fs'
import { isatty } from 'node:tty'
import type { Dict } from '../types.js'

/** Ground truth from fstat(2). `tty` = char device that also answers the tty ioctl. */
export type StreamKind = 'tty' | 'pipe' | 'file' | 'socket' | 'char' | 'closed'

export type StreamView = {
  readonly fd: 0 | 1 | 2
  readonly kind: StreamKind
  readonly isTTY: boolean // derived: kind === 'tty'. Convenience only; never the decision input for "piped".
}

export type ColorLevel = 0 | 1 | 2 | 3 // none | ansi16 | ansi256 | truecolor
export type ColorSupport = {
  readonly level: ColorLevel
  readonly source: 'no-color' | 'force-color' | 'tty' | 'dumb-term' | 'not-a-tty' | 'default'
}

export type Stdio = {
  readonly stdin: StreamView
  readonly stdout: StreamView
  readonly stderr: StreamView
  readonly color: ColorSupport
  /** Terminal columns (TIOCGWINSZ via process.stdout.columns); undefined when stdout is not a tty. */
  readonly width: number | undefined
  /** FEASIBILITY only: stdin.isTTY && stdout.isTTY. NOT "a human is present". */
  readonly interactive: boolean
}

/** Per-stream classification/color/width overrides for tests and programmatic callers. */
export type StreamOverrides = {
  stdin?: StreamKind | undefined
  stdout?: StreamKind | undefined
  stderr?: StreamKind | undefined
  color?: ColorLevel | undefined
  width?: number | undefined
}

export function classifyStream(fd: 0 | 1 | 2): StreamKind {
  let st: ReturnType<typeof fstatSync>
  try {
    st = fstatSync(fd)
  } catch {
    return 'closed'
  }
  if (st.isFIFO()) return 'pipe'
  if (st.isFile()) return 'file'
  if (st.isSocket()) return 'socket'
  if (st.isCharacterDevice()) return isatty(fd) ? 'tty' : 'char' // /dev/null is 'char', NOT 'tty'
  return 'char'
}

function view(fd: 0 | 1 | 2, override: StreamKind | undefined): StreamView {
  const kind = override ?? classifyStream(fd)
  return { fd, kind, isTTY: kind === 'tty' }
}

function resolveColor(env: Dict<string | undefined>, stdout: StreamView, override: ColorLevel | undefined): ColorSupport {
  if (override !== undefined) return { level: override, source: 'force-color' }
  if (env['NO_COLOR'] !== undefined) return { level: 0, source: 'no-color' } // presence wins (convention)
  const force = env['FORCE_COLOR']
  if (force !== undefined && force !== '0' && force !== 'false') return { level: 3, source: 'force-color' }
  if (!stdout.isTTY) return { level: 0, source: 'not-a-tty' } // non-terminal sink stores escapes verbatim
  if (env['TERM'] === 'dumb') return { level: 0, source: 'dumb-term' }
  const ct = env['COLORTERM'] ?? ''
  if (/truecolor|24bit/i.test(ct)) return { level: 3, source: 'tty' }
  if (/256/.test(env['TERM'] ?? '')) return { level: 2, source: 'tty' }
  return { level: 1, source: 'tty' }
}

/** The single sanctioned read of process I/O state. Only this module and terminal.ts touch process.std*. */
export function captureStdio(env: Dict<string | undefined>, overrides: StreamOverrides = {}): Stdio {
  const stdin = view(0, overrides.stdin)
  const stdout = view(1, overrides.stdout)
  const stderr = view(2, overrides.stderr)
  const width = overrides.width ?? (stdout.isTTY ? process.stdout.columns : undefined)
  return {
    stdin,
    stdout,
    stderr,
    color: resolveColor(env, stdout, overrides.color),
    width,
    interactive: stdin.isTTY && stdout.isTTY,
  }
}

/** Non-interactive Stdio for programmatic callers (dispatch) and adapters (fetch/MCP). */
export function nonInteractiveStdio(overrides: StreamOverrides = {}): Stdio {
  const k = (o: StreamKind | undefined): StreamKind => o ?? 'pipe'
  const stdin: StreamView = { fd: 0, kind: k(overrides.stdin), isTTY: false }
  const stdout: StreamView = { fd: 1, kind: k(overrides.stdout), isTTY: false }
  const stderr: StreamView = { fd: 2, kind: k(overrides.stderr), isTTY: false }
  return {
    stdin,
    stdout,
    stderr,
    color: { level: overrides.color ?? 0, source: overrides.color !== undefined ? 'force-color' : 'not-a-tty' },
    width: overrides.width,
    interactive: false,
  }
}
```

### How the overloaded `isTty` decomposes

| Old use of `isTty` | New, honest input |
|---|---|
| `human` rendering (`terminal.ts:51`) | `stdio.stdout.isTTY` (a terminal will interpret the bytes) AND the existing format flags. Presentation concern, stays in `terminal.ts`. |
| deprecation warnings (`terminal.ts:189`) | `stdio.stderr.isTTY` (warnings go to stderr; only show when stderr is a terminal). |
| color decisions (future renderers) | `stdio.color.level` (folds in `NO_COLOR`/`FORCE_COLOR`/`COLORTERM`/`TERM=dumb` + tty), with `source` provenance. |
| "can a human complete an interactive flow" (auth `interactive:`) | `stdio.interactive` (stdin **and** stdout are terminals) — and `oauthDeviceLogin` keeps ANDing in `global.nonInteractive` + `invocation`. |
| telemetry analytics (`CliEvent.isTty`) | `CliEvent.streams` (the three `StreamKind`s) — strictly more informative. |

The "may I prompt?" decision is `!ctx.global.nonInteractive && ctx.stdio.interactive` — an explicit flag (injected) gated by tty feasibility, never a tty bit alone. We do **not** add a separate `ctx.interactivity` field (keeps the public surface minimal per `api-boundary.md`); the expression above is canonical and is what the auth codegen emits.

## Exact edits

### 1. `packages/core/src/types.ts` (public surface)

- **Remove** `isTty: boolean` from `RunContext` (line 226). **Add** `stdio: Stdio`.
- **Remove** `isTty: boolean` from `CliEvent` (line 288). **Add** `streams: { stdin: StreamKind; stdout: StreamKind; stderr: StreamKind }`.
- **`RunOptions`** (line 680): **remove** `isTty?: boolean` (683). **Add** `streams?: StreamOverrides`. Keep `stdin?` (it is the input-byte source, a different concept — see naming decision).
- Re-export the new types from `stdio.ts` (`StreamKind`, `StreamView`, `Stdio`, `ColorSupport`, `ColorLevel`, `StreamOverrides`) and add them to `src/index.ts` and the public list in `api-boundary.md`.

```ts
// RunContext: replace
-  isTty: boolean;
+  stdio: Stdio;
// CliEvent: replace
-  isTty: boolean;
+  streams: { stdin: StreamKind; stdout: StreamKind; stderr: StreamKind };
// RunOptions: replace
-  isTty?: boolean | undefined;
+  streams?: StreamOverrides | undefined;
```

### 2. `packages/core/src/cli/terminal.ts`

```ts
// lines 20-25 — replace the ad-hoc io + isTty with a single capture
-  const io = { err: ..., out: ... }
-  const env = options.env ?? defaultEnv()
-  const isTty = options.isTty ?? process.stdout.isTTY === true
+  const env = options.env ?? defaultEnv()
+  const stdio = captureStdio(env, options.stdio)
+  const io = {
+    err: options.stderr ?? ((s: string) => void Bun.stderr.write(s)),
+    out: options.stdout ?? ((s: string) => void Bun.stdout.write(s)),
+  }
```
- line 51: `const human = !flags.formatExplicit && !flags.json && stdio.stdout.isTTY`.
- line 189: `if (stdio.stderr.isTTY) io.err(...)`.
- Every lifecycle-event object that currently spreads `isTty,` (lines 33, 56, 69, 81, 97, 113, 123, 134, 151, 186) → `streams: kinds(stdio),` where `kinds(s) = { stdin: s.stdin.kind, stdout: s.stdout.kind, stderr: s.stderr.kind }` (a tiny local helper).
- `execute(...)` call (line 174): pass `stdio` instead of `isTty`.
- **Flush + EPIPE (I/O guide §4/§5) — DEFERRED to a focused fast-follow, NOT in this cut.** The `… | head` clean-exit handler and flush-before-exit change runtime exit/listener behavior and need a Bun-runtime test (attaching `process.stdout.on('error', …)` repeatedly across the in-process test suite risks listener-count noise). Tracked separately so the type/primitive cutover stays green on its own. Intended shape:
  ```ts
  process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') (options.exit ?? process.exit)(0) })
  ```
  Exit stays routed through `options.exit ?? process.exit` as today.

### 3. `packages/core/src/cli/dispatch.ts`

- `DispatchOptions` (line 35): replace `isTty?: boolean` with `streams?: StreamOverrides`.
- line 56: `const stdio = nonInteractiveStdio(options.stdio)` (programmatic callers are non-tty by default).
- `emitFailure` input (lines 391, 406) and its call sites (67, 89): carry `streams: kinds(stdio)` instead of `isTty`.
- `execute(...)` call (line 216): pass `stdio` instead of `isTty`.

### 4. `packages/core/src/cli/execute.ts`

- `ExecuteInput` (line 36): replace `isTty?: boolean` with `stdio: Stdio` (required; both callers now supply it).
- line 80: `stdio: input.stdio` on the base context (drop `isTty: input.isTty ?? false`).
- `emitCommandEvent` (line 178): `streams: kinds(input.stdio)` instead of `isTty: input.isTty ?? false`.

### 5. `packages/core/src/cli/fetch.ts`

- The five `isTty: false` sites (≈ lines 21, 38, 51, 91, 117) build execute/event inputs for the HTTP surface. Replace with `stdio: nonInteractiveStdio()` (events: `streams: kinds(nonInteractiveStdio())`). An HTTP request has no terminal.

### 6. Extensions

- `packages/extensions/telemetry/src/internal/schema.ts:23` — replace `isTty: z.boolean(),` with
  ```ts
  streams: z.object({ stdin: streamKind, stdout: streamKind, stderr: streamKind }),
  ```
  where `const streamKind = z.enum(['tty','pipe','file','socket','char','closed'])`. Bump the telemetry wire `schemaVersion` if the sink contract is versioned.
- `packages/extensions/agents/mcp-server/src/protocol.ts` — the `isTty: false` sites (≈ 33, 72, 105, 131, 159, 166) → `stdio: nonInteractiveStdio()` (MCP is never a terminal). `src/stdio.ts:8`’s `options.stdin ?? Bun.stdin.stream()` stays (input bytes).
- `packages/extensions/auth/src/device.ts` — **no change**. It already gates on `global.nonInteractive`, `invocation`, and a passed-in `interactive` boolean; we only change what the codegen feeds that boolean (next).

### 7. Codegen — `packages/product/src/generate/cli/auth.ts`

- line 219: `interactive: ctx.isTty,` → `interactive: ctx.stdio.interactive,` (feasibility = stdin **and** stdout are terminals).
- line 150 (`nonInteractive: ctx.global.nonInteractive`) and line 147 (`invocation: detectInvocation(ctx)`) are already correct — no change.
- Regenerate golden fixtures for generated CLIs.

### 8. Tests (~40 sites — mechanical sweep)

- **No boolean shim.** Tests inject explicit `streams` shapes — `streams: { stdin: 'tty', stdout: 'tty', stderr: 'tty' }` for interactive, `streams: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }` for non-interactive. Do **not** add a `tty?: boolean` helper parameter; that would resurrect the boolean we are removing. A per-package test helper that forwarded `isTty` becomes `streams: options.streams ?? { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }` (an explicit non-interactive default, not an ambient fallback). Relying on the test runner's real fd types is forbidden — it is non-deterministic (a TTY when run from a terminal).
- **Injection sweep:** replace `isTty: true` → `tty: true` (helper) or `stdio: { stdout: 'tty', stdin: 'tty' }` (direct `run`/`dispatch` callers); `isTty: false` → `tty: false` / `stdio: { stdout: 'pipe' }`.
- **Assertion sweep:** `ctx.isTty` reads in handlers (e.g. `run-options.test.ts:22-23`, `parity.test.ts:138`, `dispatch.test.ts:249`) → `ctx.stdio.stdout.isTTY` (or the relevant field).
- **Telemetry tests** setting `isTty: false` → `streams: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }`.
- **Snapshot:** update `packages/core/test/api-snapshot.test.ts` and `packages/product/test/core-consumer-boundary.test.ts` for the new public types.

## Execution order (keeps the build green between steps)

Hard cutover, but ordered so each commit type-checks:

1. Add `src/cli/stdio.ts` + export the new types (`src/index.ts`); no consumers yet.
2. Flip core: `types.ts`, `terminal.ts`, `dispatch.ts`, `execute.ts`, `fetch.ts`. Remove `isTty` everywhere in core.
3. Update `api-boundary.md` public list + `api-snapshot.test.ts`.
4. Migrate extensions (telemetry schema, mcp-server) and codegen (`auth.ts`), regenerate goldens.
5. Sweep tests (helper + injection + assertions).
6. Guardrail (below).

## Guardrail (prevent regressions)

Add a CI grep (the repo uses `.github/workflows`, no ESLint): fail if `\.isTty\b` or `process\.std(out|err|in)\.isTTY` appears anywhere under `packages/*/src` except `packages/core/src/cli/stdio.ts` and `packages/core/src/cli/terminal.ts`. This encodes "classification happens once, at the boundary."

## Non-goals

- **No spawn primitive in core.** Core spawns nothing today (no `child_process`); curated-env/`dup2` child wiring is extension territory if it ever arrives. (Env guide §3 applies there, not here.)
- **No invocation detection in core.** `cli|ci|agent|mcp` stays in `@liche/auth`/`@liche/telemetry` per `api-boundary.md`; `detectInvocation` already prefers the declared `LICHE_INVOCATION` over CI sniffing.
- **No change to env resolution or provenance** — already correct.

## Acceptance criteria → [coverage.md](./coverage.md)

Add a table-driven case mirroring the I/O study guide's "what are fd 0/1/2 right now?" tool. For each invocation, assert the captured `Stdio` and the derived decisions:

| Invocation | stdout.kind | stdin.kind | interactive | human (json off) | color.level |
|---|---|---|---|---|---|
| terminal | `tty` | `tty` | true | true | ≥1 |
| `cli \| head` | `pipe` | `tty` | false | false | 0 |
| `cli > out.txt` | `file` | `tty` | false | false | 0 |
| `cli </dev/null` | `tty`/`tty` (stdin `char`) | `char` | false | true | ≥1 |
| `ssh host cli` (no `-t`) | `pipe` | `pipe` | false | false | 0 |
| programmatic `dispatch` | `pipe` | `pipe` | false | false | 0 |
| `NO_COLOR=1` on a tty | `tty` | `tty` | true | true | 0 (`source: no-color`) |

Known-bad implementations these catch: treating `!isTTY` as "piped" (the `</dev/null` and `> file` rows differ from a pipe); gating color on `isatty` alone (the `NO_COLOR` row); device login refusing on stdout-only tty when stdin is redirected.

## Update-workflow touchpoints (per [AGENTS.md](./AGENTS.md))

- This file is the requirement doc.
- `coverage.md`: add the table above and the guardrail check.
- `CHANGELOG.md` → `## Unreleased`: "Core: replaced `RunContext.isTty`/`RunOptions.isTty`/`CliEvent.isTty` with a `Stdio` primitive (per-stream `fstat` classification, color/width, `interactive` feasibility). Hard cutover."
- `api-boundary.md`: add `Stdio`, `StreamView`, `StreamKind`, `ColorSupport`, `ColorLevel`, `StreamOverrides` to the public types; note `RunContext.stdio` and the removal of `isTty`.

## Open questions

- **Naming — RESOLVED.** Context bundle is `ctx.stdio: Stdio` (conventional). The injection override is `RunOptions.streams` / `DispatchOptions.streams` of type `StreamOverrides` (not `stdio`), so it does not collide with `RunOptions.stdin` (the input-byte source) and reads as "how to classify the streams." Telemetry/events carry `streams: StreamKinds` (the three kinds). The `streamKinds(stdio)` helper projects a `Stdio` to those kinds.
- **Width refresh:** expose `SIGWINCH`-driven updates (`ctx.stdio.width` is captured once)? Only matters for long-lived/TUI commands; defer unless a command needs live resize.
- **Bun specifics:** confirm `fstatSync(0|1|2)` + `isatty` classify a Bun-spawned child's piped stdio as `pipe` (expected via libuv), and that `process.stdout.columns` is populated under Bun for ttys. Add a Bun-runtime test, not just a mocked one.
