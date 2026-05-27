import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineCli, defineCommand, help as helpControl, outputControls, run } from '@liche/core'
import type { CliInstance, RunOptions } from '@liche/core'
import { skillsInstaller } from '../src/index.js'

describe('@liche/skills-installer', () => {
  let home: string
  let cwd: string
  let originalCwd: string

  beforeEach(() => {
    originalCwd = process.cwd()
    home = realpathSync(mkdtempSync(join(tmpdir(), 'liche-skills-')))
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'liche-skills-cwd-')))
  })

  afterEach(() => {
    process.chdir(originalCwd)
    rmSync(home, { force: true, recursive: true })
    rmSync(cwd, { force: true, recursive: true })
  })

  test('skills list reports the CLI name as a single uninstalled entry', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true }), skillsInstaller()],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    const list = await runCli(cli, ['skills', 'list', '--json'])
    expect(JSON.parse(list.stdout).data).toEqual({ skills: [{ installed: false, name: 'app' }] })
  })

  test('skills add writes configured skill markdown for the selected agent', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true }), skillsInstaller({ skill: { markdown: '# app\n\nCustom skill docs.' } })],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    process.chdir(cwd)
    const result = await runCli(cli, ['skills', 'add', '--agent', 'cursor', '--json'], { env: { HOME: home } })
    const path = `${home}/.cursor/skills/app/SKILL.md`
    expect(JSON.parse(result.stdout).data).toEqual({ path })
    expect(await Bun.file(path).text()).toBe('# app\n\nCustom skill docs.')
  })

  test('skills add falls back to default markdown when no skill is configured', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [outputControls({ json: true }), skillsInstaller()],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    process.chdir(cwd)
    const result = await runCli(cli, ['skills', 'add', '--agent', 'claude-code', '--json'], { env: { HOME: home } })
    const path = `${home}/.claude/skills/app/SKILL.md`
    expect(JSON.parse(result.stdout).data).toEqual({ path })
    const content = await Bun.file(path).text()
    expect(content).toContain('# app')
    expect(content).toContain('Use the app CLI')
  })

  test('skills help lists both subcommands', async () => {
    const cli = defineCli({
      name: 'app',
      extensions: [helpControl(), skillsInstaller()],
      commands: [defineCommand({ path: ['run'], run: () => ({ ok: true }) })],
    })
    const help = await runCli(cli, ['skills', '--help'])
    expect(help.stdout).toContain('add   Sync skill file')
    expect(help.stdout).toContain('list  List available skills')
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
