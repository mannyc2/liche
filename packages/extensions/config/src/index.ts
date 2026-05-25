import { defineCommand, defineExtension } from '@liche/core'
import type {
  CliExtension,
  ConfigDefinition,
  ConfigScopesDeclaration,
  Schema,
} from '@liche/core'

export type ConfigExtensionOptions<T = Record<string, unknown>> = {
  files?: readonly string[] | undefined
  flag?: string | undefined
  schema?: Schema<T> | undefined
  scopes?: ConfigScopesDeclaration | undefined
}

export function config<T extends Record<string, unknown> = Record<string, unknown>>(
  options: ConfigExtensionOptions<T>,
): CliExtension {
  return defineExtension({
    id: 'liche.config',
    config: {
      kind: 'liche.config.object',
      ...(options.files ? { files: options.files } : undefined),
      ...(options.flag ? { flag: options.flag } : undefined),
      ...(options.schema ? { schema: options.schema } : undefined),
      ...(options.scopes ? { scopes: options.scopes } : undefined),
    } as ConfigDefinition,
  })
}

export function configDoctor(): CliExtension {
  return defineExtension({
    id: 'liche.config-doctor',
    commands: [
      defineCommand({
        agent: false,
        description: 'Inspect config loading',
        path: ['config', 'doctor'],
        run: ({ ctx }) => ({
          config: {
            enabled: true,
            loaded: ctx.configLoaded,
            keys: Object.keys(ctx.config).sort(),
          },
        }),
        safety: { readOnly: true },
      }),
    ],
  })
}
