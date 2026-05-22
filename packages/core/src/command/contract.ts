import type { CommandContract, CommandDefinition, Entry } from '../types.js'
import { isFetch, isGroup } from './guards.js'
import { commandSchema } from './schema.js'

export function commandContract(
  name: string,
  entry: Entry,
  aliases: readonly string[] = [],
): CommandContract | undefined {
  if (isGroup(entry)) {
    return {
      ...(aliases.length ? { aliases } : undefined),
      description: entry.description,
      name,
      outputPolicy: entry.outputPolicy,
      path: contractPath(name),
    }
  }

  if (isFetch(entry)) {
    return {
      ...(aliases.length ? { aliases } : undefined),
      description: entry.description,
      name,
      outputPolicy: entry.outputPolicy,
      path: contractPath(name),
    }
  }

  const definition = entry as CommandDefinition
  return {
    ...(definition.agent !== undefined ? { agent: definition.agent } : undefined),
    ...(aliases.length ? { aliases } : undefined),
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
    schema: commandSchema(entry),
    ...(definition.summary ? { summary: definition.summary } : undefined),
    ...(definition.usage ? { usage: definition.usage } : undefined),
  }
}

function contractPath(name: string): string[] {
  return name === '(root)' ? [] : name.split(/\s+/).filter(Boolean)
}
