import { isRecord } from './json-rpc.js'

export function objectSchema(value: unknown) {
  if (isRecord(value) && value['type'] === 'object') return value
  return { type: 'object', properties: {} }
}

export function jsonSchema(value: unknown) {
  return isRecord(value) ? value : undefined
}

export function mcpAnnotations(command: { examples?: unknown; name: string }): Record<string, unknown> {
  return {
    command: command.name,
    ...(command.examples ? { examples: command.examples } : undefined),
  }
}
