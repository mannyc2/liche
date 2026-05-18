import { mkdir } from 'node:fs/promises'
import type { CliState } from '../types.js'
import { skillMarkdown } from './generate.js'

function home(env: Env = process.env): string {
  return env['HOME'] ?? env['USERPROFILE'] ?? '.'
}

type Env = Record<string, string | undefined>

export type AgentTarget = 'claude-code' | 'cursor' | 'generic'

export type WriteMcpOptions = {
  agent?: AgentTarget | string | undefined
  command?: string | undefined
  cwd?: string | undefined
  env?: Env | undefined
  global?: boolean | undefined
}

export type WriteSkillOptions = {
  agent?: AgentTarget | string | undefined
  cwd?: string | undefined
  env?: Env | undefined
  global?: boolean | undefined
}

export async function writeSkill(name: string, state: CliState, options: WriteSkillOptions = {}): Promise<string> {
  const env = options.env ?? (process.env as Env)
  const agent = options.agent ?? 'claude-code'
  const cwd = options.cwd ?? process.cwd()
  const isGlobal = options.global !== false
  const dir = skillDir(name, agent, isGlobal, env, cwd)
  await mkdir(dir, { recursive: true })
  const path = `${dir}/SKILL.md`
  await Bun.write(path, skillMarkdown(name, state))
  return path
}

export async function writeMcp(name: string, optionsOrCommand: string | WriteMcpOptions = {}): Promise<string> {
  const options: WriteMcpOptions = typeof optionsOrCommand === 'string' ? { command: optionsOrCommand } : optionsOrCommand
  const env = options.env ?? (process.env as Env)
  const cwd = options.cwd ?? process.cwd()
  const command = options.command ?? name
  const agent = options.agent
  const isGlobal = options.global !== false

  const { dir, file, write } = mcpTarget(name, agent, isGlobal, env, cwd, command)
  await mkdir(dir, { recursive: true })
  await Bun.write(file, await write())
  return file
}

function skillDir(name: string, agent: string, isGlobal: boolean, env: Env, cwd: string): string {
  if (agent === 'claude-code') {
    return isGlobal ? `${home(env)}/.claude/skills/${name}` : `${cwd}/.claude/skills/${name}`
  }
  if (agent === 'cursor') {
    return isGlobal ? `${home(env)}/.cursor/skills/${name}` : `${cwd}/.cursor/skills/${name}`
  }
  return `${home(env)}/.config/lili/skills/${name}`
}

function mcpTarget(
  name: string,
  agent: string | undefined,
  isGlobal: boolean,
  env: Env,
  cwd: string,
  command: string,
): { dir: string; file: string; write: () => Promise<string> } {
  const entry = { args: ['--mcp'], command }
  if (agent === 'claude-code') {
    const file = isGlobal ? `${home(env)}/.claude.json` : `${cwd}/.mcp.json`
    return {
      dir: dirOf(file),
      file,
      async write() {
        const existing = await readJsonOrEmpty(file)
        return JSON.stringify(mergeMcp(existing, name, entry), null, 2)
      },
    }
  }
  if (agent === 'cursor') {
    const file = isGlobal ? `${home(env)}/.cursor/mcp.json` : `${cwd}/.cursor/mcp.json`
    return {
      dir: dirOf(file),
      file,
      async write() {
        const existing = await readJsonOrEmpty(file)
        return JSON.stringify(mergeMcp(existing, name, entry), null, 2)
      },
    }
  }
  const dir = `${home(env)}/.config/lili/mcp`
  return {
    dir,
    file: `${dir}/${name}.json`,
    async write() {
      return JSON.stringify({ mcpServers: { [name]: entry } }, null, 2)
    },
  }
}

function dirOf(file: string): string {
  const idx = file.lastIndexOf('/')
  return idx === -1 ? '.' : file.slice(0, idx) || '/'
}

async function readJsonOrEmpty(path: string): Promise<Record<string, unknown>> {
  try {
    if (!(await Bun.file(path).exists())) return {}
    return (await Bun.file(path).json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function mergeMcp(existing: Record<string, unknown>, name: string, entry: { args: string[]; command: string }) {
  const servers = (existing['mcpServers'] && typeof existing['mcpServers'] === 'object' ? existing['mcpServers'] : {}) as Record<string, unknown>
  return { ...existing, mcpServers: { ...servers, [name]: entry } }
}
