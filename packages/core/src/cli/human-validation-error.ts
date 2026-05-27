import type { CliState, FieldError, FieldErrorSource, SelectedCommand } from '../types.js'
import { kebab } from '../internal.js'
import { objectShape } from '../schema/zod.js'
import { renderHelp } from '../help/render.js'
import { isCommand } from '../command/guards.js'

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
  const runtime = isCommand(selected.entry) ? selected.entry.runtime : undefined
  const lines: string[] = []
  for (const fe of fieldErrors) {
    const fromSource = fe.source ? formatTargetFromSource(runtime, fe.source) : undefined
    const target = fromSource ?? formatValidationTarget(runtime, fe.path)
    if (fe.missing) lines.push(`Error: missing required ${target.kind} ${target.label}`)
    else if (target.kind === 'environment variable')
      lines.push(`Error: invalid value for environment variable ${target.label}: ${fe.message}`)
    else lines.push(`Error: invalid value for ${target.label}: ${fe.message}`)
  }
  lines.push('See below for usage.', '')
  lines.push(renderHelp(name, state, selected, selected.path))
  return lines.join('\n')
}

function formatTargetFromSource(command: any, source: FieldErrorSource): ValidationTarget | undefined {
  switch (source.kind) {
    case 'argv':
      if ('flag' in source) return { kind: 'option', label: source.flag }
      return { kind: 'argument', label: argLabelForPositional(command, source.positional) }
    case 'env':
      return { kind: 'environment variable', label: source.name }
    case 'provider':
      return { kind: 'option', label: `${source.provider} provider value ${source.path}` }
    case 'fetch-query':
      return { kind: 'argument', label: `query parameter ?${source.key}=` }
    case 'fetch-body':
      return { kind: 'argument', label: `body field "${source.key}"` }
    case 'extension':
      return { kind: 'argument', label: `${source.transport} input "${source.key}"` }
    case 'programmatic':
      return { kind: 'argument', label: `input "${source.key}"` }
    default:
      return undefined
  }
}

function argLabelForPositional(command: any, index: number): string {
  const argKeys = Object.keys(objectShape(command?.args))
  const key = argKeys[index]
  return key ? `<${key}>` : `<positional ${index}>`
}

function formatValidationTarget(command: any, path: string): ValidationTarget {
  const trimmed = path.startsWith('$.') ? path.slice(2) : path === '$' ? '' : path
  if (!trimmed) return { kind: 'argument', label: 'input' }

  const [head, ...tail] = trimmed.split('.')
  const suffix = tail.length ? `.${tail.join('.')}` : ''

  if (head && objectShape(command?.options)[head]) {
    return { kind: 'option', label: `--${kebab(head)}${suffix}` }
  }
  if (head && objectShape(command?.env)[head]) {
    return { kind: 'environment variable', label: `${head}${suffix}` }
  }
  return { kind: 'argument', label: `<${trimmed}>` }
}
