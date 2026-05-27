import { describe, expect, test } from 'bun:test'
import { runCli, testCli } from './helpers.js'

describe('smoke: framework wires end-to-end', () => {
  test('builds a declarative CLI, runs it, and produces version output', async () => {
    const cli = testCli({
      name: 'smoke',
      description: 'smoke-test cli',
      version: '0.0.0',
      run: ({ ok }) => ok({ name: 'smoke', version: '0.0.0' }),
    })

    const result = await runCli(cli, ['--version'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toBe('0.0.0')
  })
})
