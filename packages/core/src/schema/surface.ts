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

function inspectSchema(schema: Schema | undefined, fieldPath: string, surface: CommandSurface): SurfaceCheckResult {
  if (!schema) return { ok: true }

  const meta = getRuntimeArgMeta(schema)
  if (meta && !surfaceAllows(meta.surface, surface)) {
    return { ok: false, field: fieldPath, codecKind: meta.codecKind, surface }
  }

  if (isObjectSchema(schema)) {
    const shape = objectShape(schema)
    for (const [key, child] of Object.entries(shape)) {
      const childPath = fieldPath === '$' ? key : `${fieldPath}.${key}`
      const result = inspectSchema(child, childPath, surface)
      if (!result.ok) return result
    }
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
