import { commandError } from '../errors/result.js'
import type { CommandError, Entry, Schema } from '../types.js'
import { getRuntimeArgMeta, type CodecKind, type StoredCodecSurface } from './arg.js'
import { isObjectSchema, objectShape } from './zod.js'

export type CommandSurface = 'cli' | 'fetch' | { kind: 'extension'; transport: string }

export type SurfaceCheckResult =
  | { ok: true }
  | { ok: false; field: string; codecKind: CodecKind; surface: CommandSurface }

export function checkCommandSurface(entry: Entry | undefined, surface: CommandSurface): SurfaceCheckResult {
  if (!entry || !(entry as { _command?: boolean })._command) return { ok: true }
  const runtime = (entry as { runtime?: { args?: Schema; options?: Schema; env?: Schema } }).runtime
  if (!runtime) return { ok: true }

  for (const root of [runtime.args, runtime.options, runtime.env]) {
    const result = inspectSchema(root, '$', surface)
    if (!result.ok) return result
  }
  return { ok: true }
}

export function unsupportedSurfaceError(detail: {
  surface: CommandSurface
  codecKind: CodecKind
  field: string
}): CommandError {
  return commandError({
    code: 'UNSUPPORTED_SURFACE',
    message: `Codec ${detail.codecKind} at ${detail.field} is not callable on surface ${formatSurface(detail.surface)}`,
    details: {
      codecKind: detail.codecKind,
      field: detail.field,
      surface: detail.surface,
    },
    status: 400,
    title: 'Unsupported Surface',
  })
}

const INNER_TYPE_KINDS = new Set(['optional', 'default', 'nullable', 'catch', 'readonly', 'prefault', 'promise'])

function inspectSchema(
  schema: Schema | undefined,
  fieldPath: string,
  surface: CommandSurface,
  seen = new WeakSet<object>(),
): SurfaceCheckResult {
  if (!schema) return { ok: true }
  if (typeof schema === 'object') {
    if (seen.has(schema)) return { ok: true }
    seen.add(schema)
  }

  const meta = getRuntimeArgMeta(schema)
  if (meta && !surfaceAllows(meta.surface, surface)) {
    return { ok: false, field: fieldPath, codecKind: meta.codecKind, surface }
  }

  const def = (schema as any)?.def
  const kind: string | undefined = def?.type

  if (kind && INNER_TYPE_KINDS.has(kind) && def.innerType) {
    return inspectSchema(def.innerType, fieldPath, surface, seen)
  }

  if (kind === 'lazy' && typeof def.getter === 'function') {
    try {
      return inspectSchema(def.getter(), fieldPath, surface, seen)
    } catch {
      return { ok: true }
    }
  }

  if (kind === 'pipe') {
    if (def.in) {
      const result = inspectSchema(def.in, fieldPath, surface, seen)
      if (!result.ok) return result
    }
    if (def.out) {
      const result = inspectSchema(def.out, fieldPath, surface, seen)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  if (isObjectSchema(schema)) {
    const shape = objectShape(schema)
    for (const [key, child] of Object.entries(shape)) {
      const childPath = fieldPath === '$' ? key : `${fieldPath}.${key}`
      const result = inspectSchema(child, childPath, surface, seen)
      if (!result.ok) return result
    }
    if (def.catchall) {
      const result = inspectSchema(def.catchall, appendPath(fieldPath, '{}'), surface, seen)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  if (kind === 'array' && def.element) {
    return inspectSchema(def.element, appendPath(fieldPath, '[]'), surface, seen)
  }

  if (kind === 'tuple' && Array.isArray(def.items)) {
    for (let index = 0; index < def.items.length; index++) {
      const result = inspectSchema(def.items[index], appendPath(fieldPath, `[${index}]`), surface, seen)
      if (!result.ok) return result
    }
    if (def.rest) {
      const result = inspectSchema(def.rest, appendPath(fieldPath, '[]'), surface, seen)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  if (kind === 'record') {
    if (def.keyType) {
      const result = inspectSchema(def.keyType, appendPath(fieldPath, '{key}'), surface, seen)
      if (!result.ok) return result
    }
    if (def.valueType) {
      const result = inspectSchema(def.valueType, appendPath(fieldPath, '{}'), surface, seen)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  if (kind === 'map') {
    if (def.keyType) {
      const result = inspectSchema(def.keyType, appendPath(fieldPath, '{key}'), surface, seen)
      if (!result.ok) return result
    }
    if (def.valueType) {
      const result = inspectSchema(def.valueType, appendPath(fieldPath, '{}'), surface, seen)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  if (kind === 'set' && def.valueType) {
    return inspectSchema(def.valueType, appendPath(fieldPath, '[]'), surface, seen)
  }

  if (kind === 'union' && Array.isArray(def.options)) {
    for (let index = 0; index < def.options.length; index++) {
      const result = inspectSchema(def.options[index], `${fieldPath}|${index}`, surface, seen)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  if (kind === 'intersection') {
    if (def.left) {
      const result = inspectSchema(def.left, fieldPath, surface, seen)
      if (!result.ok) return result
    }
    if (def.right) {
      const result = inspectSchema(def.right, fieldPath, surface, seen)
      if (!result.ok) return result
    }
    return { ok: true }
  }

  return { ok: true }
}

function surfaceAllows(stored: StoredCodecSurface | undefined, request: CommandSurface): boolean {
  if (stored === undefined) return true
  if (stored === 'all') return true
  if (typeof stored === 'string' && typeof request === 'string') return stored === request
  if (typeof stored === 'object' && typeof request === 'object') return stored.transport === request.transport
  return false
}

function formatSurface(surface: CommandSurface): string {
  return typeof surface === 'string' ? surface : `extension:${surface.transport}`
}

function appendPath(fieldPath: string, suffix: string): string {
  return fieldPath === '$' ? suffix : `${fieldPath}${suffix}`
}
