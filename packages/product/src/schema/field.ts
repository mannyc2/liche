export type FieldType = 'uuid' | 'hostname' | 'string' | 'int' | 'bool' | 'enum' | 'datetime'

export type FieldMutability = 'immutable' | 'create-only' | 'mutable'

export type NormalizedField = {
  type: FieldType
  description: string
  values?: readonly string[]
  required: boolean
  secret: boolean
  identifier: boolean
  humanLabel: boolean
  mutability: FieldMutability
  default?: unknown
  configPath?: string
}

export class FieldBuilder {
  readonly kind = 'liche.field' as const
  readonly type: FieldType
  readonly description: string
  #values?: readonly string[]
  #required = true
  #secret = false
  #identifier = false
  #humanLabel = false
  #mutability: FieldMutability = 'mutable'
  #hasDefault = false
  #default?: unknown
  #configPath?: string

  constructor(type: FieldType, description: string) {
    this.type = type
    this.description = description
  }

  required(): this {
    this.#required = true
    return this
  }

  optional(): this {
    this.#required = false
    return this
  }

  identifier(): this {
    this.#identifier = true
    return this
  }

  humanLabel(): this {
    this.#humanLabel = true
    return this
  }

  immutable(): this {
    this.#mutability = 'immutable'
    return this
  }

  createOnly(): this {
    this.#mutability = 'create-only'
    return this
  }

  secret(): this {
    this.#secret = true
    return this
  }

  values(...values: string[]): this {
    this.#values = [...values]
    return this
  }

  default(value: unknown): this {
    this.#hasDefault = true
    this.#default = value
    return this
  }

  fromConfig(path: string): this {
    this.#configPath = path
    return this
  }

  toField(): NormalizedField {
    const base: NormalizedField = {
      type: this.type,
      description: this.description,
      required: this.#required,
      secret: this.#secret,
      identifier: this.#identifier,
      humanLabel: this.#humanLabel,
      mutability: this.#mutability,
    }
    if (this.#values) (base as { values?: readonly string[] }).values = [...this.#values]
    if (this.#hasDefault) (base as { default?: unknown }).default = this.#default
    if (this.#configPath) (base as { configPath?: string }).configPath = this.#configPath
    return base
  }
}

export const Field = {
  string(description: string): FieldBuilder {
    return new FieldBuilder('string', description)
  },
  int(description: string): FieldBuilder {
    return new FieldBuilder('int', description)
  },
  boolean(description: string): FieldBuilder {
    return new FieldBuilder('bool', description)
  },
  uuid(description: string): FieldBuilder {
    return new FieldBuilder('uuid', description)
  },
  hostname(description: string): FieldBuilder {
    return new FieldBuilder('hostname', description)
  },
  datetime(description: string): FieldBuilder {
    return new FieldBuilder('datetime', description)
  },
  enum(description: string, values: readonly string[]): FieldBuilder {
    return new FieldBuilder('enum', description).values(...values)
  },
} as const
