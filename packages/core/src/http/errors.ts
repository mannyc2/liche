import { LicheError } from '../errors/error.js'
import type { RemoteErrorDetails } from './types.js'

export function remoteError(
  code: string,
  message: string,
  details?: RemoteErrorDetails | undefined,
  extra?: Record<string, unknown> | undefined,
  options?: { cause?: Error | undefined; retryable?: boolean | undefined } | undefined,
): LicheError {
  const mergedDetails = compactDetails(details, extra)
  return new LicheError({
    code,
    details: mergedDetails,
    message,
    retryable: options?.retryable,
    cause: options?.cause,
    exitCode: 1,
    ...remoteRecovery(code, mergedDetails, options),
  })
}

export function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return undefined
  }
}

export function asError(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function remoteRecovery(
  code: string,
  details: Record<string, unknown> | undefined,
  options: { retryable?: boolean | undefined } | undefined,
): Pick<LicheError.Options, 'retry_after' | 'suggested_fix'> {
  if (code === 'REMOTE_CONFIG_MISSING_BASE_URL') {
    const envVar = typeof details?.['envVar'] === 'string' ? details['envVar'] : undefined
    return {
      suggested_fix: envVar
        ? `Set ${envVar} to the remote API base URL before retrying.`
        : 'Set the remote API base URL before retrying.',
    }
  }
  if (code === 'REMOTE_CONFIG_INVALID_BASE_URL') {
    return { suggested_fix: 'Use an absolute http(s) URL for the remote API base URL.' }
  }
  if (code === 'REMOTE_CONFIG_MISSING_AUTH') {
    const envVar = typeof details?.['envVar'] === 'string' ? details['envVar'] : undefined
    return {
      suggested_fix: envVar
        ? `Set ${envVar} before retrying.`
        : 'Configure remote authentication before retrying.',
    }
  }
  if (code === 'REMOTE_NETWORK' || code === 'REMOTE_TIMEOUT') {
    return {
      retry_after: options?.retryable ? 5 : undefined,
      suggested_fix: 'Check network connectivity and retry the command.',
    }
  }
  if (code === 'REMOTE_HTTP_STATUS') {
    const status = typeof details?.['status'] === 'number' ? details['status'] : undefined
    if (status !== undefined && status >= 500) {
      return { retry_after: 5, suggested_fix: 'Retry after the remote service recovers.' }
    }
    return { suggested_fix: 'Check the remote request details and retry with corrected inputs or credentials.' }
  }
  if (code === 'REMOTE_RESPONSE_SCHEMA' || code === 'REMOTE_RESPONSE_MALFORMED') {
    return { suggested_fix: 'Check whether the remote service response matches the declared output schema.' }
  }
  return {}
}

function compactDetails(
  details: RemoteErrorDetails | undefined,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details ?? {})) {
    if (value !== undefined) out[key] = value
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value !== undefined) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}
