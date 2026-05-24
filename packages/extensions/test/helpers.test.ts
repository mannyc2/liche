import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCli, defineCommand, z } from '@liche/core'
import type { CliInstance, ServeOptions } from '@liche/core'
import { agents, completionScript, completions, mcpInstaller, skillsInstaller } from '../src/helpers.js'

type CapturedRun = { exitCode: number; stderr: string; stdout: string }

describe('@liche/extensions helper commands', () => {
  test('completions, mcp, and skills helpers register through the extension lane', async () => {
    const cli = helperCli()

    const completionRequest = await runCli(cli, ['--'], { env: { COMPLETE: 'bash' } })
    expect(completionRequest.stdout.trim().split('\n')).toEqual(['list', 'add', 'completions', 'mcp', 'skills'])

    const list = await runCli(cli, ['skills', 'list', '--json'])
    expect(JSON.parse(list.stdout)).toEqual({ skills: [{ installed: false, name: 'app' }] })

    const plainList = await runCli(cli, ['list', '--json'])
    expect(JSON.parse(plainList.stdout)).toEqual({ command: 'list' })

    const plainAdd = await runCli(cli, ['add', '--json'])
    expect(JSON.parse(plainAdd.stdout)).toEqual({ command: 'add' })

    const defaultCompletions = await runCli(cli, ['completions'])
    expect(defaultCompletions.stdout).toContain('COMPLETE=bash app --')

    const zshCompletions = await runCli(cli, ['completions', 'zsh'])
    expect(zshCompletions.stdout).toContain('COMPLETE=zsh app --')

    const jsonCompletions = await runCli(cli, ['completions', 'fish', '--json'])
    expect(JSON.parse(jsonCompletions.stdout)).toContain('COMPLETE=fish app --')

    const badShell = await runCli(cli, ['completions', 'powershell'], { isTty: true })
    expect(badShell.exitCode).toBe(1)
    expect(badShell.stderr).toContain('invalid value for <shell>')

    const skillsHelp = await runCli(cli, ['skills', '--help'])
    expect(skillsHelp.stdout).toContain('add   Sync skill file')
    expect(skillsHelp.stdout).toContain('list  List available skills')

    const mcpHelp = await runCli(cli, ['mcp', '--help'])
    expect(mcpHelp.stdout).toContain('add  Register MCP server config')
  })

  test('completion install scripts use shell-specific dynamic adapters', () => {
    const bash = completionScript('bash', 'app')
    expect(bash).toContain('COMPLETE=bash app -- "${COMP_WORDS[@]:1}"')
    expect(bash).toContain('complete -F _app_complete -- app')

    const zsh = completionScript('zsh', 'app')
    expect(zsh.split('\n')[0]).toBe('#compdef app')
    expect(zsh).toContain('COMPLETE=zsh app -- "${words[@]:1}"')
    expect(zsh).toContain('compdef _app_complete app')
    expect(zsh).not.toContain('complete -F')

    const fish = completionScript('fish', 'app')
    expect(fish).toContain('env COMPLETE=fish app -- (commandline -opc)[2..-1]')
    expect(fish).toContain('complete -c app -f -a "(_app_complete)"')
    expect(fish).not.toContain('$(COMPLETE=fish app)')
  })

  test('agents bundle installs MCP and skill helper commands together', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [agents({ command: 'app-cli', skill: { markdown: '# app\n\nAgent docs.' } })],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })

    const list = await runCli(cli, ['skills', 'list', '--json'])
    expect(JSON.parse(list.stdout)).toEqual({ skills: [{ installed: false, name: 'app' }] })

    const mcpHelp = await runCli(cli, ['mcp', '--help'])
    expect(mcpHelp.stdout).toContain('add  Register MCP server config')
  })
})

describe('@liche/extensions helper installers', () => {
  let home: string
  let cwd: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    home = realpathSync(mkdtempSync(join(tmpdir(), 'liche-mcp-')))
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'liche-cwd-')))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(home, { force: true, recursive: true })
    rmSync(cwd, { force: true, recursive: true })
  })

  test('mcp add --agent claude-code writes ~/.claude.json by default', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [mcpInstaller()],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    process.chdir(cwd)
    const result = await runCli(cli, ['mcp', 'add', '--agent', 'claude-code'], { env: { HOME: home } })
    expect(JSON.parse(result.stdout)).toEqual({ path: `${home}/.claude.json` })
    const config = await Bun.file(`${home}/.claude.json`).json()
    expect(config.mcpServers.app).toEqual({ args: ['--mcp'], command: 'app' })
  })

  test('mcp add --agent claude-code --no-global writes ./.mcp.json', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [mcpInstaller()],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    process.chdir(cwd)
    const result = await runCli(cli, ['mcp', 'add', '--agent', 'claude-code', '--no-global'], { env: { HOME: home } })
    expect(JSON.parse(result.stdout)).toEqual({ path: `${cwd}/.mcp.json` })
    const config = await Bun.file(`${cwd}/.mcp.json`).json()
    expect(config.mcpServers.app).toEqual({ args: ['--mcp'], command: 'app' })
  })

  test('mcp add --command override is used as the spawn command', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [mcpInstaller()],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    process.chdir(cwd)
    await runCli(cli, ['mcp', 'add', '--agent', 'claude-code', '-c', 'bunx app-binary'], { env: { HOME: home } })
    const config = await Bun.file(`${home}/.claude.json`).json()
    expect(config.mcpServers.app).toEqual({ args: ['app-binary', '--mcp'], command: 'bunx' })
  })

  test('skills add writes configured skill markdown for the selected agent', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [
        skillsInstaller({
          skill: {
            markdown: '# app\n\nCustom skill docs.',
          },
        }),
      ],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    process.chdir(cwd)
    const result = await runCli(cli, ['skills', 'add', '--agent', 'cursor', '--json'], { env: { HOME: home } })
    const path = `${home}/.cursor/skills/app/SKILL.md`
    expect(JSON.parse(result.stdout)).toEqual({ path })
    expect(await Bun.file(path).text()).toBe('# app\n\nCustom skill docs.')
  })
})

function helperCli(): CliInstance {
  return defineCli({
    name: 'app',
    extensions: [completions(), mcpInstaller(), skillsInstaller()],
    commands: [
      defineCommand({
        output: z.object({ command: z.string() }),
        path: ['list'],
        run: () => ({ command: 'list' }),
      }),
      defineCommand({
        output: z.object({ command: z.string() }),
        path: ['add'],
        run: () => ({ command: 'add' }),
      }),
    ],
  })
}

async function runCli(
  cli: CliInstance,
  argv: string[],
  options: Omit<ServeOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<CapturedRun> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await cli.serve(argv, {
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
    isTty: options.isTty ?? false,
  })
  return { exitCode, stderr, stdout }
}
