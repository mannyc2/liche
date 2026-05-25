import { defineExtension, defineGlobal } from '@liche/core'
import type { CliExtension, GlobalInputDefinition } from '@liche/core'

export const authGlobals: readonly GlobalInputDefinition[] = Object.freeze([
  defineGlobal({
    description: 'Profile to use',
    key: 'profile',
    type: 'string',
    valueLabel: 'name',
  }),
  defineGlobal({
    description: 'Disable interactive prompts',
    flag: 'non-interactive',
    key: 'nonInteractive',
    type: 'boolean',
  }),
  defineGlobal({
    description: 'Do not read or write stored session state',
    flag: 'no-session',
    key: 'noSession',
    type: 'boolean',
  }),
])

export function auth(): CliExtension {
  return defineExtension({
    id: 'liche.auth',
    globals: authGlobals,
  })
}
