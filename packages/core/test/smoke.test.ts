import { describe, expect, test } from 'bun:test'
import { Cli } from '../src/index.js'
import { runCli } from './helpers.js'

describe('smoke: framework wires end-to-end', () => {
  test('builds a Cli, serves it, and produces version output', async () => {
    const cli = Cli.create({
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
