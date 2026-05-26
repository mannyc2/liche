import { mkdir } from 'node:fs/promises'
import { defineCommand, defineExtension, z } from '@liche/core'
import type { CliExtension } from '@liche/core'

type Env = Record<string, string | undefined>
type McpEntry = { args: string[]; command: string }
type McpTarget = { dir: string; file: string; write: () => Promise<string> }

export type McpInstallerOptions = {
  command?: string | undefined
}

export type WriteMcpOptions = {
  agent?: string | undefined
  command?: string | undefined
  cwd?: string | undefined
  env?: Env | undefined
  global?: boolean | undefined
}

const installEnv = z.object({
  APPDATA: z.string().optional(),
  HOME: z.string().optional(),
  USERPROFILE: z.string().optional(),
  XDG_CONFIG_HOME: z.string().optional(),
}).passthrough()

const installOptions = z.object({
  agent: z.string().optional(),
  command: z.string().optional(),
  global: z.boolean().default(true),
})

export function mcpInstaller(options: McpInstallerOptions = {}): CliExtension {
  return defineExtension({
    id: 'liche.mcp-installer',
    commands: [
      defineCommand({
        description: 'Register MCP server config',
        input: {
          aliases: { command: 'c' },
          env: installEnv,
          options: installOptions,
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
      }),
    ],
  })
}

export async function writeMcp(name: string, optionsOrCommand: string | WriteMcpOptions = {}): Promise<string> {
  const options: WriteMcpOptions = typeof optionsOrCommand === 'string' ? { command: optionsOrCommand } : optionsOrCommand
  const env = options.env ?? (process.env as Env)
  const cwd = options.cwd ?? process.cwd()
  const command = options.command ?? name
  const isGlobal = options.global !== false

  const target = mcpTargetFor(name, options.agent, isGlobal, env, cwd, command)
  await mkdir(target.dir, { recursive: true })
  await Bun.write(target.file, await target.write())
  return target.file
}

function mcpTargetFor(
  name: string,
  agent: string | undefined,
  isGlobal: boolean,
  env: Env,
  cwd: string,
  command: string,
): McpTarget {
  if (agent === 'claude-code') {
    const file = isGlobal ? `${home(env)}/.claude.json` : `${cwd}/.mcp.json`
    return mergeJsonTarget(file, name, mcpEntry(command))
  }
  if (agent === 'cursor') {
    const file = isGlobal ? `${home(env)}/.cursor/mcp.json` : `${cwd}/.cursor/mcp.json`
    return mergeJsonTarget(file, name, mcpEntry(command))
  }
  const dir = `${home(env)}/.config/liche/mcp`
  const file = `${dir}/${name}.json`
  return {
    dir,
    file,
    write: async () => JSON.stringify({ mcpServers: { [name]: mcpEntry(command) } }, null, 2),
  }
}

function mergeJsonTarget(file: string, name: string, entry: McpEntry): McpTarget {
  return {
    dir: dirOf(file),
    file,
    async write() {
      const existing = await readJsonOrEmpty(file)
      const servers = (existing['mcpServers'] && typeof existing['mcpServers'] === 'object'
        ? existing['mcpServers']
        : {}) as Record<string, unknown>
      return JSON.stringify({ ...existing, mcpServers: { ...servers, [name]: entry } }, null, 2)
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

function home(env: Env): string {
  return env['HOME'] ?? env['USERPROFILE'] ?? '.'
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
