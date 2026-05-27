import type { CliState, FieldError, FieldErrorSource, SelectedCommand } from '../types.js'
import { objectShape } from '../schema/zod.js'
import { renderHelp } from '../help/render.js'
import { isCommand } from '../command/guards.js'

type ValidationTarget =
  | { kind: 'option'; label: string }
  | { kind: 'environment variable'; label: string }
  | { kind: 'argument'; label: string }
  | { kind: 'output'; label: string }

export function formatHumanValidationError(
  name: string,
  state: CliState,
  selected: SelectedCommand,
  fieldErrors: FieldError[],
): string {
  const runtime = isCommand(selected.entry) ? selected.entry.runtime : undefined
  const lines: string[] = []
  for (const fe of fieldErrors) {
    const target = fe.source
      ? formatTargetFromSource(runtime, fe.source, fe.path)
      : { kind: 'argument' as const, label: neutralLabel(fe.path) }
    if (target.kind === 'output') {
      if (fe.missing) lines.push(`Error: command output missing required field ${target.label}`)
      else lines.push(`Error: invalid value for command output ${target.label}: ${fe.message}`)
    } else if (fe.missing) {
      lines.push(`Error: missing required ${target.kind} ${target.label}`)
    } else if (target.kind === 'environment variable') {
      lines.push(`Error: invalid value for environment variable ${target.label}: ${fe.message}`)
    } else {
      lines.push(`Error: invalid value for ${target.label}: ${fe.message}`)
    }
  }
  lines.push('See below for usage.', '')
  lines.push(renderHelp(name, state, selected, selected.path))
  return lines.join('\n')
}

function formatTargetFromSource(command: any, source: FieldErrorSource, path: string): ValidationTarget {
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
    case 'output':
      return { kind: 'output', label: `"${path}"` }
  }
}

function argLabelForPositional(command: any, index: number): string {
  const argKeys = Object.keys(objectShape(command?.args))
  const key = argKeys[index]
  return key ? `<${key}>` : `<positional ${index}>`
}

function neutralLabel(path: string): string {
  if (path === '$') return 'input'
  const trimmed = path.startsWith('$.') ? path.slice(2) : path
  return `<${trimmed || 'input'}>`
}
