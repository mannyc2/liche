import type { CliState, FieldError, SelectedCommand } from '../types.js'
import { kebab } from '../internal.js'
import { objectShape } from '../schema/zod.js'
import { renderHelp } from '../help/render.js'

type ValidationTarget =
  | { kind: 'option'; label: string }
  | { kind: 'environment variable'; label: string }
  | { kind: 'argument'; label: string }

export function formatHumanValidationError(
  name: string,
  state: CliState,
  selected: SelectedCommand,
  fieldErrors: FieldError[],
): string {
  const command = selected.entry as any
  const lines: string[] = []
  for (const fe of fieldErrors) {
    const target = formatValidationTarget(command, fe.path)
    if (fe.missing) lines.push(`Error: missing required ${target.kind} ${target.label}`)
    else if (target.kind === 'environment variable')
      lines.push(`Error: invalid value for environment variable ${target.label}: ${fe.message}`)
    else lines.push(`Error: invalid value for ${target.label}: ${fe.message}`)
  }
  lines.push('See below for usage.', '')
  lines.push(renderHelp(name, state, selected, selected.path))
  return lines.join('\n')
}

function formatValidationTarget(command: any, path: string): ValidationTarget {
  const trimmed = path.startsWith('$.') ? path.slice(2) : path === '$' ? '' : path
  if (!trimmed) return { kind: 'argument', label: 'input' }

  const [head, ...tail] = trimmed.split('.')
  const suffix = tail.length ? `.${tail.join('.')}` : ''

  if (head && objectShape(command.options)[head]) {
    return { kind: 'option', label: `--${kebab(head)}${suffix}` }
  }
  if (head && objectShape(command.env)[head]) {
    return { kind: 'environment variable', label: `${head}${suffix}` }
  }
  return { kind: 'argument', label: `<${trimmed}>` }
}
