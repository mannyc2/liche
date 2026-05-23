import type { Shape } from './shape.js'

export type ConfigScopeSpec =
  | boolean
  | {
      discoverUpwards?: boolean | undefined
      xdg?: boolean | undefined
    }

export type ConfigScopesSpec = {
  project?: ConfigScopeSpec | undefined
  user?: ConfigScopeSpec | undefined
}

export type ProductConfigSpec = {
  kind: 'lili.product.config.object'
  files?: readonly string[] | undefined
  fields: Shape
  scopes?: ConfigScopesSpec | undefined
}

export type ProductConfigDefinition = {
  files?: readonly string[] | undefined
  fields: Shape
  scopes?: ConfigScopesSpec | undefined
}

export const Config = {
  object(definition: ProductConfigDefinition): ProductConfigSpec {
    const out: ProductConfigSpec = {
      kind: 'lili.product.config.object',
      fields: definition.fields,
    }
    if (definition.files) out.files = [...definition.files]
    if (definition.scopes) out.scopes = { ...definition.scopes }
    return out
  },
} as const
