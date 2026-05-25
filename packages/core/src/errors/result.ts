import type { CommandError, CtaBlock, Result, ResultMeta } from '../types.js'

const RESULT_BRAND: unique symbol = Symbol.for('liche.result') as never
type RuntimeResult = Result & { readonly [RESULT_BRAND]: true }

export function commandError(error: CommandError): CommandError {
  const code = error.code || 'UNKNOWN'
  const message = error.message || code
  return {
    ...error,
    code,
    detail: error.detail ?? message,
    exitCode: error.exitCode ?? 1,
    message,
    title: error.title ?? titleFromCode(code),
    type: error.type ?? problemType(code),
  }
}

export function ok(data?: unknown, meta?: ResultMeta): Result {
  return brandResult({
    ok: true,
    data: data ?? null,
    error: null,
    ...(hasMeta(meta) ? { meta } : {}),
  })
}

export function fail(error: CommandError & { cta?: CtaBlock | undefined }, meta?: ResultMeta): Result {
  const { cta, ...commandErrorInput } = error
  const mergedMeta = cta === undefined ? meta : { ...(meta ?? {}), cta }
  return brandResult({
    ok: false,
    data: null,
    error: commandError(commandErrorInput),
    ...(hasMeta(mergedMeta) ? { meta: mergedMeta } : {}),
  })
}

export function isRuntimeResult(value: unknown): value is Result {
  return !!value && typeof value === 'object' && (value as RuntimeResult)[RESULT_BRAND] === true
}

function brandResult(result: Result): RuntimeResult {
  Object.defineProperty(result, RESULT_BRAND, {
    enumerable: false,
    value: true,
  })
  return result as RuntimeResult
}

function hasMeta(meta: ResultMeta | undefined): meta is ResultMeta {
  return meta !== undefined && Object.keys(meta).length > 0
}

function problemType(code: string): string {
  return `urn:liche:error:${code.toLowerCase().replace(/_/g, '-')}`
}

function titleFromCode(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Unknown'
}
