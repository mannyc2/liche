import { fstatSync } from 'node:fs'
import { isatty } from 'node:tty'
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

/** The three stream kinds, for telemetry/events. */
export type StreamKinds = { stdin: StreamKind; stdout: StreamKind; stderr: StreamKind }

/** Per-stream classification/color/width overrides for tests and programmatic callers. */
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

function resolveColor(env: Dict<string | undefined>, stdout: StreamView, override: ColorLevel | undefined): ColorSupport {
  if (override !== undefined) return { level: override, source: 'force-color' }
  if (env['NO_COLOR'] !== undefined) return { level: 0, source: 'no-color' } // presence wins (convention)
  const force = env['FORCE_COLOR']
  if (force !== undefined && force !== '0' && force !== 'false') return { level: 3, source: 'force-color' }
  if (!stdout.isTTY) return { level: 0, source: 'not-a-tty' } // a non-terminal sink stores escapes verbatim
  if (env['TERM'] === 'dumb') return { level: 0, source: 'dumb-term' }
  const ct = env['COLORTERM'] ?? ''
  if (/truecolor|24bit/i.test(ct)) return { level: 3, source: 'tty' }
  if (/256/.test(env['TERM'] ?? '')) return { level: 2, source: 'tty' }
  return { level: 1, source: 'tty' }
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
 * non-interactive (all pipes). Overrides set the kind per stream, and `isTTY`,
 * `interactive`, and `color` are derived from those kinds (so an explicit
 * `{ stdout: 'tty' }` correctly reports a terminal).
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
      ? { level: overrides.color, source: 'force-color' }
      : stdout.isTTY
        ? { level: 1, source: 'tty' }
        : { level: 0, source: 'not-a-tty' }
  return { stdin, stdout, stderr, color, width: overrides.width, interactive: stdin.isTTY && stdout.isTTY }
}

/** Project a captured Stdio to the three kinds carried on lifecycle events. */
export function streamKinds(stdio: Stdio): StreamKinds {
  return { stdin: stdio.stdin.kind, stdout: stdio.stdout.kind, stderr: stdio.stderr.kind }
}
