import type { CommandError, FieldError } from '../types.js'

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
    return walkCause(this, fn)
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

function walkCause(error: unknown, fn?: ((error: unknown) => boolean) | undefined): unknown {
  if (fn) {
    let current = (error as { cause?: unknown })?.cause
    while (current) {
      if (fn(current)) return current
      current = (current as { cause?: unknown })?.cause
    }
    return undefined
  }
  let current = error
  while ((current as { cause?: unknown })?.cause) current = (current as { cause: unknown }).cause
  return current
}
