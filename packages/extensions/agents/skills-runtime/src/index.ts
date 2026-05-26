import { Formatter, defineExtension, manifestEnvelope } from '@liche/core'
import type { CliExtension, Format } from '@liche/core'
import { skillIndex, skillMarkdown } from './generate.js'

export function skillsRuntime(): CliExtension {
  return defineExtension({
    id: 'liche.skills-runtime',
    globals: [{ expose: 'runtime', flag: 'llms', key: 'llms', type: 'boolean' }],
    serveHandlers: [
      {
        flagKey: 'llms',
        handle: ({ binaryName, flags, options, state }) => {
          const out = options.stdout ?? ((text: string) => void Bun.stdout.write(text))
          const outputFormat = (flags.format ?? (flags.json ? 'json' : 'md')) as Format
          const wantsStructured = flags.formatExplicit === true && outputFormat !== 'md'
          if (wantsStructured) {
            return out(`${Formatter.format(manifestEnvelope(binaryName, state), outputFormat)}\n`)
          }
          const value = flags.fullOutput ? skillMarkdown(binaryName, state) : skillIndex(binaryName, state)
          return out(`${Formatter.format(value, 'md')}\n`)
        },
      },
    ],
  })
}

export { skillIndex, skillMarkdown } from './generate.js'
