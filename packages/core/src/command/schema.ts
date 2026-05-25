import type { CommandDefinition, CommandRuntime } from '../types.js'
import { deprecatedKeys, toJsonSchema } from '../schema/zod.js'

export function commandSchema(definition: CommandDefinition | CommandRuntime) {
  const deprecated = deprecatedKeys(definition.options)
  return {
    args: toJsonSchema(definition.args),
    env: toJsonSchema(definition.env),
    options: toJsonSchema(definition.options),
    sources: definition.sources,
    output: toJsonSchema(definition.output),
    ...(deprecated.length ? { deprecated } : undefined),
  }
}
