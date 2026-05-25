import type {
  CreateOptions,
  GlobalInputDefinition,
  NormalizedGlobalInputDefinition,
} from '../types.js'
import { normalizeGlobalInput } from './definition.js'

export type RuntimeGlobalInput = NormalizedGlobalInputDefinition

export function globalRegistryFor(definition: CreateOptions): readonly RuntimeGlobalInput[] {
  return assertUniqueGlobals([
    ...normalizeGlobalInputs(definition.globals ?? []),
  ])
}

function normalizeGlobalInputs(globals: readonly GlobalInputDefinition[]): RuntimeGlobalInput[] {
  return globals.map((global) => normalizeGlobalInput(global))
}

function assertUniqueGlobals(globals: RuntimeGlobalInput[]): RuntimeGlobalInput[] {
  const flags = new Map<string, RuntimeGlobalInput>()
  const aliases = new Map<string, RuntimeGlobalInput>()
  for (const global of globals) {
    const duplicate = flags.get(global.flag)
    if (duplicate) throw new Error(`Global flag --${global.flag} is declared more than once`)
    if (aliases.has(global.flag)) {
      throw new Error(`Global flag --${global.flag} conflicts with global alias -${global.flag}`)
    }
    flags.set(global.flag, global)

    if (!global.alias) continue
    if (flags.has(global.alias)) {
      throw new Error(`Global alias -${global.alias} conflicts with global flag --${global.alias}`)
    }
    const duplicateAlias = aliases.get(global.alias)
    if (duplicateAlias) throw new Error(`Global alias -${global.alias} is declared more than once`)
    aliases.set(global.alias, global)
  }
  return globals
}
