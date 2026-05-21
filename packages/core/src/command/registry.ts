import type { CliState, CommandDefinition, CommandManifest, CommandManifestEntry, Entry, SelectedCommand } from '../types.js'
import { isAlias, isGroup, resolveAlias } from './guards.js'
import { commandSchema } from './schema.js'

export const MANIFEST_VERSION = 'lili.v1'

export type CommandScope = {
  aliases: string[]
  commands: Map<string, Entry>
  description?: string | undefined
  entry?: Entry | undefined
  path: string[]
  root?: CommandDefinition | undefined
}

export function selectCommand(state: CliState, tokens: string[]): SelectedCommand | undefined {
  let commands = state.commands
  let root = state.root
  let events = [] as SelectedCommand['events']
  let hooks = { beforeExecute: [] } as SelectedCommand['hooks']
  let middlewares = [] as SelectedCommand['middlewares']
  const path: string[] = []

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    const rawEntry = commands.get(token)
    const entry = resolveAlias(commands, rawEntry)
    if (!entry) break
    const canonicalToken = isAlias(rawEntry) ? rawEntry.target : token

    if (isGroup(entry)) {
      path.push(canonicalToken)
      commands = entry.commands
      events = events.concat(entry.events)
      hooks = { beforeExecute: hooks.beforeExecute.concat(entry.hooks.beforeExecute) }
      root = entry.root
      middlewares = middlewares.concat(entry.middlewares)
      continue
    }

    return {
      argv: { args: tokens.slice(index + 1) },
      entry,
      events,
      hooks,
      middlewares,
      path: path.concat(canonicalToken),
      rootDef: state.def,
    }
  }

  if (!root) return undefined
  return {
    argv: { args: tokens.slice(path.length) },
    entry: root,
    events,
    hooks,
    middlewares,
    path,
    rootDef: state.def,
  }
}

export function commandScope(state: CliState, tokens: string[] = []): CommandScope {
  let commands = state.commands
  let root = state.root
  let entry: Entry | undefined = root
  const path: string[] = []

  for (const token of tokens) {
    const rawEntry = commands.get(token)
    const resolved = resolveAlias(commands, rawEntry)
    if (!resolved) break

    const canonicalToken = isAlias(rawEntry) ? rawEntry.target : token
    path.push(canonicalToken)
    entry = resolved

    if (!isGroup(resolved)) {
      return {
        aliases: aliasesFor(commands, canonicalToken),
        commands: new Map(),
        description: (resolved as any).description,
        entry: resolved,
        path,
        root: undefined,
      }
    }

    commands = resolved.commands
    root = resolved.root
    entry = resolved.root ?? resolved
  }

  return {
    aliases: path.length ? [] : [],
    commands,
    description: path.length ? (entry as any)?.description : state.def.description,
    entry,
    path,
    root,
  }
}

export function childCommands(scope: CommandScope): CommandManifestEntry[] {
  return [...scope.commands.entries()]
    .filter(([, entry]) => !isAlias(entry))
    .map(([name, entry]) => ({
      aliases: aliasesFor(scope.commands, name),
      description: (entry as any).description,
      entry: resolveAlias(scope.commands, entry),
      name,
    }))
}

export function completionCommands(state: CliState, words: string[]): string[] {
  const scopeWords = words.slice(0, -1)
  const current = words.at(-1) ?? ''
  const scope = commandScope(state, scopeWords)
  if (scope.commands.size === 0 && scopeWords.length) return []

  const children = childCommands(scope)
  return [
    ...children.map((command) => command.name),
    ...children.flatMap((command) => command.aliases ?? []),
  ].filter((name) => name.startsWith(current))
}

export function outputPolicy(selected: SelectedCommand) {
  return (selected.entry as any).outputPolicy
}

export function manifest(name: string, state: CliState): CommandManifest {
  return {
    commands: collectCommands(state.commands, state.root),
    description: state.def.description,
    name,
    version: state.def.version,
  }
}

export function manifestEnvelope(name: string, state: CliState): CommandManifest & { manifestVersion: string } {
  return { manifestVersion: MANIFEST_VERSION, ...manifest(name, state) }
}

export function mcpToolName(name: string): string {
  return name.replace(/\s+/g, '_')
}

function aliasesFor(commands: Map<string, Entry>, target: string): string[] {
  return [...commands.entries()]
    .filter(([, entry]) => isAlias(entry) && entry.target === target)
    .map(([name]) => name)
}

export function collectCommands(
  commands: Map<string, Entry>,
  root?: CommandDefinition | undefined,
  prefix = '',
): CommandManifestEntry[] {
  const output: CommandManifestEntry[] = root
    ? [enrichEntry(prefix.trim() || '(root)', commands, root, undefined)]
    : []

  for (const [name, rawEntry] of commands) {
    if (isAlias(rawEntry)) continue
    const entry = resolveAlias(commands, rawEntry)
    if (!entry) continue

    if (isGroup(entry)) output.push(...collectCommands(entry.commands, entry.root, `${prefix}${name} `))
    else output.push(enrichEntry(`${prefix}${name}`.trim(), commands, entry, name))
  }

  return output
}

function enrichEntry(
  fullName: string,
  commands: Map<string, Entry>,
  entry: Entry,
  rawName: string | undefined,
): CommandManifestEntry {
  const def = entry as any
  const aliases = rawName ? aliasNames(commands, rawName) : []
  const examples = def.examples
  const usage = def.usage
  const hint = def.hint
  const outputPolicyValue = def.outputPolicy
	  return {
	    ...(aliases.length ? { aliases } : undefined),
	    ...(def.auth ? { auth: def.auth } : undefined),
	    description: def.description,
    entry,
    name: fullName,
    schema: commandSchema(entry),
    ...(examples ? { examples } : undefined),
    ...(usage ? { usage } : undefined),
    ...(hint ? { hint } : undefined),
    ...(outputPolicyValue ? { outputPolicy: outputPolicyValue } : undefined),
  } as CommandManifestEntry
}

function aliasNames(commands: Map<string, Entry>, target: string): string[] {
  return [...commands.entries()]
    .filter(([, entry]) => isAlias(entry) && entry.target === target)
    .map(([name]) => name)
}
