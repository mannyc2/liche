import { authInvalid, authPermissionDenied } from '../auth/errors.js'
import { applyAuth } from '../auth/resolve.js'
import type { AuthCredential } from '../auth/types.js'
import { LiliError, ValidationError } from '../errors/error.js'
import { parseSchema } from '../schema/zod.js'
import type { Schema } from '../types.js'

export type RuntimeValue =
  | { envVar: string; literal?: string | undefined }
  | { envVar?: string | undefined; literal: string }

export type HttpAuth =
  | { kind: 'none' }
  | { kind: 'bearer'; envVar: string }
  | { kind: 'apiKey'; envVar: string; header: string }
  | { kind: 'resolved'; credential: AuthCredential }

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type HttpOperationBind<TInput = Record<string, unknown>> = {
  path?: Array<keyof TInput & string> | undefined
  query?: Array<keyof TInput & string> | undefined
  headers?: Record<string, keyof TInput & string> | undefined
  body?: true | Array<keyof TInput & string> | false | undefined
}

export type HttpOperationRequestSpec<TInput = Record<string, unknown>> = {
  id?: string | undefined
  baseUrl: RuntimeValue | string
  auth?: HttpAuth | undefined
  method: HttpMethod
  path: string
  bind: HttpOperationBind<TInput>
  input: TInput
  inputFields?: readonly (keyof TInput & string)[] | undefined
  env?: Record<string, string | undefined> | undefined
}

export type SerializedHttpRequest = {
  url: string
  method: string
  headers: Headers
  body?: string | undefined
}

export type HttpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type HttpOperationCall<TInput = Record<string, unknown>, TOutput = unknown> =
  HttpOperationRequestSpec<TInput> & {
    output: Schema<TOutput>
    fetch?: HttpFetch | undefined
    timeoutMs?: number | undefined
    safeBodyBytes?: number | undefined
    requiredPermissions?: readonly string[] | undefined
  }

export type RemoteErrorDetails = {
  operationId?: string | undefined
  method?: string | undefined
  url?: string | undefined
  status?: number | undefined
  statusText?: string | undefined
  requestId?: string | undefined
  bodyPreview?: string | undefined
  validation?: Array<{ path: string; message: string }> | undefined
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_SAFE_BODY_BYTES = 4096
const RESERVED_BOUND_HEADERS = new Set(['accept', 'authorization', 'content-type'])
const JSON_METHODS_WITH_BODY = new Set<HttpMethod>(['POST', 'PUT', 'PATCH'])

export function serializeHttpOperationRequest<TInput extends Record<string, unknown>>(
  options: HttpOperationRequestSpec<TInput>,
): SerializedHttpRequest {
  const env = options.env ?? {}
  const input = asRecord(options.input, options.id)
  const method = options.method.toUpperCase() as HttpMethod
  const headers = new Headers({ accept: 'application/json' })
  const knownFields = options.inputFields ? new Set<string>(options.inputFields) : undefined
  const usedFields = new Set<string>()

  validateBindFields<TInput>(options.bind, knownFields, options.id)
  const baseUrl = resolveBaseUrl(options.baseUrl, env, options.id)
  let path = options.path

  for (const field of options.bind.path ?? []) {
    const value = input[field]
    if (value === undefined || value === null) {
      throw remoteError('REMOTE_BIND_MISSING_PATH_PARAM', 'Missing remote path parameter.', {
        operationId: options.id,
        method,
      }, { field })
    }
    path = replacePathParam(path, field, serializeScalar(value, field, options.id))
    markUsed(usedFields, field, 'path', options.id)
  }

  const remainingPathParam = path.match(/\{([^}]+)\}/)
  if (remainingPathParam) {
    throw remoteError('REMOTE_BIND_MISSING_PATH_PARAM', 'Missing remote path parameter.', {
      operationId: options.id,
      method,
    }, { field: remainingPathParam[1] })
  }

  const url = resolveUrl(baseUrl, path, method, options.id)

  for (const field of options.bind.query ?? []) {
    const value = input[field]
    if (value === undefined) continue
    markUsed(usedFields, field, 'query', options.id)
    appendQuery(url, field, value, options.id)
  }

  for (const [header, field] of Object.entries(options.bind.headers ?? {})) {
    const normalized = header.toLowerCase()
    if (RESERVED_BOUND_HEADERS.has(normalized)) {
      throw remoteError('REMOTE_REQUEST_SERIALIZATION', 'Remote request header is reserved.', {
        operationId: options.id,
        method,
      }, { header })
    }
    const value = input[field]
    if (value === undefined) continue
    markUsed(usedFields, field, 'header', options.id)
    headers.set(header, serializeScalar(value, field, options.id))
  }

  const auth = options.auth ?? { kind: 'none' as const }
  applyTransportAuth(headers, auth, env, options.id, [])

  const bodyValue = resolveBodyValue<TInput>(method, input, options.bind, usedFields, options.id)
  const request: SerializedHttpRequest = {
    method,
    headers,
    url: url.toString(),
  }
  if (bodyValue !== undefined) {
    headers.set('content-type', 'application/json')
    request.body = JSON.stringify(bodyValue)
  }

  return request
}

