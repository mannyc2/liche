import { run } from '@liche/core'
import { beforeEach, describe, expect, test } from 'bun:test'
import { cli, observedEvents } from './cli.js'

describe('core-handwritten example', () => {
  beforeEach(() => {
    observedEvents.length = 0
  })

  test('runs a typed command with middleware state and env validation', async () => {
    const result = await runCli(['summarize', 'README.md', '--style', 'full', '--profile', 'work', '--json'], {
      NOTES_TOKEN: 'tok_example',
    })
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      authenticated: true,
      file: 'README.md',
      profile: 'work',
      requestId: 'example-request',
      summary: 'full summary for README.md',
    })
    expect(JSON.stringify(observedEvents)).not.toContain('tok_example')
    expect(observedEvents.map((event) => event.type)).toEqual([
      'command.selected',
      'command.started',
      'command.completed',
    ])
  })

  test('keeps agent helper commands disabled', async () => {
    const help = await runCli(['--help'])
    expect(help.stdout).not.toContain('mcp add')
    expect(help.stdout).not.toContain('skills add')
    expect(help.stdout).not.toContain('gen')
    expect(help.stdout).toContain('--profile <name>')
  })

  test('parses boolean options', async () => {
    const result = await runCli(['echo', 'hello', '--shout', '--json'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ message: 'HELLO' })
  })
})

async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await run(cli, argv, {
    env,
    exit: (code) => {
      exitCode = code
    },
    isTty: false,
    stderr: (chunk) => {
      stderr += chunk
    },
    stdout: (chunk) => {
      stdout += chunk
    },
  })
  return { exitCode, stderr, stdout }
}
