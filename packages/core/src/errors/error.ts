import type { CommandError, CtaBlock, FieldError, Result, ResultMeta } from '../types.js'

const RESULT_BRAND: unique symbol = Symbol.for('liche.result') as any
type RuntimeResult = Result & { readonly [RESULT_BRAND]: true }

export class BaseError extends Error {
  override name = 'Liche.BaseError'
  shortMessage: string
  details: string | Record<string, unknown> | undefined

  constructor(shortMessage: string, options: BaseError.Options = {}) {
    const details = options.cause instanceof Error ? options.cause.message : undefined
    const message = details ? `${shortMessage}\n\nDetails: ${details}` : shortMessage
    super(message, { cause: options.cause })
    this.shortMessage = shortMessage
    this.details = details
  }

  walk(fn?: ((error: unknown) => boolean) | undefined): unknown {
    return walk(this, fn)
  }
}

export declare namespace BaseError {
  type Options = { cause?: Error | undefined }
}

export class LicheError extends BaseError {
  override name = 'Liche.LicheError'
  code: string
  code_actions: CommandError['code_actions']
  detail: string | undefined
  override details: Record<string, unknown> | undefined
  hint: string | undefined
  instance: string | undefined
  retryable: boolean
  retry_after: number | string | undefined
  status: number | undefined
  suggested_fix: string | undefined
  title: string | undefined
  type: string | undefined
  exitCode: number | undefined

  constructor(options: LicheError.Options) {
    super(options.message, { cause: options.cause })
    this.code = options.code
    this.code_actions = options.code_actions
    this.detail = options.detail
    this.details = options.details
    this.hint = options.hint
    this.instance = options.instance
    this.retryable = options.retryable ?? false
    this.retry_after = options.retry_after
    this.status = options.status
    this.suggested_fix = options.suggested_fix
    this.title = options.title
    this.type = options.type
    this.exitCode = options.exitCode
  }
}

export declare namespace LicheError {
  type Options = {
    code: string
    message: string
    code_actions?: CommandError['code_actions']
    detail?: string | undefined
    details?: Record<string, unknown> | undefined
    hint?: string | undefined
    instance?: string | undefined
    retry_after?: number | string | undefined
    retryable?: boolean | undefined
    status?: number | undefined
    suggested_fix?: string | undefined
    title?: string | undefined
    type?: string | undefined
    exitCode?: number | undefined
    cause?: Error | undefined
  }
}

export class ValidationError extends BaseError {
  override name = 'Liche.ValidationError'
  fieldErrors: FieldError[]

  constructor(options: ValidationError.Options) {
    super(options.message, { cause: options.cause })
    this.fieldErrors = options.fieldErrors ?? []
  }
}

export declare namespace ValidationError {
  type Options = {
    message: string
    fieldErrors?: FieldError[] | undefined
    cause?: Error | undefined
  }
}

export class ParseError extends BaseError {
  override name = 'Liche.ParseError'

  constructor(options: ParseError.Options) {
    super(options.message, { cause: options.cause })
  }
}

export declare namespace ParseError {
  type Options = {
    message: string
    cause?: Error | undefined
  }
}

export function toCommandError(error: unknown): CommandError {
  if (error instanceof ValidationError) {
    return commandError({
      code: 'VALIDATION_ERROR',
      exitCode: 1,
      fieldErrors: error.fieldErrors,
      message: error.shortMessage,
    })
  }

  if (error instanceof ParseError) {
    return commandError({
      code: 'PARSE_ERROR',
      exitCode: 1,
      message: error.shortMessage,
    })
  }

  if (error instanceof LicheError) {
    const status = error.status ?? statusFromDetails(error.details)
    return commandError({
      code: error.code,
      ...(error.code_actions !== undefined ? { code_actions: error.code_actions } : undefined),
      ...(error.detail !== undefined ? { detail: error.detail } : undefined),
      details: error.details,
      exitCode: error.exitCode ?? 1,
      hint: error.hint,
      ...(error.instance !== undefined ? { instance: error.instance } : undefined),
      message: error.shortMessage,
      ...(error.retry_after !== undefined ? { retry_after: error.retry_after } : undefined),
      retryable: error.retryable,
      ...(status !== undefined ? { status } : undefined),
      ...(error.suggested_fix !== undefined ? { suggested_fix: error.suggested_fix } : undefined),
      ...(error.title !== undefined ? { title: error.title } : undefined),
      ...(error.type !== undefined ? { type: error.type } : undefined),
    })
  }

  if (isCommandErrorLike(error)) return commandError(error)

  return commandError({
    code: 'UNKNOWN',
    exitCode: 1,
    message: error instanceof Error ? error.message : String(error),
  })
}

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

function isCommandErrorLike(error: unknown): error is CommandError {
  return !!error
    && typeof error === 'object'
    && typeof (error as CommandError).code === 'string'
    && typeof (error as CommandError).message === 'string'
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

function statusFromDetails(details: Record<string, unknown> | undefined): number | undefined {
  return typeof details?.['status'] === 'number' ? details['status'] : undefined
}

function walk(error: unknown, fn?: ((error: unknown) => boolean) | undefined): unknown {
  if (fn) {
    let current = (error as any)?.cause
    while (current) {
      if (fn(current)) return current
      current = (current as any)?.cause
    }
    return undefined
  }
  let current = error
  while ((current as any)?.cause) current = (current as any).cause
  return current
}
