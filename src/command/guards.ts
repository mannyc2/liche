import type { AliasEntry, Entry, FetchEntry, GroupEntry, Result } from '../types.js'

export function isAlias(entry: unknown): entry is AliasEntry {
  return !!entry && typeof entry === 'object' && (entry as any)._alias === true
}

export function isGroup(entry: unknown): entry is GroupEntry {
  return !!entry && typeof entry === 'object' && (entry as any)._group === true
}

export function isFetch(entry: unknown): entry is FetchEntry {
  return !!entry && typeof entry === 'object' && (entry as any)._fetch === true
}

export function isResult(value: unknown): value is Result {
  return !!value && typeof value === 'object' && typeof (value as any).ok === 'boolean'
}

export function resolveAlias(commands: Map<string, Entry>, entry: Entry | undefined): Entry | undefined {
  return isAlias(entry) ? commands.get(entry.target) : entry
}
