import type { GlobalInputDefinition, NormalizedGlobalInputDefinition } from '../types.js'
import { kebab } from '../internal.js'

export function defineGlobal<T extends GlobalInputDefinition>(definition: T): Readonly<GlobalInputDefinition> {
  return Object.freeze(normalizeGlobalInput(definition))
}

export function normalizeGlobalInput(definition: GlobalInputDefinition): NormalizedGlobalInputDefinition {
  return {
    ...definition,
    expose: definition.expose ?? 'context',
    flag: normalizeLongFlag(definition.flag ?? kebab(definition.key)),
    ...(definition.alias ? { alias: normalizeShortFlag(definition.alias) } : undefined),
  }
}

function normalizeLongFlag(flag: string): string {
  return flag.replace(/^--/, '')
}

function normalizeShortFlag(alias: string): string {
  return alias.replace(/^-/, '')
}
