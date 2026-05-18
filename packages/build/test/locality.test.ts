import { describe, expect, test } from 'bun:test'
import acmeGenerated from './fixtures/acme.generated.js'

async function runCli(argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await acmeGenerated.serve(argv, {
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
    exit: (code) => { exitCode = code },
    isTty: false,
  })
  return { stdout, stderr, exitCode }
}

describe('locality resolution', () => {
  test('default mode used when no flag passed; source is schema-default', async () => {
    const out = await runCli(['projects', 'get', '--projectId', 'abc', '--json'])
    expect(out.exitCode).toBe(0)
    const env = JSON.parse(out.stdout)
    expect(env.meta.locality).toEqual({ mode: 'local', source: 'schema-default' })
  })

  test('--local overrides default; source is flag', async () => {
    const out = await runCli(['projects', 'get', '--projectId', 'abc', '--local', '--json'])
    expect(out.exitCode).toBe(0)
    const env = JSON.parse(out.stdout)
    expect(env.meta.locality).toEqual({ mode: 'local', source: 'flag' })
  })

  test('--remote without remote transport rejected', async () => {
    const out = await runCli(['projects', 'get', '--projectId', 'abc', '--remote', '--json'])
    const env = JSON.parse(out.stdout)
    expect(env.ok).toBe(false)
    expect(env.error.code).toBe('REMOTE_NOT_IMPLEMENTED')
  })

  test('--local --remote rejected before local impl runs', async () => {
    const out = await runCli(['projects', 'get', '--projectId', 'abc', '--local', '--remote', '--json'])
    const env = JSON.parse(out.stdout)
    expect(env.ok).toBe(false)
    expect(env.error.code).toBe('LOCALITY_CONFLICT')
  })

  test('single-mode operation help does not advertise --local or --remote', async () => {
    const out = await runCli(['projects', 'deploy', '--help'])
    expect(out.stdout).not.toContain('--local')
    expect(out.stdout).not.toContain('--remote')
  })

  test('multimode operation help advertises --local and --remote', async () => {
    const out = await runCli(['projects', 'get', '--help'])
    expect(out.stdout).toContain('--local')
    expect(out.stdout).toContain('--remote')
  })
})
