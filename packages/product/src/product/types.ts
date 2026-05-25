import type {
  AuthSpec,
  ContextSpec,
  PermissionSpec,
  ProductContextEntry,
} from '../auth/types.js'
import type {
  CapabilityExample,
  CommandSpec,
  EffectsSpec,
  HttpSpec,
  PolicySpec,
  SurfaceHints,
} from '../command/types.js'
import type { RequiresSpec } from '../auth/types.js'
import type { ProductConfigSpec } from '../config/create.js'
import type { FieldBuilder } from '../schema/field.js'
import type { ProductRemoteSpec } from '../runtime/runtime.js'
import type { Shape } from '../schema/shape.js'
import type { ProductOpsSpec } from '../ops/types.js'
import type { Vocabulary } from '../schema/vocabulary.js'

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

export type RuntimeProduct = DefinedProduct
