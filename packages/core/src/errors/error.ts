import type { CommandError, FieldError } from '../types.js'

export class BaseError extends Error {
  override name = 'Lili.BaseError'
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

export class LiliError extends BaseError {
  override name = 'Lili.LiliError'
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

  constructor(options: LiliError.Options) {
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

export declare namespace LiliError {
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
  override name = 'Lili.ValidationError'
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
  override name = 'Lili.ParseError'

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
    return normalizeCommandError({
      code: 'VALIDATION_ERROR',
      exitCode: 1,
      fieldErrors: error.fieldErrors,
      message: error.shortMessage,
    })
  }

  if (error instanceof ParseError) {
    return normalizeCommandError({
      code: 'PARSE_ERROR',
      exitCode: 1,
      message: error.shortMessage,
    })
  }

  if (error instanceof LiliError) {
    const status = error.status ?? statusFromDetails(error.details)
    return normalizeCommandError({
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

  return normalizeCommandError({
    code: 'UNKNOWN',
    exitCode: 1,
    message: error instanceof Error ? error.message : String(error),
  })
}

export function normalizeCommandError(error: CommandError): CommandError {
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

function problemType(code: string): string {
  return `urn:lili:error:${code.toLowerCase().replace(/_/g, '-')}`
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