export async function callHttpOperation<TInput extends Record<string, unknown>, TOutput>(
  options: HttpOperationCall<TInput, TOutput>,
): Promise<TOutput> {
  const secrets: string[] = []
  collectAuthSecrets(options.auth, options.env ?? {}, secrets)
  const request = serializeHttpOperationRequest(options)
  const fetcher: HttpFetch = options.fetch ?? fetch
  const safeBodyBytes = options.safeBodyBytes ?? DEFAULT_SAFE_BODY_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  let timedOut = false
  const timer = timeoutMs >= 0
    ? setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    : undefined

  let response: Response
  try {
    const init: RequestInit = {
      headers: request.headers,
      method: request.method,
      signal: controller.signal,
    }
    if (request.body !== undefined) init.body = request.body
    response = await fetcher(request.url, init)
  } catch (error) {
    if (timedOut || isAbortError(error)) {
      throw remoteError('REMOTE_TIMEOUT', 'Remote request timed out.', {
        operationId: options.id,
        method: request.method,
        url: safeUrl(request.url),
      }, undefined, { cause: asError(error), retryable: true })
    }
    throw remoteError('REMOTE_NETWORK', 'Remote request failed before receiving a response.', {
      operationId: options.id,
      method: request.method,
      url: safeUrl(request.url),
    }, undefined, { cause: asError(error), retryable: true })
  } finally {
    if (timer) clearTimeout(timer)
  }

  const text = await readResponseText(response, request, options.id)
  if (!response.ok) {
    throw mapStatusError(response, text, request, options, secrets, safeBodyBytes)
  }

  const parsed = parseResponseBody(response, text, request, options.id)
  try {
    return parseSchema(options.output, parsed, parsed) as TOutput
  } catch (error) {
    if (error instanceof ValidationError) {
      throw remoteError('REMOTE_RESPONSE_SCHEMA', 'Remote response did not match the expected schema.', {
        operationId: options.id,
        method: request.method,
        url: safeUrl(request.url),
        validation: error.fieldErrors.map(({ path, message }) => ({ path, message })),
      }, undefined, { cause: error })
    }
    throw error
  }
}

function asRecord(input: unknown, operationId: string | undefined): Record<string, unknown> {
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  throw remoteError('REMOTE_REQUEST_SERIALIZATION', 'Remote operation input must be an object.', {
    operationId,
  })
}

function resolveBaseUrl(
  value: RuntimeValue | string,
  env: Record<string, string | undefined>,
  operationId: string | undefined,
): string {
  const raw = typeof value === 'string' ? value : resolveRuntimeValue(value, env, operationId)
  if (!raw) {
    throw remoteError('REMOTE_CONFIG_MISSING_BASE_URL', 'Remote base URL is required.', { operationId })
  }
  try {
    return new URL(raw).toString()
  } catch (error) {
    throw remoteError('REMOTE_CONFIG_INVALID_BASE_URL', 'Remote base URL is invalid.', {
      operationId,
    }, undefined, { cause: asError(error) })
  }
}

function resolveRuntimeValue(
  value: RuntimeValue,
  env: Record<string, string | undefined>,
  operationId: string | undefined,
): string {
  if (value.envVar) {
    const envValue = env[value.envVar]
    if (envValue && envValue.length > 0) return envValue
    if (value.literal !== undefined) return value.literal
    throw remoteError('REMOTE_CONFIG_MISSING_BASE_URL', 'Remote base URL environment variable is not set.', {
      operationId,
    }, { envVar: value.envVar })
  }
  if (value.literal !== undefined) return value.literal
  throw remoteError('REMOTE_CONFIG_MISSING_BASE_URL', 'Remote base URL is required.', { operationId })
}

function resolveUrl(baseUrl: string, path: string, method: string, operationId: string | undefined): URL {
  try {
    return new URL(path, baseUrl)
  } catch (error) {
    throw remoteError('REMOTE_REQUEST_SERIALIZATION', 'Remote request URL is invalid.', {
      operationId,
      method,
    }, undefined, { cause: asError(error) })
  }
}

function validateBindFields<TInput>(
  bind: HttpOperationBind<TInput>,
  knownFields: Set<string> | undefined,
  operationId: string | undefined,
): void {
  if (!knownFields) return
  for (const field of bind.path ?? []) assertKnownField(field, knownFields, operationId)
  for (const field of bind.query ?? []) assertKnownField(field, knownFields, operationId)
  for (const field of Object.values(bind.headers ?? {})) assertKnownField(field, knownFields, operationId)
  const body = bind.body
  if (Array.isArray(body)) {
    for (const field of body) assertKnownField(field, knownFields, operationId)
  }
}

function assertKnownField(field: string, knownFields: Set<string>, operationId: string | undefined): void {
  if (knownFields.has(field)) return
  throw remoteError('REMOTE_BIND_UNKNOWN_FIELD', 'Remote request binding references an unknown input field.', {
    operationId,
  }, { field })
}

