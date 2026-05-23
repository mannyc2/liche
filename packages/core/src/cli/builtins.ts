import type { Awaitable, CliEvent, CliState, Format } from '../types.js'
import type { GlobalFlags } from '../parser/globals.js'
import { completionScript, shells } from '../completions/shells.js'
import { format } from '../format/index.js'
import { loadConfigResolution } from '../parser/config.js'
import { writeMcp, writeSkill } from '../skills/sync.js'
import { builtinCommands, builtinEnabled } from './builtin-metadata.js'

export type BuiltinIo = { out(s: string): void; err(s: string): void }
export type BuiltinLifecycleEmitter = (event: Omit<CliEvent, 'agent' | 'cli' | 'format' | 'formatExplicit' | 'invocation' | 'occurredAt'>) => Awaitable<void>

export async function runBuiltin(
  name: string,
  state: CliState,
  flags: GlobalFlags,
  io: BuiltinIo,
  outputFormat: Format,
  env: Record<string, string | undefined> = {},
  emitLifecycle?: BuiltinLifecycleEmitter | undefined,
): Promise<boolean> {
  const [command, subcommand, ...rest] = flags.rest

  if (!builtinEnabled(command ?? '', state.def.builtins, !!state.def.config)) return false

  if (command === 'completions') {
    const shell = subcommand ?? 'bash'
    if (!shells.includes(shell as any)) {
      io.err(`Unknown shell '${shell}'. Supported: ${shells.join(', ')}\n`)
      return true
    }
    await emitLifecycle?.({
      completion: { shell },
      surface: { kind: 'completion', name: 'completions' },
      type: 'completion.generated',
    })
    io.out(`${completionScript(shell, name)}\n`)
    return true
  }

  if (command === 'config' && subcommand === 'doctor') {
    const resolution = await loadConfigResolution(name, state, flags, env)
    io.out(`${format({
      config: {
        enabled: !!state.def.config,
        loaded: !!resolution,
        keys: Object.keys(resolution?.values ?? {}).sort(),
      },
    }, outputFormat)}\n`)
    return true
  }

  if (command === 'skills' && subcommand === 'add') {
    const sub = parseSubcommandFlags(rest)
    const path = await writeSkill(name, state, {
      agent: sub.agent,
      global: !sub.noGlobal,
      env,
    })
    emitWrote(io, flags, outputFormat, path)
    return true
  }

  if (command === 'skills' && subcommand === 'list') {
    io.out(`${format({ skills: [{ installed: false, name }] }, outputFormat)}\n`)
    return true
  }

  if (command === 'mcp' && subcommand === 'add') {
    const sub = parseSubcommandFlags(rest)
    const path = await writeMcp(name, {
      agent: sub.agent,
      command: sub.command ?? state.def.mcp?.command ?? name,
      global: !sub.noGlobal,
      env,
    })
    emitWrote(io, flags, outputFormat, path)
    return true
  }

  if ((command === 'config' || command === 'skills' || command === 'mcp') && (flags.help || !subcommand)) {
    const builtin = builtinCommands.find((item) => item.name === command)
    const subcommands = builtin?.subcommands?.map((item) => `  ${name} ${command} ${item.name}  ${item.description}`).join('\n')
    await emitLifecycle?.({
      surface: { kind: 'help', name: command },
      type: 'help.rendered',
    })
    io.out(`${subcommands ?? `${name} ${command}`}\n`)
    return true
  }

  return false
}

function emitWrote(io: BuiltinIo, flags: GlobalFlags, outputFormat: Format, path: string): void {
  if (flags.formatExplicit) {
    io.out(`${format({ ok: true, data: { path }, error: null }, outputFormat)}\n`)
  } else {
    io.out(`wrote ${path}\n`)
  }
}

type SubcommandFlags = {
  agent?: string | undefined
  command?: string | undefined
  noGlobal?: boolean | undefined
}

function parseSubcommandFlags(rest: string[]): SubcommandFlags {
  const flags: SubcommandFlags = {}
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!
    if (token === '--no-global') flags.noGlobal = true
    else if (token === '--agent') flags.agent = rest[++i]
    else if (token.startsWith('--agent=')) flags.agent = token.slice('--agent='.length)
    else if (token === '-c' || token === '--command') flags.command = rest[++i]
    else if (token.startsWith('--command=')) flags.command = token.slice('--command='.length)
  }
  return flags
}
