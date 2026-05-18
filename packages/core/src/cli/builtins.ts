import type { CliState, Format } from '../types.js'
import type { GlobalFlags } from '../parser/globals.js'
import { completionScript, shells } from '../completions/shells.js'
import { format } from '../format/index.js'
import { writeMcp, writeSkill } from '../skills/sync.js'
import { renderTypegen } from '../command/typegen.js'
import { builtinCommands } from './builtin-metadata.js'

export type BuiltinIo = { out(s: string): void; err(s: string): void }

export async function runBuiltin(
  name: string,
  state: CliState,
  flags: GlobalFlags,
  io: BuiltinIo,
  outputFormat: Format,
  env: Record<string, string | undefined> = {},
): Promise<boolean> {
  const [command, subcommand, ...rest] = flags.rest

  if (command === 'completions') {
    const shell = subcommand ?? 'bash'
    if (!shells.includes(shell as any)) {
      io.err(`Unknown shell '${shell}'. Supported: ${shells.join(', ')}\n`)
      return true
    }
    io.out(`${completionScript(shell, name)}\n`)
    return true
  }

  if (command === 'skills' && subcommand === 'add') {
    const sub = parseSubcommandFlags(rest)
    const path = await writeSkill(name, state, {
      agent: sub.agent,
      global: !sub.noGlobal,
      env,
    })
    io.out(`wrote ${path}\n`)
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
    io.out(`wrote ${path}\n`)
    return true
  }

  if (command === 'gen') {
    const sub = parseSubcommandFlags(rest)
    const out = sub.out ?? './lili.generated.ts'
    await Bun.write(out, renderTypegen(name, state))
    io.out(`wrote ${out}\n`)
    return true
  }

  if ((command === 'skills' || command === 'mcp') && (flags.help || !subcommand)) {
    const builtin = builtinCommands.find((item) => item.name === command)
    const subcommands = builtin?.subcommands?.map((item) => `  ${name} ${command} ${item.name}  ${item.description}`).join('\n')
    io.out(`${subcommands ?? `${name} ${command}`}\n`)
    return true
  }

  return false
}

type SubcommandFlags = {
  agent?: string | undefined
  command?: string | undefined
  noGlobal?: boolean | undefined
  out?: string | undefined
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
    else if (token === '--out' || token === '-o') flags.out = rest[++i]
    else if (token.startsWith('--out=')) flags.out = token.slice('--out='.length)
  }
  return flags
}
