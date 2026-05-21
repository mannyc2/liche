import type { ConfigObjectDefinition, ConfigScopesDeclaration, Schema } from '../types.js'

export type ConfigObjectInit<T = Record<string, unknown>> = {
  files?: readonly string[] | undefined
  flag?: string | undefined
  schema?: Schema<T> | undefined
  scopes?: ConfigScopesDeclaration | undefined
}

export const Config = {
  object<T = Record<string, unknown>>(init: ConfigObjectInit<T>): ConfigObjectDefinition<T> {
    const out: ConfigObjectDefinition<T> = { kind: 'lili.config.object' }
    if (init.files) out.files = [...init.files]
    if (init.flag) out.flag = init.flag
    if (init.schema) out.schema = init.schema
    if (init.scopes) out.scopes = { ...init.scopes }
    return out
  },
} as const
