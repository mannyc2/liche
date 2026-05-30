import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, outputControls, run } from '@liche/core'
import type { CliInstance, RunOptions } from '@liche/core'
import { agents } from '../src/index.js'

describe('@liche/agents', () => {
  test('bundles MCP and skill helper commands together', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        outputControls({ json: true }),
        agents({ command: 'app-cli', skill: { markdown: '# app\n\nAgent docs.' } }),
      ],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })

    const skillsList = await runCli(cli, ['skills', 'list', '--json'])
    expect(JSON.parse(skillsList.stdout).data).toEqual({ skills: [{ installed: false, name: 'app' }] })

    const mcpHelp = await runCli(cli, ['mcp', '--help'])
    expect(mcpHelp.stdout).toContain('add  Register MCP server config')

    const skillsHelp = await runCli(cli, ['skills', '--help'])
    expect(skillsHelp.stdout).toContain('add   Sync skill file')
    expect(skillsHelp.stdout).toContain('list  List available skills')
  })

  test('omits skill metadata when no skill is provided', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [agents()],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    const mcpHelp = await runCli(cli, ['mcp', '--help'])
    expect(mcpHelp.stdout).toContain('add  Register MCP server config')
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
    exit(code) {
      exitCode = code
    },
    stderr(chunk) {
      stderr += chunk
    },
    stdout(chunk) {
      stdout += chunk
    },
    streams: options.streams ?? { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
  })
  return { exitCode, stderr, stdout }
}
