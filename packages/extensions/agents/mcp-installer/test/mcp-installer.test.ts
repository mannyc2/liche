import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCli, defineCommand, help, run } from '@liche/core'
import type { CliInstance, RunOptions } from '@liche/core'
import { mcpInstaller } from '../src/index.js'

describe('@liche/mcp-installer', () => {
  let home: string
  let cwd: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    home = realpathSync(mkdtempSync(join(tmpdir(), 'liche-mcp-')))
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'liche-mcp-cwd-')))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(home, { force: true, recursive: true })
    rmSync(cwd, { force: true, recursive: true })
  })

  test('mcp add --agent claude-code writes ~/.claude.json by default', async () => {
    const cli = appCli()
    process.chdir(cwd)
    const result = await runCli(cli, ['mcp', 'add', '--agent', 'claude-code'], { env: { HOME: home } })
    expect(JSON.parse(result.stdout).data).toEqual({ path: `${home}/.claude.json` })
    const config = await Bun.file(`${home}/.claude.json`).json()
    expect(config.mcpServers.app).toEqual({ args: ['--mcp'], command: 'app' })
  })

  test('mcp add --agent claude-code --no-global writes ./.mcp.json', async () => {
    const cli = appCli()
    process.chdir(cwd)
    const result = await runCli(cli, ['mcp', 'add', '--agent', 'claude-code', '--no-global'], { env: { HOME: home } })
    expect(JSON.parse(result.stdout).data).toEqual({ path: `${cwd}/.mcp.json` })
    const config = await Bun.file(`${cwd}/.mcp.json`).json()
    expect(config.mcpServers.app).toEqual({ args: ['--mcp'], command: 'app' })
  })

  test('mcp add --command override is used as the spawn command', async () => {
    const cli = appCli()
    process.chdir(cwd)
    await runCli(cli, ['mcp', 'add', '--agent', 'claude-code', '-c', 'bunx app-binary'], { env: { HOME: home } })
    const config = await Bun.file(`${home}/.claude.json`).json()
    expect(config.mcpServers.app).toEqual({ args: ['app-binary', '--mcp'], command: 'bunx' })
  })

  test('mcp add help lists the subcommand', async () => {
    const cli = appCli()
    const help = await runCli(cli, ['mcp', '--help'])
    expect(help.stdout).toContain('add  Register MCP server config')
  })
})

function appCli(): CliInstance {
  return defineCli({
    name: 'app',
    extensions: [help(), mcpInstaller()],
    commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
  })
}

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
