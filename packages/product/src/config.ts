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

export type ProductConfigObjectInit = {
  files?: readonly string[] | undefined
  fields: Shape
  scopes?: ConfigScopesSpec | undefined
}

export const Config = {
  object(init: ProductConfigObjectInit): ProductConfigSpec {
    const out: ProductConfigSpec = {
      kind: 'lili.product.config.object',
      fields: init.fields,
    }
    if (init.files) out.files = [...init.files]
    if (init.scopes) out.scopes = { ...init.scopes }
    return out
  },
} as const
