import { mkdir } from 'node:fs/promises'
import { defineCommand, z } from '@liche/core'
import type { CliExtension, SkillDefinition } from '@liche/core'

type Env = Record<string, string | undefined>
type AgentTarget = 'claude-code' | 'cursor' | 'generic'
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

export type CompletionsOptions = {
  commandName?: string | undefined
}

export type McpInstallerOptions = {
  command?: string | undefined
}

export type SkillsInstallerOptions = {
  skill?: SkillDefinition | undefined
}

export type AgentsOptions = McpInstallerOptions & SkillsInstallerOptions

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

const shells = ['bash', 'zsh', 'fish'] as const
const builtinInstallEnv = z.object({
  APPDATA: z.string().optional(),
  HOME: z.string().optional(),
  USERPROFILE: z.string().optional(),
  XDG_CONFIG_HOME: z.string().optional(),
}).passthrough()
const installOptions = z.object({
  agent: z.string().optional(),
  global: z.boolean().default(true),
})
const mcpInstallOptions = installOptions.extend({
  command: z.string().optional(),
})
const completionArgs = z.object({
  shell: z.enum(shells).default('bash'),
})

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

export function completions(options: CompletionsOptions = {}): CliExtension {
  return {
    commands: [
      defineCommand({
        agent: false,
        description: 'Generate shell completion script',
        format: 'md',
        input: { args: completionArgs },
        output: z.string(),
        path: ['completions'],
        run: ({ ctx, input }) => completionScript(input.args.shell, options.commandName ?? ctx.name),
        safety: { readOnly: true },
      }),
    ],
    id: 'liche.completions',
  }
}

export function mcpInstaller(options: McpInstallerOptions = {}): CliExtension {
  return {
    commands: [
      defineCommand({
        agent: false,
        description: 'Register MCP server config',
        input: {
          aliases: { command: 'c' },
          env: builtinInstallEnv,
          options: mcpInstallOptions,
        },
        path: ['mcp', 'add'],
        run: async ({ ctx, input }) => ({
          path: await writeMcp(ctx.name, {
            agent: input.options.agent,
            command: input.options.command ?? options.command ?? ctx.name,
            env: ctx.env as Env,
            global: input.options.global !== false,
          }),
        }),
        safety: { idempotent: true },
      }),
    ],
    id: 'liche.mcp-installer',
  }
}

export function agents(options: AgentsOptions = {}): CliExtension {
  return {
    commands: [
      ...(mcpInstaller({ command: options.command }).commands ?? []),
      ...(skillsInstaller({ skill: options.skill }).commands ?? []),
    ],
    id: 'liche.agents',
    ...(options.skill ? { skill: options.skill } : undefined),
  }
}

export function skillsInstaller(options: SkillsInstallerOptions = {}): CliExtension {
  const skill = options.skill
  return {
    commands: [
      defineCommand({
        agent: false,
        description: 'Sync skill file',
        input: {
          env: builtinInstallEnv,
          options: installOptions,
        },
        path: ['skills', 'add'],
        run: async ({ ctx, input }) => ({
          path: await writeSkill(ctx.name, {
            agent: input.options.agent,
            env: ctx.env as Env,
            global: input.options.global !== false,
            skill,
          }),
        }),
        safety: { idempotent: true },
      }),
      defineCommand({
        agent: false,
        description: 'List available skills',
        path: ['skills', 'list'],
        run: ({ ctx }) => ({ skills: [{ installed: false, name: ctx.name }] }),
        safety: { readOnly: true },
      }),
    ],
    id: 'liche.skills-installer',
    ...(skill ? { skill } : undefined),
  }
}

export function completionScript(shell: string, binaryName: string): string {
  const command = shellWord(binaryName)
  const functionName = completionFunctionName(binaryName)
  if (shell === 'fish') {
    return [
      `function ${functionName}`,
      `    env COMPLETE=fish ${command} -- (commandline -opc)[2..-1]`,
      'end',
      `complete -c ${command} -f -a "(${functionName})"`,
    ].join('\n')
  }
  if (shell === 'zsh') {
    return [
      `#compdef ${binaryName}`,
      `${functionName}() {`,
      '  local -a completions',
      `  completions=("\${(@f)$(COMPLETE=zsh ${command} -- "\${words[@]:1}")}")`,
      '  compadd -- "${completions[@]}"',
      '}',
      `compdef ${functionName} ${command}`,
    ].join('\n')
  }
  return [
    `${functionName}(){`,
    "  local IFS=$'\\n'",
    `  COMPREPLY=( $(COMPLETE=bash ${command} -- "\${COMP_WORDS[@]:1}") )`,
    '}',
    `complete -F ${functionName} -- ${command}`,
  ].join('\n')
}

export async function writeSkill(
  name: string,
  options: WriteSkillOptions & { skill?: SkillDefinition | undefined } = {},
): Promise<string> {
  const env = options.env ?? (process.env as Env)
  const agent = options.agent ?? 'claude-code'
  const cwd = options.cwd ?? process.cwd()
  const isGlobal = options.global !== false
  const dir = skillDir(name, agent, isGlobal, env, cwd)
  await mkdir(dir, { recursive: true })
  const path = `${dir}/SKILL.md`
  await Bun.write(path, options.skill?.markdown ?? defaultSkillMarkdown(name))
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

function completionFunctionName(binaryName: string): string {
  const safeName = binaryName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '') || 'cli'
  return `_${/^[A-Za-z_]/.test(safeName) ? safeName : `_${safeName}`}_complete`
}

function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value
  return `'${value.replace(/'/g, "'\\''")}'`
}

function home(env: Env = process.env): string {
  return env['HOME'] ?? env['USERPROFILE'] ?? '.'
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

function defaultSkillMarkdown(name: string): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${name} CLI`,
    '---',
    '',
    `# ${name}`,
    '',
    `Use the ${name} CLI through its documented commands.`,
  ].join('\n')
}
