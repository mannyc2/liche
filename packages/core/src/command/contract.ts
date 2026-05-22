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
    }
  }

  if (isFetch(entry)) {
    return {
      ...(aliases.length ? { aliases } : undefined),
      description: entry.description,
      name,
      outputPolicy: entry.outputPolicy,
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
    ...(definition.policy ? { policy: definition.policy } : undefined),
    schema: commandSchema(entry),
    ...(definition.usage ? { usage: definition.usage } : undefined),
  }
}
