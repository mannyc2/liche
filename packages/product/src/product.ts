import type {
  AuthSpec,
  ContextSpec,
  PermissionSpec,
  ProductContextEntry,
  RequiresSpec,
} from './auth.js'
import type {
  CapabilityExample,
  CommandSpec,
  EffectsSpec,
  HttpSpec,
  PolicySpec,
  SurfaceHints,
} from './command.js'
import type { ProductConfigSpec } from './config.js'
import type { FieldBuilder } from './field.js'
import type { ProductRemoteSpec } from './runtime.js'
import type { Shape } from './shape.js'
import type { ProductOpsSpec } from './ops.js'
import { DEFAULT_GENERATED_VOCABULARY, type Vocabulary } from './vocabulary.js'

export type ProductScope = {
  kind: string
  param: string
}

export type ProductMetadata = {
  id: string
  name: string
  version: string
  description?: string
  scope?: ProductScope
  vocabulary?: Vocabulary
}

export type ResourceMetadata = {
  label: string
  path: string
  doc?: string
  scope?: string
}

export type ResourceOperationSpec = {
  summary: string
  description?: string
  effects?: EffectsSpec
  policy?: PolicySpec
  examples?: readonly CapabilityExample[]
  http?: HttpSpec
  input?: Shape
  output: Shape
  requires?: RequiresSpec
  surfaces?: SurfaceHints
}

export type BindingSpec = {
  key: string
  doc?: string
  fields: Shape
}

export type ResourceOperationEntry = {
  verb: string
  spec: ResourceOperationSpec
}

export type ProductCommandEntry = {
  id: string
  spec: CommandSpec
}

export type ProductResource = ResourceMetadata & {
  id: string
  fields: Readonly<Record<string, FieldBuilder>>
  operations: readonly ResourceOperationEntry[]
}

export type ProductResourceDefinition = ResourceMetadata & {
  fields?: Readonly<Record<string, FieldBuilder>>
  operations?: Readonly<Record<string, ResourceOperationSpec>> | readonly ResourceOperationEntry[]
}

export type ProductResourceDefinitionEntry = ProductResourceDefinition & {
  id: string
}

export type ProductDefinition = ProductMetadata & {
  auth?: AuthSpec
  contexts?: Readonly<Record<string, ContextSpec>> | readonly ProductContextEntry[]
  permissions?: Readonly<Record<string, PermissionSpec>>
  ops?: ProductOpsSpec
  config?: ProductConfigSpec
  remote?: ProductRemoteSpec
  resources?:
    | Readonly<Record<string, ProductResourceDefinition>>
    | readonly ProductResourceDefinitionEntry[]
  commands?: Readonly<Record<string, CommandSpec>> | readonly ProductCommandEntry[]
  bindings?: Readonly<Record<string, Omit<BindingSpec, 'key'>>> | readonly BindingSpec[]
}

export type DefinedProduct = {
  readonly kind: 'liche.product'
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly scope?: ProductScope
  readonly vocabulary: Vocabulary
  readonly resources: readonly ProductResource[]
  readonly commands: readonly ProductCommandEntry[]
  readonly bindings: readonly BindingSpec[]
  readonly configSpec?: ProductConfigSpec
  readonly remoteSpec?: ProductRemoteSpec
  readonly authSpec?: AuthSpec
  readonly contexts: readonly ProductContextEntry[]
  readonly permissionSpecs: Readonly<Record<string, PermissionSpec>>
  readonly opsSpec?: ProductOpsSpec
}

export function defineProduct(init: ProductDefinition): DefinedProduct {
  const base: DefinedProduct = {
    kind: 'liche.product',
    id: init.id,
    name: init.name,
    version: init.version,
    vocabulary: init.vocabulary ?? DEFAULT_GENERATED_VOCABULARY,
    resources: normalizeResourceDefinitions(init.resources),
    commands: normalizeCommandDefinitions(init.commands),
    bindings: normalizeBindingDefinitions(init.bindings),
    contexts: normalizeContextDefinitions(init.contexts),
    permissionSpecs: { ...(init.permissions ?? {}) },
    ...(init.description ? { description: init.description } : undefined),
    ...(init.scope ? { scope: init.scope } : undefined),
    ...(init.auth ? { authSpec: init.auth } : undefined),
    ...(init.config ? { configSpec: init.config } : undefined),
    ...(init.remote ? { remoteSpec: init.remote } : undefined),
    ...(init.ops ? { opsSpec: init.ops } : undefined),
  }
  return base
}

function normalizeResourceDefinitions(
  resources: ProductDefinition['resources'],
): readonly ProductResource[] {
  if (!resources) return []
  const entries = Array.isArray(resources)
    ? resources.map((resource) => [resource.id, resource] as const)
    : Object.entries(resources)
  return entries.map(([id, resource]) => ({
    id,
    label: resource.label,
    path: resource.path,
    ...(resource.doc ? { doc: resource.doc } : undefined),
    ...(resource.scope ? { scope: resource.scope } : undefined),
    fields: { ...(resource.fields ?? {}) },
    operations: normalizeResourceOperations(resource.operations),
  }))
}

function normalizeResourceOperations(
  operations: ProductResourceDefinition['operations'],
): readonly ResourceOperationEntry[] {
  if (!operations) return []
  return Array.isArray(operations)
    ? operations.map((operation) => ({ verb: operation.verb, spec: operation.spec }))
    : Object.entries(operations).map(([verb, spec]) => ({ verb, spec }))
}

function normalizeCommandDefinitions(
  commands: ProductDefinition['commands'],
): readonly ProductCommandEntry[] {
  if (!commands) return []
  return Array.isArray(commands)
    ? commands.map((command) => ({ id: command.id, spec: command.spec }))
    : Object.entries(commands).map(([id, spec]) => ({ id, spec }))
}

function normalizeBindingDefinitions(
  bindings: ProductDefinition['bindings'],
): readonly BindingSpec[] {
  if (!bindings) return []
  return Array.isArray(bindings)
    ? bindings.map((binding) => ({ ...binding }))
    : Object.entries(bindings).map(([key, binding]) => ({ key, ...binding }))
}

function normalizeContextDefinitions(
  contexts: ProductDefinition['contexts'],
): readonly ProductContextEntry[] {
  if (!contexts) return []
  return Array.isArray(contexts)
    ? contexts.map((context) => ({ id: context.id, spec: context.spec }))
    : Object.entries(contexts).map(([id, spec]) => ({ id, spec }))
}

export type RuntimeProduct = DefinedProduct
