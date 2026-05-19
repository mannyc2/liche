import { z } from 'zod'

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

export type RuntimeValue =
  | { envVar: string; literal?: string }
  | { envVar?: string; literal: string }

export type ContractRemote = {
  baseUrl: RuntimeValue
  auth?: { kind: 'none' | 'bearer' | 'apiKey'; envVar?: string; header?: string }
  timeoutMs?: number
}

export type ContractInit = {
  name: string
  version: string
  vocabulary?: Vocabulary
  remote?: ContractRemote
}

export class Contract {
  // Runtime-loaded contract modules use this tag for narrow validation before generation.
  readonly kind = 'lili.contract' as const
  readonly name: string
  readonly version: string
  readonly vocabulary: Vocabulary
  readonly remote?: ContractRemote
  readonly #operations: Operation[]

  private constructor(spec: ContractInit) {
    this.name = spec.name
    this.version = spec.version
    this.vocabulary = spec.vocabulary ?? DEFAULT_GENERATED_VOCABULARY
    if (spec.remote) this.remote = spec.remote
    this.#operations = []
  }

  static create(spec: ContractInit): Contract {
    return new Contract(spec)
  }

  operation(spec: Operation): this {
    this.#operations.push(spec)
    return this
  }

  get operations(): readonly Operation[] {
    return this.#operations
  }
}

export type RuntimeContract = Contract
