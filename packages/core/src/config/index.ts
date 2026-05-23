import type { ConfigObjectDefinition, ConfigScopesDeclaration, Schema } from '../types.js'

export type ConfigObjectOptions<T = Record<string, unknown>> = {
  files?: readonly string[] | undefined
  flag?: string | undefined
  schema?: Schema<T> | undefined
  scopes?: ConfigScopesDeclaration | undefined
}

export const Config = {
  object<T = Record<string, unknown>>(options: ConfigObjectOptions<T>): ConfigObjectDefinition<T> {
    const out: ConfigObjectDefinition<T> = { kind: 'lili.config.object' }
    if (options.files) out.files = [...options.files]
    if (options.flag) out.flag = options.flag
    if (options.schema) out.schema = options.schema
    if (options.scopes) out.scopes = { ...options.scopes }
    return out
  },
} as const
