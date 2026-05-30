import { ValidationError, parseSchemaAsync } from '@liche/core'
import { serializeHttpOperationRequest } from './binding.js'
import { asError, isAbortError, remoteError, safeUrl } from './errors.js'
import { mapStatusError, parseResponseBody, readResponseText } from './response.js'
import { collectAuthSecrets } from './transport-auth.js'
import type { HttpFetch, HttpOperationCall } from './types.js'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_SAFE_BODY_BYTES = 4096

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
  const timer =
    timeoutMs >= 0
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
      throw remoteError(
        'REMOTE_TIMEOUT',
        'Remote request timed out.',
        {
          operationId: options.id,
          method: request.method,
          url: safeUrl(request.url),
        },
        undefined,
        { cause: asError(error), retryable: true },
      )
    }
    throw remoteError(
      'REMOTE_NETWORK',
      'Remote request failed before receiving a response.',
      {
        operationId: options.id,
        method: request.method,
        url: safeUrl(request.url),
      },
      undefined,
      { cause: asError(error), retryable: true },
    )
  } finally {
    if (timer) clearTimeout(timer)
  }

  const text = await readResponseText(response, request, options.id)
  if (!response.ok) {
    throw mapStatusError(response, text, request, options, secrets, safeBodyBytes)
  }

  const parsed = parseResponseBody(response, text, request, options.id)
  try {
    return (await parseSchemaAsync(options.output, parsed, parsed)) as TOutput
  } catch (error) {
    if (error instanceof ValidationError) {
      throw remoteError(
        'REMOTE_RESPONSE_SCHEMA',
        'Remote response did not match the expected schema.',
        {
          operationId: options.id,
          method: request.method,
          url: safeUrl(request.url),
          validation: error.fieldErrors.map(({ path, message }) => ({ path, message })),
        },
        undefined,
        { cause: error },
      )
    }
    throw error
  }
}
