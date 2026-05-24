import { mkdir } from 'node:fs/promises'
import type { CliState } from '../types.js'
import { skillMarkdown } from './generate.js'

function home(env: Env = process.env): string {
  return env['HOME'] ?? env['USERPROFILE'] ?? '.'
}

type Env = Record<string, string | undefined>

export type AgentTarget = 'claude-code' | 'cursor' | 'generic'

type McpEntry = { args: string[]; command: string }

type McpTarget = {
  dir: string
  file: string
  write: () => Promise<string>
}

type AgentInstallAdapter = {
  mcpTarget?(input: {
    command: string
    cwd: string
    env: Env
    global: boolean
    name: string
  }): McpTarget
  skillDir?(input: {
    cwd: string
    env: Env
    global: boolean
    name: string
  }): string
}

const AGENT_INSTALL_ADAPTERS: Record<string, AgentInstallAdapter> = {
  'claude-code': {
    skillDir({ cwd, env, global, name }) {
      return global ? `${home(env)}/.claude/skills/${name}` : `${cwd}/.claude/skills/${name}`
    },
    mcpTarget({ command, cwd, env, global, name }) {
      const file = global ? `${home(env)}/.claude.json` : `${cwd}/.mcp.json`
      return mergeJsonMcpTarget(file, name, mcpEntry(command))
    },
  },
  cursor: {
    skillDir({ cwd, env, global, name }) {
      return global ? `${home(env)}/.cursor/skills/${name}` : `${cwd}/.cursor/skills/${name}`
    },
    mcpTarget({ command, cwd, env, global, name }) {
      const file = global ? `${home(env)}/.cursor/mcp.json` : `${cwd}/.cursor/mcp.json`
      return mergeJsonMcpTarget(file, name, mcpEntry(command))
    },
  },
}

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
  const adapterPath = AGENT_INSTALL_ADAPTERS[agent]?.skillDir?.({ cwd, env, global: isGlobal, name })
  if (adapterPath) return adapterPath
  return `${home(env)}/.config/liche/skills/${name}`
}

function mcpTarget(
  name: string,
  agent: string | undefined,
  isGlobal: boolean,
  env: Env,
  cwd: string,
  command: string,
): McpTarget {
  const adapterTarget = agent
    ? AGENT_INSTALL_ADAPTERS[agent]?.mcpTarget?.({ command, cwd, env, global: isGlobal, name })
    : undefined
  if (adapterTarget) return adapterTarget

  const dir = `${home(env)}/.config/liche/mcp`
  return {
    dir,
    file: `${dir}/${name}.json`,
    async write() {
      return JSON.stringify({ mcpServers: { [name]: mcpEntry(command) } }, null, 2)
    },
  }
}

function mergeJsonMcpTarget(file: string, name: string, entry: McpEntry): McpTarget {
  return {
    dir: dirOf(file),
    file,
    async write() {
      const existing = await readJsonOrEmpty(file)
      return JSON.stringify(mergeMcp(existing, name, entry), null, 2)
    },
  }
}

function mcpEntry(commandLine: string): McpEntry {
  const [command, ...args] = splitCommandLine(commandLine)
  const mcpArgs = args.includes('--mcp') ? args : [...args, '--mcp']
  return { args: mcpArgs, command: command ?? commandLine.trim() }
}

function splitCommandLine(value: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined

  for (let index = 0; index < value.length; index++) {
    const char = value[index]!
    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    if (char === "'" && quote !== '"') {
      quote = quote === "'" ? undefined : "'"
      continue
    }
    if (char === '"' && quote !== "'") {
      quote = quote === '"' ? undefined : '"'
      continue
    }
    if (char === '\\' && quote !== "'" && index + 1 < value.length) {
      current += value[++index]
      continue
    }
    current += char
  }

  if (current) tokens.push(current)
  return tokens
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

function mergeMcp(existing: Record<string, unknown>, name: string, entry: McpEntry) {
  const servers = (existing['mcpServers'] && typeof existing['mcpServers'] === 'object' ? existing['mcpServers'] : {}) as Record<string, unknown>
  return { ...existing, mcpServers: { ...servers, [name]: entry } }
}
