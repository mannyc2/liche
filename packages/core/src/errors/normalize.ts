import type { CommandError } from '../types.js'
import { LicheError, ParseError, ValidationError } from './classes.js'
import { commandError } from './result.js'

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

function isCommandErrorLike(error: unknown): error is CommandError {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as CommandError).code === 'string' &&
    typeof (error as CommandError).message === 'string'
  )
}

function statusFromDetails(details: Record<string, unknown> | undefined): number | undefined {
  return typeof details?.['status'] === 'number' ? details['status'] : undefined
}
