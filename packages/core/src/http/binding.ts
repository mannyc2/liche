import { escapeRegExp, asError, remoteError } from './errors.js'
import { applyTransportAuth } from './transport-auth.js'
import type {
  HttpMethod,
  HttpOperationBind,
  HttpOperationRequestSpec,
  RuntimeValue,
  SerializedHttpRequest,
} from './types.js'

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