function replacePathParam(path: string, field: string, value: string): string {
  const pattern = new RegExp(`\\{${escapeRegExp(field)}\\}`, 'g')
  return path.replace(pattern, encodeURIComponent(value))
}

function appendQuery(url: URL, field: string, value: unknown, operationId: string | undefined): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      url.searchParams.append(field, serializeScalar(item, field, operationId))
    }
    return
  }
  url.searchParams.append(field, serializeScalar(value, field, operationId))
}

function serializeScalar(value: unknown, field: string, operationId: string | undefined): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  throw remoteError('REMOTE_REQUEST_SERIALIZATION', 'Remote request binding value must be a scalar.', {
    operationId,
  }, { field })
}

function markUsed(usedFields: Set<string>, field: string, placement: string, operationId: string | undefined): void {
  if (!usedFields.has(field)) {
    usedFields.add(field)
    return
  }
  throw remoteError('REMOTE_BIND_CONFLICT', 'Remote request binding places the same input in multiple locations.', {
    operationId,
  }, { field, placement })
}

function resolveBodyValue<TInput>(
  method: HttpMethod,
  input: Record<string, unknown>,
  bind: HttpOperationBind<TInput>,
  usedFields: Set<string>,
  operationId: string | undefined,
): unknown | undefined {
  if (bind.body === true) {
    const body: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(input)) {
      if (!usedFields.has(field) && value !== undefined) body[field] = value
    }
    return Object.keys(body).length > 0 ? body : undefined
  }

  if (Array.isArray(bind.body)) {
    const body: Record<string, unknown> = {}
    for (const field of bind.body) {
      if (usedFields.has(field)) {
        throw remoteError('REMOTE_BIND_CONFLICT', 'Remote request binding places the same input in multiple locations.', {
          operationId,
        }, { field, placement: 'body' })
      }
      const value = input[field]
      if (value !== undefined) body[field] = value
    }
    return Object.keys(body).length > 0 ? body : undefined
  }

  const hasInput = Object.values(input).some((value) => value !== undefined)
  if (JSON_METHODS_WITH_BODY.has(method) && hasInput) {
    throw remoteError('REMOTE_REQUEST_SERIALIZATION', 'Remote request body binding is required for this method.', {
      operationId,
      method,
    })
  }
  return undefined
}

function applyTransportAuth(
  headers: Headers,
  auth: HttpAuth,
  env: Record<string, string | undefined>,
  operationId: string | undefined,
  secrets: string[],
): void {
  if (auth.kind === 'none') return
  if (auth.kind === 'resolved') {
    const secret = auth.credential.secret.reveal()
    secrets.push(secret)
    applyAuth(headers, auth.credential)
    return
  }
  const value = env[auth.envVar]
  if (!value) {
    throw remoteError('REMOTE_CONFIG_MISSING_AUTH', 'Remote auth environment variable is not set.', {
      operationId,
    }, { envVar: auth.envVar })
  }
  secrets.push(value)
  if (auth.kind === 'bearer') {
    headers.set('authorization', `Bearer ${value}`)
    return
  }
  headers.set(auth.header, value)
}

function collectAuthSecrets(
  auth: HttpAuth | undefined,
  env: Record<string, string | undefined>,
  secrets: string[],
): void {
  if (!auth || auth.kind === 'none') return
  if (auth.kind === 'resolved') {
    secrets.push(auth.credential.secret.reveal())
    return
  }
  const value = env[auth.envVar]
  if (value) secrets.push(value)
}

function mapStatusError<TInput extends Record<string, unknown>, TOutput>(
  response: Response,
  text: string,
  request: SerializedHttpRequest,
  options: HttpOperationCall<TInput, TOutput>,
  secrets: string[],
  safeBodyBytes: number,
): LiliError {
  if (response.status === 401 && options.auth?.kind === 'resolved') {
    return authInvalid({ providerId: options.auth.credential.providerId, status: 401 })
  }
  if (
    response.status === 403 &&
    options.auth?.kind === 'resolved' &&
    options.requiredPermissions &&
    options.requiredPermissions.length > 0
  ) {
    return authPermissionDenied({
      providerId: options.auth.credential.providerId,
      requiredPermissions: [...options.requiredPermissions],
      status: 403,
    })
  }
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

async function readResponseText(
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

function parseResponseBody(
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

function safeUrl(url: string): string | undefined {
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

function remoteError(
  code: string,
  message: string,
  details?: RemoteErrorDetails | undefined,
  extra?: Record<string, unknown> | undefined,
  options?: { cause?: Error | undefined; retryable?: boolean | undefined } | undefined,
): LiliError {
  const mergedDetails = compactDetails(details, extra)
  return new LiliError({
    code,
    details: mergedDetails,
    message,
    retryable: options?.retryable,
    cause: options?.cause,
    exitCode: 1,
    ...remoteRecovery(code, mergedDetails, options),
  })
}

function remoteRecovery(
  code: string,
  details: Record<string, unknown> | undefined,
  options: { retryable?: boolean | undefined } | undefined,
): Pick<LiliError.Options, 'retry_after' | 'suggested_fix'> {
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

function asError(error: unknown): Error | undefined {
  return error instanceof Error ? error : undefined
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
