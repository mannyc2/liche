import type { CommandSpec, HttpSpec, SurfaceHints } from './command.js'
import type { FieldBuilder } from './field.js'
import type { Shape } from './shape.js'

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
  http?: HttpSpec
  input?: Shape
  output: Shape
  permission?: string
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
  #resources: ResourceBuilder[] = []
  #commands: ProductCommandEntry[] = []
  #bindings: BindingSpec[] = []

  private constructor(init: ProductInit) {
    this.id = init.id
    this.name = init.name
    this.version = init.version
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

  get resources(): readonly ResourceBuilder[] {
    return this.#resources
  }

  get commands(): readonly ProductCommandEntry[] {
    return this.#commands
  }

  get bindings(): readonly BindingSpec[] {
    return this.#bindings
  }
}

export type RuntimeProduct = Product
