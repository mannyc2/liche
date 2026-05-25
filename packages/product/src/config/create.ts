import type { Shape } from '../schema/shape.js'

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
  kind: 'liche.product.config.object'
  files?: readonly string[] | undefined
  fields: Shape
  scopes?: ConfigScopesSpec | undefined
}

export type ProductConfigDefinition = {
  files?: readonly string[] | undefined
  fields: Shape
  scopes?: ConfigScopesSpec | undefined
}

export function createConfig(definition: ProductConfigDefinition): ProductConfigSpec {
  const out: ProductConfigSpec = {
    kind: 'liche.product.config.object',
    fields: definition.fields,
  }
  if (definition.files) out.files = [...definition.files]
  if (definition.scopes) out.scopes = { ...definition.scopes }
  return out
}
