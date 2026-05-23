import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as Skill from '../src/skills/index.js'
import { stateOf, testCli, testCommand } from './helpers.js'

describe('writeSkill — agent-specific target dirs', () => {
  let home: string
  let cwd: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'lili-home-'))
    cwd = mkdtempSync(join(tmpdir(), 'lili-cwd-'))
  })
  afterEach(() => {
    rmSync(home, { force: true, recursive: true })
    rmSync(cwd, { force: true, recursive: true })
  })

  test('claude-code global → $HOME/.claude/skills/<name>/SKILL.md', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const path = await Skill.writeSkill('app', stateOf(cli), { agent: 'claude-code', env: { HOME: home }, cwd })
    expect(path).toBe(`${home}/.claude/skills/app/SKILL.md`)
  })

  test('claude-code local → $CWD/.claude/skills/<name>/SKILL.md', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const path = await Skill.writeSkill('app', stateOf(cli), { agent: 'claude-code', env: { HOME: home }, cwd, global: false })
    expect(path).toBe(`${cwd}/.claude/skills/app/SKILL.md`)
  })

  test('cursor global → $HOME/.cursor/skills/<name>/SKILL.md', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const path = await Skill.writeSkill('app', stateOf(cli), { agent: 'cursor', env: { HOME: home }, cwd })
    expect(path).toBe(`${home}/.cursor/skills/app/SKILL.md`)
  })

  test('cursor local → $CWD/.cursor/skills/<name>/SKILL.md', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const path = await Skill.writeSkill('app', stateOf(cli), { agent: 'cursor', env: { HOME: home }, cwd, global: false })
    expect(path).toBe(`${cwd}/.cursor/skills/app/SKILL.md`)
  })

  test('unknown agent falls back to $HOME/.config/lili/skills/<name>/SKILL.md', async () => {
    const cli = testCli('app', [testCommand('run', { run: () => ({}) })])
    const path = await Skill.writeSkill('app', stateOf(cli), { agent: 'unknown', env: { HOME: home }, cwd })
    expect(path).toBe(`${home}/.config/lili/skills/app/SKILL.md`)
  })

  test('writes the actual SKILL.md content', async () => {
    const cli = testCli('app', { description: 'the app' }, [testCommand('run', { run: () => ({}) })])
    const path = await Skill.writeSkill('app', stateOf(cli), { agent: 'claude-code', env: { HOME: home }, cwd })
    const content = await Bun.file(path).text()
    expect(content).toContain('# app')
    expect(content).toContain('the app')
  })
})

describe('writeMcp — agent-specific target files', () => {
  let home: string
  let cwd: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'lili-home-'))
    cwd = mkdtempSync(join(tmpdir(), 'lili-cwd-'))
  })
  afterEach(() => {
    rmSync(home, { force: true, recursive: true })
    rmSync(cwd, { force: true, recursive: true })
  })

  test('claude-code global → $HOME/.claude.json', async () => {
    const file = await Skill.writeMcp('app', { agent: 'claude-code', command: 'app', env: { HOME: home }, cwd })
    expect(file).toBe(`${home}/.claude.json`)
    const json = await Bun.file(file).json()
    expect(json.mcpServers.app).toEqual({ args: ['--mcp'], command: 'app' })
  })

  test('claude-code local → $CWD/.mcp.json', async () => {
    const file = await Skill.writeMcp('app', { agent: 'claude-code', command: 'app', env: { HOME: home }, cwd, global: false })
    expect(file).toBe(`${cwd}/.mcp.json`)
  })

  test('cursor global → $HOME/.cursor/mcp.json', async () => {
    const file = await Skill.writeMcp('app', { agent: 'cursor', command: 'app', env: { HOME: home }, cwd })
    expect(file).toBe(`${home}/.cursor/mcp.json`)
    const json = await Bun.file(file).json()
    expect(json.mcpServers.app).toEqual({ args: ['--mcp'], command: 'app' })
  })

  test('cursor local → $CWD/.cursor/mcp.json', async () => {
    const file = await Skill.writeMcp('app', { agent: 'cursor', command: 'app', env: { HOME: home }, cwd, global: false })
    expect(file).toBe(`${cwd}/.cursor/mcp.json`)
  })

  test('no agent → $HOME/.config/lili/mcp/<name>.json', async () => {
    const file = await Skill.writeMcp('app', { command: 'app', env: { HOME: home }, cwd })
    expect(file).toBe(`${home}/.config/lili/mcp/app.json`)
    const json = await Bun.file(file).json()
    expect(json).toEqual({ mcpServers: { app: { args: ['--mcp'], command: 'app' } } })
  })

  test('splits command lines into MCP executable and args', async () => {
    const file = await Skill.writeMcp('app', {
      agent: 'claude-code',
      command: 'bunx "@scope/app binary" --profile dev',
      env: { HOME: home },
      cwd,
    })
    const json = await Bun.file(file).json()
    expect(json.mcpServers.app).toEqual({
      args: ['@scope/app binary', '--profile', 'dev', '--mcp'],
      command: 'bunx',
    })
  })

  test('does not duplicate --mcp when the command override already includes it', async () => {
    const file = await Skill.writeMcp('app', {
      agent: 'claude-code',
      command: 'bun run ./cli.ts --mcp',
      env: { HOME: home },
      cwd,
    })
    const json = await Bun.file(file).json()
    expect(json.mcpServers.app).toEqual({ args: ['run', './cli.ts', '--mcp'], command: 'bun' })
  })

  test('default command falls back to the CLI name', async () => {
    const file = await Skill.writeMcp('mycli', { agent: 'claude-code', env: { HOME: home }, cwd })
    const json = await Bun.file(file).json()
    expect(json.mcpServers.mycli.command).toBe('mycli')
  })

  test('accepts a bare command string as second arg', async () => {
    // writeMcp(name, optionsOrCommand). Bare string short form not exposed in env override
    // — but test the no-options default with env in process.env.
    const previousHome = process.env['HOME']
    process.env['HOME'] = home
    try {
      const file = await Skill.writeMcp('app')
      expect(file).toBe(`${home}/.config/lili/mcp/app.json`)
    } finally {
      if (previousHome === undefined) delete process.env['HOME']
      else process.env['HOME'] = previousHome
    }
  })
})
