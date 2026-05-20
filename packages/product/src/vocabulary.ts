export type Vocabulary = {
  verbs: readonly string[]
  flags: readonly string[]
  aliases: Readonly<Record<string, string>>
}

export const DEFAULT_GENERATED_VOCABULARY: Vocabulary = Object.freeze({
  verbs: Object.freeze(['get', 'list', 'create', 'update', 'delete', 'run']),
  flags: Object.freeze(['json', 'local', 'remote', 'force']),
  aliases: Object.freeze({}),
}) as Vocabulary

export type VocabularyOverrides = {
  verbs?: readonly string[]
  flags?: readonly string[]
  aliases?: Readonly<Record<string, string>>
}

export function vocabulary(overrides: VocabularyOverrides = {}): Vocabulary {
  return {
    verbs: mergeUnique(DEFAULT_GENERATED_VOCABULARY.verbs, overrides.verbs),
    flags: mergeUnique(DEFAULT_GENERATED_VOCABULARY.flags, overrides.flags),
    aliases: { ...DEFAULT_GENERATED_VOCABULARY.aliases, ...(overrides.aliases ?? {}) },
  }
}

function mergeUnique(base: readonly string[], extra: readonly string[] | undefined): readonly string[] {
  if (!extra || extra.length === 0) return base
  const seen = new Set(base)
  const out = [...base]
  for (const item of extra) {
    if (!seen.has(item)) {
      seen.add(item)
      out.push(item)
    }
  }
  return out
}
