import type { CommandDefinition, Entry } from '../types.js'
import { isFetch, isGroup } from './guards.js'
import { deprecatedKeys, toJsonSchema } from '../schema/zod.js'

export function commandSchema(entry: Entry) {
  if (isGroup(entry) || isFetch(entry)) return undefined
  const definition = entry as CommandDefinition
  const deprecated = deprecatedKeys(definition.options)
  return {
    args: toJsonSchema(definition.args),
    env: toJsonSchema(definition.env),
    options: toJsonSchema(definition.options),
    optionEnv: definition.optionEnv,
    output: toJsonSchema(definition.output),
    ...(deprecated.length ? { deprecated } : undefined),
  }
}
