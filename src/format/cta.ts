import type { Cta, CtaBlock } from '../types.js'
import { kebab } from '../internal.js'

export function formatCta(binaryName: string, cta: CtaBlock): string {
  const commands = cta.commands ?? []
  if (!commands.length) return ''

  const heading = cta.description ?? 'Next:'
  const lines = commands.map((command) => `  ${render(binaryName, command)}`)
  return `${heading}\n${lines.join('\n')}\n`
}

function render(binaryName: string, cta: Cta): string {
  if (typeof cta === 'string') return `${binaryName} ${cta}`

  const args = Object.values(cta.args ?? {}).map(String)
  const options = Object.entries(cta.options ?? {}).flatMap(([key, value]) =>
    value === true ? [`--${kebab(key)}`] : [`--${kebab(key)}`, String(value)],
  )
  const command = [binaryName, cta.command, ...args, ...options].filter(Boolean).join(' ')
  return cta.description ? `${command} - ${cta.description}` : command
}
