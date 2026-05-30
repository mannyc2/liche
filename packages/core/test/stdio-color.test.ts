import { describe, expect, test } from 'bun:test'
import { WriteStream } from 'node:tty'
import { captureStdio } from '../src/cli/stdio.js'

// Color = an isTTY gate we own + a depth we delegate. A piped/file sink gets NO color
// even when TERM is set in the inherited env (getColorDepth itself omits that gate, so
// delegating blindly would emit ANSI into pipes). On a real terminal the DEPTH is
// delegated to the runtime's tty.WriteStream#getColorDepth (FORCE_COLOR by value,
// TERM/COLORTERM/CI). FORCE_COLOR overrides the gate; an explicit override wins over all.
// stdout kind is forced so results don't depend on how the test runner's fd 1 is wired.

const toLevel = (bits: number) => (bits >= 24 ? 3 : bits >= 8 ? 2 : bits >= 4 ? 1 : 0)
const ttyBits = (env: Record<string, string | undefined>) =>
  WriteStream.prototype.getColorDepth.call({ fd: 1, isTTY: true }, env)
const color = (env: Record<string, string | undefined>, stdout: 'tty' | 'pipe', overrideColor?: 0 | 1 | 2 | 3) =>
  captureStdio(env, overrideColor === undefined ? { stdout } : { stdout, color: overrideColor }).color

describe('stdio color', () => {
  test('piped stdout gets NO color even with a color TERM/COLORTERM in env (the isTTY gate)', () => {
    expect(color({ TERM: 'xterm-256color' }, 'pipe')).toEqual({ level: 0, source: 'not-a-tty' })
    expect(color({ COLORTERM: 'truecolor' }, 'pipe')).toEqual({ level: 0, source: 'not-a-tty' })
    expect(color({}, 'pipe')).toEqual({ level: 0, source: 'not-a-tty' })
  })

  test('terminal stdout reflects TERM / COLORTERM via the runtime detector', () => {
    expect(color({ TERM: 'xterm-256color' }, 'tty')).toEqual({ level: 2, source: 'tty' })
    expect(color({ COLORTERM: 'truecolor' }, 'tty')).toEqual({ level: 3, source: 'tty' })
    expect(color({ TERM: 'dumb' }, 'tty')).toEqual({ level: 0, source: 'tty' }) // a tty, just colorless
  })

  test('FORCE_COLOR forces color even on a pipe, parsed BY VALUE (not "any truthy → truecolor")', () => {
    const lvl = (force: string) => color({ FORCE_COLOR: force }, 'pipe').level
    expect(lvl('1')).toBe(1) // the old hand-rolled resolver returned 3 here (the bug)
    expect(lvl('')).toBe(1)
    expect(lvl('true')).toBe(1)
    expect(lvl('2')).toBe(2)
    expect(lvl('3')).toBe(3)
    expect(lvl('0')).toBe(0)
    expect(color({ FORCE_COLOR: '2' }, 'pipe')).toEqual({ level: 2, source: 'force-color' })
  })

  test('NO_COLOR disables (presence wins) and labels provenance, even on a tty', () => {
    expect(color({ NO_COLOR: '1', TERM: 'xterm-256color' }, 'tty')).toEqual({ level: 0, source: 'no-color' })
    expect(color({ NO_COLOR: '' }, 'tty')).toEqual({ level: 0, source: 'no-color' }) // empty value still disables
  })

  test('NO_COLOR + FORCE_COLOR: FORCE wins, no stderr warning leaks', () => {
    expect(color({ NO_COLOR: '1', FORCE_COLOR: '3' }, 'pipe')).toEqual({ level: 3, source: 'force-color' })
  })

  test('explicit override wins over env; override 0 is honored (not treated as falsy)', () => {
    expect(color({ TERM: 'xterm-256color' }, 'tty', 0)).toEqual({ level: 0, source: 'override' })
    expect(color({ NO_COLOR: '1' }, 'pipe', 3)).toEqual({ level: 3, source: 'override' })
  })

  test('on a terminal, depth tracks the runtime getColorDepth (no table re-implementation drift)', () => {
    for (const env of [{}, { TERM: 'xterm-256color' }, { COLORTERM: 'truecolor' }, { TERM: 'screen' }, { CI: '1' }]) {
      expect(color(env, 'tty').level).toBe(toLevel(ttyBits(env)))
    }
  })
})
