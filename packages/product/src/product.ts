import type { AuthSpec, ContextSpec, PermissionSpec, ProductContextEntry, RequiresSpec } from './auth.js'
import type { CapabilityExample, CommandSpec, EffectsSpec, HttpSpec, PolicySpec, SurfaceHints } from './command.js'
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

export type ProductInit = {
  id: string
  name: string
  version: string
  description?: string
  scope?: ProductScope
  vocabulary?: Vocabulary
}

export type ResourceInit = {
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

export type ProductResource = ResourceInit & {
  id: string
  fields: Readonly<Record<string, FieldBuilder>>
  operations: readonly ResourceOperationEntry[]
}

export type ProductResourceDefinition = ResourceInit & {
  fields?: Readonly<Record<string, FieldBuilder>>
  operations?: Readonly<Record<string, ResourceOperationSpec>> | readonly ResourceOperationEntry[]
}

export type ProductResourceDefinitionEntry = ProductResourceDefinition & {
  id: string
}

export type ProductDefinition = ProductInit & {
  auth?: AuthSpec
  contexts?: Readonly<Record<string, ContextSpec>> | readonly ProductContextEntry[]
  permissions?: Readonly<Record<string, PermissionSpec>>
  ops?: ProductOpsSpec
  config?: ProductConfigSpec
  remote?: ProductRemoteSpec
  resources?: Readonly<Record<string, ProductResourceDefinition>> | readonly ProductResourceDefinitionEntry[]
  commands?: Readonly<Record<string, CommandSpec>> | readonly ProductCommandEntry[]
  bindings?: Readonly<Record<string, Omit<BindingSpec, 'key'>>> | readonly BindingSpec[]
}

export type DefinedProduct = {
  readonly kind: 'lili.product'
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
    kind: 'lili.product',
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

export class ResourceBuilder {
  readonly kind = 'lili.resource' as const
  readonly id: string
  readonly label: string
  readonly path: string
  readonly doc?: string
  readonly scope?: string
  #fields: Record<string, FieldBuilder> = {}
  #operations: ResourceOperationEntry[] = []

  constructor(id: string, init: ResourceInit) {
    this.id = id
    this.label = init.label
    this.path = init.path
    if (init.doc) this.doc = init.doc
    if (init.scope) this.scope = init.scope
  }

  field(key: string, field: FieldBuilder): this {
    this.#fields[key] = field
    return this
  }

  operation(verb: string, spec: ResourceOperationSpec): this {
    this.#operations.push({ verb, spec })
    return this
  }

  get fields(): Readonly<Record<string, FieldBuilder>> {
    return this.#fields
  }

  get operations(): readonly ResourceOperationEntry[] {
    return this.#operations
  }
}

export type ResourceBuilderFn = (resource: ResourceBuilder) => ResourceBuilder | void

export class Product {
  readonly kind = 'lili.product' as const
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly scope?: ProductScope
  readonly vocabulary: Vocabulary
  #resources: ResourceBuilder[] = []
  #commands: ProductCommandEntry[] = []
  #bindings: BindingSpec[] = []
  #config: ProductConfigSpec | undefined
  #remote: ProductRemoteSpec | undefined
  #auth: AuthSpec | undefined
  #contexts: ProductContextEntry[] = []
  #ops: ProductOpsSpec | undefined
  #permissions: Record<string, PermissionSpec> = {}

  private constructor(init: ProductInit) {
    this.id = init.id
    this.name = init.name
    this.version = init.version
    this.vocabulary = init.vocabulary ?? DEFAULT_GENERATED_VOCABULARY
    if (init.description) this.description = init.description
    if (init.scope) this.scope = init.scope
  }

  static create(init: ProductInit): Product {
    return new Product(init)
  }

  resource(id: string, init: ResourceInit, build: ResourceBuilderFn): this {
    const resource = new ResourceBuilder(id, init)
    build(resource)
    this.#resources.push(resource)
    return this
  }

  command(id: string, spec: CommandSpec): this {
    this.#commands.push({ id, spec })
    return this
  }

  binding(spec: BindingSpec): this {
    this.#bindings.push(spec)
    return this
  }

  config(spec: ProductConfigSpec): this {
    if (this.#config !== undefined) {
      throw new Error(`Product '${this.id}' already declared config; only one config object is allowed.`)
    }
    this.#config = spec
    return this
  }

  remote(spec: ProductRemoteSpec): this {
    if (this.#remote !== undefined) {
      throw new Error(`Product '${this.id}' already declared remote settings.`)
    }
    this.#remote = spec
    return this
  }

  auth(spec: AuthSpec): this {
    if (this.#auth !== undefined) {
      throw new Error(`Product '${this.id}' already declared auth; only one provider is allowed.`)
    }
    this.#auth = spec
    return this
  }

  context(id: string, spec: ContextSpec): this {
    if (this.#contexts.some((c) => c.id === id)) {
      throw new Error(`Product '${this.id}' already declared context '${id}'.`)
    }
    this.#contexts.push({ id, spec })
    return this
  }

  permissions(specs: Record<string, PermissionSpec>): this {
    for (const [id, spec] of Object.entries(specs)) {
      if (this.#permissions[id] !== undefined) {
        throw new Error(`Product '${this.id}' already declared permission '${id}'.`)
      }
      this.#permissions[id] = spec
    }
    return this
  }

  ops(spec: ProductOpsSpec): this {
    if (this.#ops !== undefined) {
      throw new Error(`Product '${this.id}' already declared local ops settings.`)
    }
    this.#ops = spec
    return this
  }

  get resources(): readonly ResourceBuilder[] {
    return this.#resources
  }

  get commands(): readonly ProductCommandEntry[] {
    return this.#commands
  }

  get bindings(): readonly BindingSpec[] {
    return this.#bindings
  }

  get configSpec(): ProductConfigSpec | undefined {
    return this.#config
  }

  get remoteSpec(): ProductRemoteSpec | undefined {
    return this.#remote
  }

  get authSpec(): AuthSpec | undefined {
    return this.#auth
  }

  get contexts(): readonly ProductContextEntry[] {
    return this.#contexts
  }

  get permissionSpecs(): Readonly<Record<string, PermissionSpec>> {
    return this.#permissions
  }

  get opsSpec(): ProductOpsSpec | undefined {
    return this.#ops
  }
}

export type RuntimeProduct = DefinedProduct | Product
