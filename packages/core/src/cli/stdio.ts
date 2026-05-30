import { fstatSync } from 'node:fs'
import { isatty, WriteStream } from 'node:tty'
import type { Dict } from '../types.js'

/**
 * Standard I/O classification, captured once at the terminal boundary.
 *
 * Replaces the overloaded `isTty` boolean. Each field answers ONE question:
 * `kind` is the fstat(2) ground truth, `isTTY` is a derived convenience,
 * `color`/`width` are capability facts, `interactive` is tty FEASIBILITY
 * (never "a human is present"). See docs/stdio-primitive-plan.md.
 */
export type StreamKind = 'tty' | 'pipe' | 'file' | 'socket' | 'char' | 'closed'

export type StreamView = {
  readonly fd: 0 | 1 | 2
  readonly kind: StreamKind
  /** Derived: kind === 'tty'. Convenience only; never the decision input for "piped". */
  readonly isTTY: boolean
}

export type ColorLevel = 0 | 1 | 2 | 3 // none | ansi16 | ansi256 | truecolor

export type ColorSupport = {
  readonly level: ColorLevel
  /** Which signal decided the level. */
  readonly source: 'override' | 'force-color' | 'no-color' | 'tty' | 'not-a-tty'
}

export type Stdio = {
  readonly stdin: StreamView
  readonly stdout: StreamView
  readonly stderr: StreamView
  /** Color support for stdout (the primary output sink). */
  readonly color: ColorSupport
  /** Terminal columns (TIOCGWINSZ via process.stdout.columns); undefined when stdout is not a tty. */
  readonly width: number | undefined
  /** FEASIBILITY only: stdin.isTTY && stdout.isTTY. NOT "a human is present". */
  readonly interactive: boolean
}

/** The three stream kinds, for telemetry/events. */
export type StreamKinds = { stdin: StreamKind; stdout: StreamKind; stderr: StreamKind }

/** Per-stream classification + color/width overrides for tests and programmatic callers. */
export type StreamOverrides = {
  stdin?: StreamKind | undefined
  stdout?: StreamKind | undefined
  stderr?: StreamKind | undefined
  color?: ColorLevel | undefined
  width?: number | undefined
}

/** fstat(2) ground truth: a char device that also answers the tty ioctl is a terminal. */
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

/** Node/Bun getColorDepth bits (1/4/8/24) → our 0-3 level. */
function colorLevel(bits: number): ColorLevel {
  return bits >= 24 ? 3 : bits >= 8 ? 2 : bits >= 4 ? 1 : 0
}

/**
 * Color support for a stream. The LEVEL is delegated to the runtime's own
 * detector (`tty.WriteStream#getColorDepth`) so it stays consistent with `bun`'s
 * coloring and with libraries like picocolors: it parses FORCE_COLOR *by value*
 * and honors NO_COLOR / COLORTERM / TERM / CI / TERM_PROGRAM. We do NOT
 * re-implement that table — re-implementing it is how the previous version drifted
 * (it mapped any truthy FORCE_COLOR to truecolor). An explicit `override` (a future
 * --color/--no-color policy, or a test) wins.
 */
function resolveColor(
  env: Dict<string | undefined>,
  stream: StreamView,
  override: ColorLevel | undefined,
): ColorSupport {
  if (override !== undefined) return { level: override, source: 'override' }
  const probe = (e: Dict<string | undefined>): number => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- referenced unbound but invoked via .call({ fd, isTTY }, …) below, which supplies the receiver
    const getColorDepth = WriteStream.prototype.getColorDepth as
      | undefined
      | ((env?: Dict<string | undefined>) => number)
    return typeof getColorDepth === 'function'
      ? getColorDepth.call({ fd: stream.fd, isTTY: stream.isTTY }, e)
      : stream.isTTY
        ? 4
        : 1
  }
  // FORCE_COLOR forces color regardless of tty or NO_COLOR. getColorDepth parses it
  // BY VALUE ("1"/""→16, "2"→256, "3"→truecolor) — we delegate that rather than
  // re-derive it (re-deriving it is how the previous version drifted to truecolor).
  // It warns to stderr if NO_COLOR is also set, so drop NO_COLOR from the probe.
  if (env['FORCE_COLOR'] !== undefined) {
    let e = env
    if (env['NO_COLOR'] !== undefined) {
      e = { ...env }
      delete e['NO_COLOR']
    }
    return { level: colorLevel(probe(e)), source: 'force-color' }
  }
  // No FORCE_COLOR: NO_COLOR disables (presence wins, per no-color.org), and a
  // non-terminal sink gets NO color. That isTTY gate is OURS: getColorDepth omits it
  // (it assumes a real terminal), so delegating blindly would report color for a
  // piped stdout whenever TERM/COLORTERM is set in the inherited env.
  if (env['NO_COLOR'] !== undefined) return { level: 0, source: 'no-color' }
  if (!stream.isTTY) return { level: 0, source: 'not-a-tty' }
  // A real terminal: delegate depth detection (TERM / COLORTERM / CI / TERM_PROGRAM).
  return { level: colorLevel(probe(env)), source: 'tty' }
}

/**
 * The single sanctioned read of process I/O state. Only this module and the
 * terminal runner touch `process.std*` / `fstat` / `isatty`.
 */
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

/**
 * Build a Stdio WITHOUT reading real fds — for programmatic callers (dispatch),
 * adapters (fetch/MCP), and tests. The default (no overrides) is fully
 * non-interactive (all pipes, no color). Overrides set the kind per stream;
 * `isTTY`, `interactive`, and `color` are derived from those kinds (so an explicit
 * `{ stdout: 'tty' }` reports a terminal, and `{ color: 2 }` forces a level). There
 * is no env here, so color is NOT auto-detected: a bare `{ stdout: 'tty' }` defaults
 * to level 1, whereas `captureStdio` delegates to the env and may report level 0 for
 * a terminal lacking TERM/COLORTERM. Pass `color` to force a specific level.
 */
export function nonInteractiveStdio(overrides: StreamOverrides = {}): Stdio {
  const mk = (fd: 0 | 1 | 2, o: StreamKind | undefined): StreamView => {
    const kind = o ?? 'pipe'
    return { fd, kind, isTTY: kind === 'tty' }
  }
  const stdin = mk(0, overrides.stdin)
  const stdout = mk(1, overrides.stdout)
  const stderr = mk(2, overrides.stderr)
  const color: ColorSupport =
    overrides.color !== undefined
      ? { level: overrides.color, source: 'override' }
      : stdout.isTTY
        ? { level: 1, source: 'tty' }
        : { level: 0, source: 'not-a-tty' }
  return { stdin, stdout, stderr, color, width: overrides.width, interactive: stdin.isTTY && stdout.isTTY }
}

/** Project a captured Stdio to the three kinds carried on lifecycle events. */
export function streamKinds(stdio: Stdio): StreamKinds {
  return { stdin: stdio.stdin.kind, stdout: stdio.stdout.kind, stderr: stdio.stderr.kind }
}
