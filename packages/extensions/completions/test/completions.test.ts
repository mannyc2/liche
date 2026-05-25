import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, outputControls, z } from '@liche/core'
import type { CliInstance, ServeOptions } from '@liche/core'
import { completionScript, completions } from '../src/index.js'

describe('@liche/completions', () => {
  test('registers a completions command that emits shell-specific scripts', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true }), completions()],
      commands: [
        defineCommand({
          output: z.object({ command: z.string() }),
          path: ['list'],
          run: () => ({ command: 'list' }),
        }),
      ],
    })

    const defaultRun = await runCli(cli, ['completions'])
    expect(defaultRun.stdout).toContain('COMPLETE=bash app -- "${COMP_WORDS[@]:1}"')

    const zsh = await runCli(cli, ['completions', 'zsh'])
    expect(zsh.stdout).toContain('compdef _app_complete app')

    const fishJson = await runCli(cli, ['completions', 'fish', '--json'])
    expect(JSON.parse(fishJson.stdout)).toContain('env COMPLETE=fish app -- (commandline -opc)[2..-1]')

    const badShell = await runCli(cli, ['completions', 'powershell'], { isTty: true })
    expect(badShell.exitCode).toBe(1)
    expect(badShell.stderr).toContain('invalid value for <shell>')
  })

  test('completionScript emits shell-specific dynamic adapters', () => {
    const bash = completionScript('bash', 'app')
    expect(bash).toContain('COMPLETE=bash app -- "${COMP_WORDS[@]:1}"')
    expect(bash).toContain('complete -F _app_complete -- app')

    const zsh = completionScript('zsh', 'app')
    expect(zsh.split('\n')[0]).toBe('#compdef app')
    expect(zsh).toContain('compdef _app_complete app')

    const fish = completionScript('fish', 'app')
    expect(fish).toContain('env COMPLETE=fish app -- (commandline -opc)[2..-1]')
    expect(fish).toContain('complete -c app -f -a "(_app_complete)"')
  })

  test('binary names with shell-unsafe characters are quoted', () => {
    const script = completionScript('bash', 'my app')
    expect(script).toContain("'my app'")
  })
})

async function runCli(
  cli: CliInstance,
  argv: string[],
  options: Omit<ServeOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await cli.serve(argv, {
    ...options,
    exit(code) { exitCode = code },
    stderr(chunk) { stderr += chunk },
    stdout(chunk) { stdout += chunk },
    isTty: options.isTty ?? false,
  })
  return { exitCode, stderr, stdout }
}
