import { z } from 'zod'
import type {
  Effects,
  LocalOperation,
  Locality,
  Operation,
  OperationExample,
  OperationPolicy,
  ProgramRemote,
  RemoteBind,
  RemoteOperation,
  RuntimeNormalizedProgram,
  Vocabulary,
} from './schema.js'

export type VocabularyIR = {
  verbs: string[]
  flags: string[]
  aliases: Record<string, string>
  forbiddenVerbs: string[]
  forbiddenFlags: string[]
}

export type SchemaProjectionIR = {
  jsonSchema: unknown
  portability: {
    openapi: boolean
    mcp: boolean
    docs: boolean
    reasons: string[]
  }
}

export type RemoteBindIR = {
  path: string[]
  query: string[]
  headers: Record<string, string>
  body: true | string[] | false
}

export type RemoteOperationIR = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  bind: RemoteBindIR
}

export type LocalOperationIR = {
  module: string
  export: string
}

export type OperationEffectsIR = {
  kind: 'read' | 'write' | 'delete' | 'exec'
  idempotent: boolean
  dangerous: boolean
}

export type OperationPolicyIR = {
  idempotent: boolean
  destructive: boolean
  requiresConfirmation: boolean
  conformance: 'auto' | 'fixture-only' | 'skip'
}

export type OperationExampleIR = {
  name?: string
  argv: string[]
  input: unknown
  response?: unknown
  safe?: boolean
}

export type OperationIR = {
  id: string
  verb: string
  command: string[]
  description?: string
  locality: { modes: Array<'local' | 'remote'>; default: 'local' | 'remote' }
  input: SchemaProjectionIR
  output: SchemaProjectionIR
  remote?: RemoteOperationIR
  local?: LocalOperationIR
  effects: OperationEffectsIR
  examples: OperationExampleIR[]
  policy: OperationPolicyIR
}

export type ProgramRemoteIR = {
  baseUrl: { envVar?: string; literal?: string }
  auth: { kind: 'none' | 'bearer' | 'apiKey'; envVar?: string; header?: string }
  timeoutMs: number
}

export type ProgramIR = {
  kind: 'lili.program'
  irVersion: 1
  name: string
  version: string
  vocabulary: VocabularyIR
  remote?: ProgramRemoteIR
  operations: OperationIR[]
}

export function normalizeProgram(runtime: RuntimeNormalizedProgram): ProgramIR {
  return {
    kind: 'lili.program',
    irVersion: 1,
    name: runtime.name,
    version: runtime.version,
    vocabulary: normalizeVocabulary(runtime.vocabulary),
    ...(runtime.remote ? { remote: normalizeProgramRemote(runtime.remote) } : {}),
    operations: runtime.operations.map(normalizeOperation),
  }
}

function normalizeVocabulary(vocab: Vocabulary): VocabularyIR {
  return {
    verbs: [...vocab.verbs],
    flags: [...vocab.flags],
    aliases: { ...vocab.aliases },
    forbiddenVerbs: [...vocab.forbiddenVerbs],
    forbiddenFlags: [...vocab.forbiddenFlags],
  }
}

function normalizeProgramRemote(remote: ProgramRemote): ProgramRemoteIR {
  return {
    baseUrl: { ...remote.baseUrl },
    auth: remote.auth ?? { kind: 'none' },
    timeoutMs: remote.timeoutMs ?? 30_000,
  }
}

function normalizeOperation(op: Operation): OperationIR {
  const effects = normalizeEffects(op.effects)
  return {
    id: op.id,
    verb: op.verb,
    command: [...op.command],
    ...(op.description ? { description: op.description } : {}),
    locality: normalizeLocality(op.locality),
    input: projectSchema(op.input),
    output: projectSchema(op.output),
    ...(op.remote ? { remote: normalizeRemoteOperation(op.remote) } : {}),
    ...(op.local ? { local: normalizeLocalOperation(op.local) } : {}),
    effects,
    examples: (op.examples ?? []).map(normalizeExample),
    policy: normalizePolicy(op.policy, effects),
  }
}

function normalizeLocality(locality: Locality): OperationIR['locality'] {
  return { modes: [...locality.modes], default: locality.default }
}

function normalizeEffects(effects: Effects): OperationEffectsIR {
  const dangerous = effects.dangerous ?? (effects.kind === 'delete' || effects.kind === 'exec')
  const idempotent = effects.idempotent ?? (effects.kind === 'read' || effects.kind === 'delete')
  return { kind: effects.kind, idempotent, dangerous }
}

function normalizePolicy(policy: OperationPolicy | undefined, effects: OperationEffectsIR): OperationPolicyIR {
  const destructive = policy?.destructive ?? (effects.kind === 'delete' || effects.dangerous)
  return {
    idempotent: policy?.idempotent ?? effects.idempotent,
    destructive,
    requiresConfirmation: policy?.requiresConfirmation ?? destructive,
    conformance: policy?.conformance ?? 'auto',
  }
}

function normalizeRemoteOperation(remote: RemoteOperation): RemoteOperationIR {
  return {
    method: remote.method,
    path: remote.path,
    bind: normalizeBind(remote.bind),
  }
}

function normalizeBind(bind: RemoteBind | undefined): RemoteBindIR {
  let body: true | string[] | false
  if (bind?.body === undefined) body = false
  else if (Array.isArray(bind.body)) body = [...bind.body]
  else body = bind.body as true | false
  return {
    path: bind?.path ? [...bind.path] : [],
    query: bind?.query ? [...bind.query] : [],
    headers: bind?.headers ? { ...bind.headers } : {},
    body,
  }
}

function normalizeLocalOperation(local: LocalOperation): LocalOperationIR {
  return { module: local.module, export: local.export }
}

function normalizeExample(example: OperationExample): OperationExampleIR {
  return {
    ...(example.name ? { name: example.name } : {}),
    argv: [...example.argv],
    input: example.input ?? null,
    ...(example.response !== undefined ? { response: example.response } : {}),
    ...(example.safe !== undefined ? { safe: example.safe } : {}),
  }
}

function projectSchema(schema: z.ZodType): SchemaProjectionIR {
  return {
    jsonSchema: stabilizeJsonSchema(z.toJSONSchema(schema, { unrepresentable: 'any' })),
    portability: { openapi: true, mcp: true, docs: true, reasons: [] },
  }
}

// Zod emits `required` arrays in declaration order. The set semantics of
// JSON Schema `required` means order is not semantic; sort it so source-order
// changes don't perturb the canonical digest.
function stabilizeJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stabilizeJsonSchema)
  if (node === null || typeof node !== 'object') return node
  const obj = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    const v = obj[key]
    if (key === 'required' && Array.isArray(v)) {
      out[key] = [...v].sort()
    } else {
      out[key] = stabilizeJsonSchema(v)
    }
  }
  return out
}
