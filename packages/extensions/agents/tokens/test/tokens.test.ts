import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, help, outputControls, run } from '@liche/core'
import type { CliInstance, RunOptions } from '@liche/core'
import { tokenCount, tokenSlice, tokens } from '../src/index.js'

describe('@liche/tokens', () => {
  test('tokenCount estimates fewer than character length', () => {
    const text = 'alpha beta gamma delta'
    expect(tokenCount(text)).toBeLessThan(text.length)
  })

  test('tokenSlice truncates and tags the suffix', () => {
    const sliced = tokenSlice('alpha beta gamma delta', 0, 2)
    expect(sliced).toContain('[truncated: showing tokens 0-2')
  })

  test('tokenSlice without truncation does not append the suffix', () => {
    expect(tokenSlice('alpha beta gamma', 1)).not.toContain('[truncated:')
    expect(tokenSlice('alpha beta gamma', 0, 99)).not.toContain('[truncated:')
  })

  test('extension registers globals and applies output transform', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [help(), outputControls({ json: true }), tokens()],
      commands: [defineCommand({ path: ['greet'], run: () => ({ ok: true, data: { hello: 'world' } }) })],
    })

    const count = await runCli(cli, ['greet', '--json', '--token-count'])
    expect(Number(count.stdout.trim())).toBeGreaterThan(0)

    const limited = await runCli(cli, ['greet', '--json', '--token-limit', '2'])
    expect(limited.stdout).toContain('[truncated:')
  })
})

async function runCli(
  cli: CliInstance,
  argv: string[],
  options: Omit<RunOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await run(cli, argv, {
    ...options,
    exit(code) { exitCode = code },
    stderr(chunk) { stderr += chunk },
    stdout(chunk) { stdout += chunk },
    isTty: options.isTty ?? false,
  })
  return { exitCode, stderr, stdout }
}
