import { describe, expect, test } from 'bun:test'
import {
  defineCli,
  defineCommand,
  defineExtension,
  dispatch,
  parseInvocation,
  reflectionControls,
  run,
  z,
} from '../src/index.js'

// Guards the terminal-flag unification: the core built-ins (--version/--help/--schema)
// and extension terminal handlers (here, --custom) all flow through one registry, so
// the result-returning lanes reject them identically and `run` renders them from one loop.

const customControl = () =>
  defineExtension({
    id: 'test.custom-terminal',
    globals: [{ expose: 'runtime', flag: 'custom', key: 'custom', type: 'boolean' }],
    terminalHandlers: [{ flagKey: 'custom', handle: ({ options }) => void (options.stdout ?? (() => {}))('CUSTOM\n') }],
  })

const makeCli = () =>
  defineCli({
    name: 'tcli',
    version: '9.9.9',
    // help + version are first-class defaults now; only opt-in extensions are listed.
    extensions: [reflectionControls(), customControl()],
    commands: [defineCommand({ path: ['greet'], input: { options: z.object({}) }, async run() { return { hi: true } } })],
  })

const TERMINAL_FLAGS = ['version', 'help', 'schema', 'custom'] as const

async function runCapture(argv: string[]): Promise<{ out: string; code: number }> {
  let out = ''
  let code = 0
  await run(makeCli(), argv, {
    streams: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    stdout: (s) => {
      out += s
    },
    stderr: () => {},
    exit: (c) => {
      code = c
    },
  })
  return { out, code }
}

describe('terminal-flag unification', () => {
  test('dispatch rejects every terminal-only flag identically (run-only)', async () => {
    for (const flag of TERMINAL_FLAGS) {
      const result = await dispatch(makeCli(), [`--${flag}`])
      expect(result.ok).toBe(false)
      expect(result.error?.code).toBe('PARSE_ERROR')
      expect(result.error?.message).toBe(`--${flag} is only available through run, not dispatch`)
    }
  })

  test('parseInvocation rejects every terminal-only flag identically', async () => {
    for (const flag of TERMINAL_FLAGS) {
      const result = await parseInvocation(makeCli(), [`--${flag}`])
      expect(result.ok).toBe(false)
      expect(result.ok ? '' : result.error.message).toBe(`--${flag} is only available through run, not parseInvocation`)
    }
  })

  test('run renders each terminal flag (built-in and extension)', async () => {
    expect((await runCapture(['--version'])).out).toContain('9.9.9')
    expect((await runCapture(['greet', '--help'])).out).toContain('greet')
    expect((await runCapture(['greet', '--schema'])).out.length).toBeGreaterThan(0)
    expect((await runCapture(['--custom'])).out).toContain('CUSTOM')
  })

  test('an empty version string opts out of --version (empty is treated as absent)', async () => {
    const cli = defineCli({
      name: 'nover',
      version: '',
      commands: [defineCommand({ path: ['greet'], input: { options: z.object({}) }, async run() { return { hi: true } } })],
    })
    let code = 0
    let err = ''
    await run(cli, ['--version'], {
      streams: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
      stdout: () => {},
      stderr: (s) => { err += s },
      exit: (c) => { code = c },
    })
    expect(code).toBe(1) // --version is not registered when the version string is empty
    expect(err).toContain('PARSE_ERROR')
  })

  test('command-agnostic terminal flags short-circuit before selection, ignoring trailing junk', async () => {
    // Regression guard: `cli --version --bogus` must still print the version (exit 0), not
    // error on the unknown flag. version + extension handlers run before command selection.
    const v = await runCapture(['--version', '--bogus'])
    expect(v.out).toContain('9.9.9')
    expect(v.code).toBe(0)

    const c = await runCapture(['--custom', '--bogus'])
    expect(c.out).toBe('CUSTOM\n')
    expect(c.code).toBe(0)

    const vCmd = await runCapture(['--version', 'no-such-command'])
    expect(vCmd.out).toContain('9.9.9')
    expect(vCmd.code).toBe(0)
  })

  test('bare invocation renders help; an extension terminal flag beats the no-command help fallback', async () => {
    const bare = await runCapture([])
    expect(bare.out.length).toBeGreaterThan(0) // help fallback
    expect(bare.out).not.toContain('CUSTOM')

    const custom = await runCapture(['--custom']) // no command selected, yet --custom wins over the help fallback
    expect(custom.out).toContain('CUSTOM')
    expect(custom.out).toBe('CUSTOM\n') // exactly the handler output, not help
  })
})
