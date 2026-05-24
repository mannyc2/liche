import { describe, expect, test } from 'bun:test'
import { z } from '../src/index.js'
import { runCli, testCli, testCommand } from './helpers.js'

describe('golden behavior fixtures', () => {
  test('help output keeps the public command/help shape stable', async () => {
    const cli = testCli('ship', { description: 'release helper', version: '1.0.0' }, [testCommand('publish', {
      args: z.object({ tag: z.string().describe('release tag') }),
      description: 'publish a release',
      options: z.object({ dryRun: z.boolean().default(false).describe('skip side effects') }),
      run: () => ({ ok: true }),
    })])

    const result = await runCli(cli, ['publish', '--help'])
    expect(result.stdout).toBe(`ship publish - publish a release

Usage: ship publish <tag>

Arguments:
  tag                     release tag

Options:
  --dry-run               skip side effects (default: false)

Global Options:
  --format <json|yaml|md|jsonl>
  --json
  --full-output
  --filter-output <paths>
  --llms
  --mcp
  --schema
  --token-count
  --token-limit <n>
  --token-offset <n>
  --help, -h
  --version
`)
  })

  test('root and group help are scoped to the selected command graph node', async () => {
    const cli = testCli('ship', { description: 'release helper' }, [
      testCommand('admin', { description: 'admin tools' }),
      testCommand(['admin', 'audit'], {
        description: 'inspect events',
        run: () => ({ ok: true }),
      }),
      testCommand(['admin', 'ban'], {
        aliases: ['block'],
        description: 'ban a user',
        run: () => ({ ok: true }),
      }),
    ])

    const root = await runCli(cli, ['--help'])
    expect(root.stdout).toBe(`ship - release helper

Usage: ship <command>

Commands:
  admin  admin tools

Global Options:
  --format <json|yaml|md|jsonl>
  --json
  --full-output
  --filter-output <paths>
  --llms
  --mcp
  --schema
  --token-count
  --token-limit <n>
  --token-offset <n>
  --help, -h
  --version
`)

    const group = await runCli(cli, ['admin', '--help'])
    expect(group.stdout).toBe(`ship admin - admin tools

Usage: ship admin <command>

Commands:
  audit  inspect events
  ban    ban a user (block)

Global Options:
  --format <json|yaml|md|jsonl>
  --json
  --full-output
  --filter-output <paths>
  --llms
  --mcp
  --schema
  --token-count
  --token-limit <n>
  --token-offset <n>
  --help, -h
  --version
`)
  })

  test('--llms emits a markdown command index by default', async () => {
    const cli = testCli('ship', { description: 'release helper' }, [testCommand('publish', {
      description: 'publish a release',
      run: () => ({ ok: true }),
    })])

    const result = await runCli(cli, ['--llms'])
    expect(result.stdout).toBe('# ship\nrelease helper\n\n- publish: publish a release\n')
  })
})
