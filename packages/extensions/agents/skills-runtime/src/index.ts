import { Formatter, defineExtension, manifestEnvelope } from '@liche/core'
import type { CliExtension, Format } from '@liche/core'
import { skillIndex, skillMarkdown } from './generate.js'
import type { SkillCommandPolicy } from './generate.js'

export type SkillsRuntimeOptions = {
  commands?: SkillCommandPolicy | undefined
}

export function skillsRuntime(options: SkillsRuntimeOptions = {}): CliExtension {
  const commandPolicy = options.commands ?? {}
  return defineExtension({
    id: 'liche.skills-runtime',
    globals: [{ expose: 'runtime', flag: 'llms', key: 'llms', type: 'boolean' }],
    terminalHandlers: [
      {
        flagKey: 'llms',
        handle: ({ binaryName, flags, options, state }) => {
          const out = options.stdout ?? ((text: string) => void Bun.stdout.write(text))
          const outputFormat = (flags.format ?? (flags.json ? 'json' : 'md')) as Format
          const wantsStructured = flags.formatExplicit === true && outputFormat !== 'md'
          if (wantsStructured) {
            return out(`${Formatter.format(manifestEnvelope(binaryName, state), outputFormat)}\n`)
          }
          const value = flags.fullOutput ? skillMarkdown(binaryName, state, commandPolicy) : skillIndex(binaryName, state, commandPolicy)
          return out(`${Formatter.format(value, 'md')}\n`)
        },
      },
    ],
  })
}

export { skillIndex, skillMarkdown } from './generate.js'
export type { SkillCommandPolicy } from './generate.js'
