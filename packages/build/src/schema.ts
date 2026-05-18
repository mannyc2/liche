import { z } from 'zod'

export type Vocabulary = {
  verbs: readonly string[]
  flags: readonly string[]
  aliases: Readonly<Record<string, string>>
  forbiddenVerbs: readonly string[]
  forbiddenFlags: readonly string[]
}

export const DEFAULT_GENERATED_VOCABULARY: Vocabulary = Object.freeze({
  verbs: Object.freeze(['get', 'list', 'create', 'update', 'delete', 'run']),
  flags: Object.freeze(['json', 'local', 'remote', 'force']),
  aliases: Object.freeze({}),
  forbiddenVerbs: Object.freeze(['info']),
  forbiddenFlags: Object.freeze(['format', 'skip-confirmations', 'skipConfirmations']),
}) as Vocabulary

export type VocabularyOverrides = {
  verbs?: readonly string[]
  flags?: readonly string[]
  aliases?: Readonly<Record<string, string>>
  forbiddenVerbs?: readonly string[]
  forbiddenFlags?: readonly string[]
}

export function vocabulary(overrides: VocabularyOverrides = {}): Vocabulary {
  return {
    verbs: mergeUnique(DEFAULT_GENERATED_VOCABULARY.verbs, overrides.verbs),
    flags: mergeUnique(DEFAULT_GENERATED_VOCABULARY.flags, overrides.flags),
    aliases: { ...DEFAULT_GENERATED_VOCABULARY.aliases, ...(overrides.aliases ?? {}) },
    forbiddenVerbs: mergeUnique(DEFAULT_GENERATED_VOCABULARY.forbiddenVerbs, overrides.forbiddenVerbs),
    forbiddenFlags: mergeUnique(DEFAULT_GENERATED_VOCABULARY.forbiddenFlags, overrides.forbiddenFlags),
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

export type Effects = {
  kind: 'read' | 'write' | 'delete' | 'exec'
  idempotent?: boolean
  dangerous?: boolean
}

export type LocalityModes = readonly ('local' | 'remote')[]
export type Locality = {
  modes: LocalityModes
  default: 'local' | 'remote'
}

export type RemoteBind = {
  path?: readonly string[]
  query?: readonly string[]
  headers?: Readonly<Record<string, string>>
  body?: true | readonly string[] | false
}

export type RemoteOperation = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  bind?: RemoteBind
}

export type LocalOperation = {
  module: string
  export: string
}

export type OperationPolicy = {
  idempotent?: boolean
  destructive?: boolean
  requiresConfirmation?: boolean
  conformance?: 'auto' | 'fixture-only' | 'skip'
}

export type OperationExample = {
  name?: string
  argv: readonly string[]
  input?: unknown
  response?: unknown
  safe?: boolean
}

export type Operation = {
  id: string
  verb: string
  command: readonly string[]
  description?: string
  locality: Locality
  input: z.ZodType
  output: z.ZodType
  effects: Effects
  examples?: readonly OperationExample[]
  policy?: OperationPolicy
  remote?: RemoteOperation
  local?: LocalOperation
}

export function operation(spec: Operation): Operation {
  return spec
}

export type ProgramRemote = {
  baseUrl: { envVar?: string; literal?: string }
  auth?: { kind: 'none' | 'bearer' | 'apiKey'; envVar?: string; header?: string }
  timeoutMs?: number
}

export type Program = {
  name: string
  version: string
  vocabulary?: Vocabulary
  remote?: ProgramRemote
  operations: readonly Operation[]
}

export type RuntimeNormalizedProgram = {
  kind: 'lili.runtime-program'
  name: string
  version: string
  vocabulary: Vocabulary
  remote?: ProgramRemote
  operations: readonly Operation[]
}

export function defineProgram(spec: Program): RuntimeNormalizedProgram {
  return {
    kind: 'lili.runtime-program',
    name: spec.name,
    version: spec.version,
    vocabulary: spec.vocabulary ?? DEFAULT_GENERATED_VOCABULARY,
    ...(spec.remote ? { remote: spec.remote } : {}),
    operations: spec.operations,
  }
}
