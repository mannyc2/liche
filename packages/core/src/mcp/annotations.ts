import { isRecord } from './json-rpc.js'

export function objectSchema(value: unknown) {
  if (isRecord(value) && value['type'] === 'object') return value
  return { type: 'object', properties: {} }
}

export function jsonSchema(value: unknown) {
  return isRecord(value) ? value : undefined
}

export function mcpAnnotations(command: { effects?: any; examples?: unknown; name: string; policy?: any; safety?: any }): Record<string, unknown> {
  const destructive = command.safety?.destructive ?? (command.policy?.dangerous === true || command.effects?.kind === 'delete')
  const idempotent = command.safety?.idempotent ?? command.effects?.idempotent === true
  const openWorld = command.safety?.openWorld ?? true
  const readOnly = command.safety?.readOnly ?? command.effects?.kind === 'read'

  return {
    command: command.name,
    ...(command.effects ? { effects: command.effects } : undefined),
    ...(command.policy ? { policy: command.policy } : undefined),
    ...(command.safety ? { safety: command.safety } : undefined),
    ...(command.examples ? { examples: command.examples } : undefined),
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: openWorld,
    readOnlyHint: readOnly,
  }
}
