import type { CommandContract, CommandDefinition, Entry } from '../types.js'
import { isCommand, isFetch, isGroup } from './guards.js'
import { commandSchema } from './schema.js'

export function commandContract(
  name: string,
  entry: Entry,
  aliases: readonly string[] = [],
): CommandContract | undefined {
  if (isGroup(entry) || isFetch(entry) || isCommand(entry)) return rebaseContract(entry.contract, name, aliases)
  return undefined
}

export function commandContractFromDefinition(
  name: string,
  definition: CommandDefinition,
): CommandContract {
  return {
    ...(definition.agent !== undefined ? { agent: definition.agent } : undefined),
    ...(definition.auth ? { auth: definition.auth } : undefined),
    description: definition.description,
    ...(definition.effects ? { effects: definition.effects } : undefined),
    ...(definition.examples ? { examples: definition.examples } : undefined),
    ...(definition.hint ? { hint: definition.hint } : undefined),
    name,
    ...(definition.optionConfig ? { optionConfig: definition.optionConfig } : undefined),
    ...(definition.outputPolicy ? { outputPolicy: definition.outputPolicy } : undefined),
    path: contractPath(name),
    ...(definition.policy ? { policy: definition.policy } : undefined),
    ...(definition.safety ? { safety: definition.safety } : undefined),
    schema: commandSchema(definition),
    ...(definition.summary ? { summary: definition.summary } : undefined),
    ...(definition.usage ? { usage: definition.usage } : undefined),
  }
}

export function groupContract(
  name: string,
  input: { description?: string | undefined; outputPolicy?: CommandContract['outputPolicy'] | undefined },
): CommandContract {
  return {
    description: input.description,
    name,
    outputPolicy: input.outputPolicy,
    path: contractPath(name),
  }
}

function rebaseContract(
  contract: CommandContract,
  name: string,
  aliases: readonly string[],
): CommandContract {
  const { aliases: _aliases, name: _name, path: _path, ...rest } = contract
  return {
    ...rest,
    ...(aliases.length ? { aliases } : undefined),
    name,
    path: contractPath(name),
  }
}

function contractPath(name: string): string[] {
  return name === '(root)' ? [] : name.split(/\s+/).filter(Boolean)
}
