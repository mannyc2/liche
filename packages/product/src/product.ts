import type { AuthSpec, ContextSpec, PermissionSpec, ProductContextEntry, RequiresSpec } from './auth.js'
import type { CapabilityExample, CommandSpec, EffectsSpec, HttpSpec, PolicySpec, SurfaceHints } from './command.js'
import type { ProductConfigSpec } from './config.js'
import type { FieldBuilder } from './field.js'
import type { ProductRemoteSpec } from './runtime.js'
import type { Shape } from './shape.js'
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
}

export type RuntimeProduct = Product
