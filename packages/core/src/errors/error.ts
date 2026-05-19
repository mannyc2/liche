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
  override details: Record<string, unknown> | undefined
  hint: string | undefined
  retryable: boolean
  exitCode: number | undefined

  constructor(options: LiliError.Options) {
    super(options.message, { cause: options.cause })
    this.code = options.code
    this.details = options.details
    this.hint = options.hint
    this.retryable = options.retryable ?? false
    this.exitCode = options.exitCode
  }
}

export declare namespace LiliError {
  type Options = {
    code: string
    message: string
    details?: Record<string, unknown> | undefined
    hint?: string | undefined
    retryable?: boolean | undefined
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

export function errorToObject(error: unknown): CommandError {
  if (error instanceof ValidationError) {
    return {
      code: 'VALIDATION_ERROR',
      exitCode: 1,
      fieldErrors: error.fieldErrors,
      message: error.shortMessage,
    }
  }

  if (error instanceof ParseError) {
    return {
      code: 'PARSE_ERROR',
      exitCode: 1,
      message: error.shortMessage,
    }
  }

  if (error instanceof LiliError) {
    return {
      code: error.code,
      details: error.details,
      exitCode: error.exitCode ?? 1,
      hint: error.hint,
      message: error.shortMessage,
      retryable: error.retryable,
    }
  }

  return {
    code: 'UNKNOWN',
    exitCode: 1,
    message: error instanceof Error ? error.message : String(error),
  }
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
