import { LicheError } from '../errors/error.js'
import { asError, remoteError, safeUrl } from './errors.js'
import type { CommandError } from '../types.js'
import type { HttpOperationCall, SerializedHttpRequest } from './types.js'

export function mapStatusError<TInput extends Record<string, unknown>, TOutput>(
  response: Response,
  text: string,
  request: SerializedHttpRequest,
  options: HttpOperationCall<TInput, TOutput>,
  secrets: string[],
  safeBodyBytes: number,
): LicheError {
  if (response.status === 401 && options.auth?.kind === 'resolved' && options.auth.statusErrors?.[401]) return licheStatusError(options.auth.statusErrors[401])
  if (response.status === 403 && options.auth?.kind === 'resolved' && options.auth.statusErrors?.[403]) return licheStatusError(options.auth.statusErrors[403])
  return remoteError('REMOTE_HTTP_STATUS', 'Remote server returned an error status.', {
    bodyPreview: safeBodyPreview(text, safeBodyBytes, secrets),
    method: request.method,
    operationId: options.id,
    requestId: response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? response.headers.get('cf-ray') ?? undefined,
    status: response.status,
    statusText: response.statusText,
    url: safeUrl(request.url),
  })
}

function licheStatusError(error: CommandError): LicheError {
  return new LicheError({
    code: error.code,
    message: error.message,
    ...(error.code_actions ? { code_actions: error.code_actions } : undefined),
    ...(error.detail !== undefined ? { detail: error.detail } : undefined),
    ...(error.details !== undefined ? { details: error.details } : undefined),
    ...(error.hint !== undefined ? { hint: error.hint } : undefined),
    ...(error.instance !== undefined ? { instance: error.instance } : undefined),
    ...(error.retry_after !== undefined ? { retry_after: error.retry_after } : undefined),
    ...(error.retryable !== undefined ? { retryable: error.retryable } : undefined),
    ...(error.status !== undefined ? { status: error.status } : undefined),
    ...(error.suggested_fix !== undefined ? { suggested_fix: error.suggested_fix } : undefined),
    ...(error.title !== undefined ? { title: error.title } : undefined),
    ...(error.type !== undefined ? { type: error.type } : undefined),
    ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : undefined),
  })
}

export async function readResponseText(
  response: Response,
  request: SerializedHttpRequest,
  operationId: string | undefined,
): Promise<string> {
  try {
    return await response.text()
  } catch (error) {
    throw remoteError('REMOTE_NETWORK', 'Remote response body could not be read.', {
      operationId,
      method: request.method,
      status: response.status,
      statusText: response.statusText,
      url: safeUrl(request.url),
    }, undefined, { cause: asError(error), retryable: true })
  }
}

export function parseResponseBody(
  response: Response,
  text: string,
  request: SerializedHttpRequest,
  operationId: string | undefined,
): unknown {
  if (response.status === 204 || response.status === 205 || text.length === 0) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (!isJsonContentType(contentType) && !looksLikeJson(text)) {
    throw remoteError('REMOTE_RESPONSE_UNSUPPORTED_CONTENT_TYPE', 'Remote response content type is not supported.', {
      operationId,
      method: request.method,
      status: response.status,
      statusText: response.statusText,
      url: safeUrl(request.url),
    })
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw remoteError('REMOTE_RESPONSE_MALFORMED', 'Remote response body is not valid JSON.', {
      operationId,
      method: request.method,
      status: response.status,
      statusText: response.statusText,
      url: safeUrl(request.url),
    }, undefined, { cause: asError(error) })
  }
}

function isJsonContentType(contentType: string): boolean {
  const type = contentType.split(';', 1)[0]?.trim().toLowerCase()
  return type === 'application/json' || !!type?.endsWith('+json')
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed === 'null'
}

function safeBodyPreview(text: string, limit: number, secrets: readonly string[]): string | undefined {
  if (!text) return undefined
  let preview = text.slice(0, Math.max(0, limit))
  for (const secret of secrets) {
    if (secret) preview = preview.split(secret).join('[redacted]')
  }
  preview = preview.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]')
  preview = preview.replace(/(["']?(?:api[_-]?key|token|secret)["']?\s*[:=]\s*["'])[^"',\s]+(["'])?/gi, '$1[redacted]$2')
  return preview
}
