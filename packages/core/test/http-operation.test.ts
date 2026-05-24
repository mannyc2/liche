import { describe, expect, test } from 'bun:test'
import {
  callHttpOperation,
  secret,
  serializeHttpOperationRequest,
  z,
} from '../src/index.js'
import type { AuthCredential } from '../src/index.js'
import { LicheError } from '../src/errors/error.js'

function expectLicheError(fn: () => unknown, code: string): LicheError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(LicheError)
    expect((error as LicheError).code).toBe(code)
    return error as LicheError
  }
  throw new Error(`Expected ${code}`)
}

async function expectRejectedLicheError(promise: Promise<unknown>, code: string): Promise<LicheError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(LicheError)
    expect((error as LicheError).code).toBe(code)
    return error as LicheError
  }
  throw new Error(`Expected ${code}`)
}

describe('HTTP operation transport', () => {
  test('serializes path, repeated query values, scalar headers, and JSON body', () => {
    const request = serializeHttpOperationRequest({
      id: 'projects.deploy',
      baseUrl: 'https://api.example.test',
      method: 'POST',
      path: '/projects/{projectId}/deploy',
      inputFields: ['projectId', 'dryRun', 'tag', 'empty', 'count', 'region', 'payload', 'skipped'],
      bind: {
        path: ['projectId'],
        query: ['dryRun', 'tag', 'empty', 'count'],
        headers: { 'x-region': 'region' },
        body: true,
      },
      input: {
        projectId: 'acme/foo',
        dryRun: false,
        tag: ['one', 'two'],
        empty: '',
        count: 0,
        region: 'us',
        payload: { mode: 'fast' },
        skipped: undefined,
      },
    })

    expect(request.method).toBe('POST')
    expect(request.url).toBe(
      'https://api.example.test/projects/acme%2Ffoo/deploy?dryRun=false&tag=one&tag=two&empty=&count=0',
    )
    expect(request.headers.get('accept')).toBe('application/json')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(request.headers.get('x-region')).toBe('us')
    expect(request.body).toBe(JSON.stringify({ payload: { mode: 'fast' } }))
  })

  test('fails missing base URL, invalid base URL, and missing auth with structured errors', () => {
    const missingBaseUrl = expectLicheError(() => serializeHttpOperationRequest({
      baseUrl: { envVar: 'ACME_API_URL' },
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
    }), 'REMOTE_CONFIG_MISSING_BASE_URL')
    expect(missingBaseUrl.suggested_fix).toBe('Set ACME_API_URL to the remote API base URL before retrying.')

    expectLicheError(() => serializeHttpOperationRequest({
      baseUrl: 'not a url',
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
    }), 'REMOTE_CONFIG_INVALID_BASE_URL')

    expectLicheError(() => serializeHttpOperationRequest({
      baseUrl: 'https://api.example.test',
      auth: { kind: 'bearer', envVar: 'ACME_TOKEN' },
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
    }), 'REMOTE_CONFIG_MISSING_AUTH')
  })

  test('fails path, unknown field, conflict, and body binding errors before fetch', () => {
    expectLicheError(() => serializeHttpOperationRequest({
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/projects/{projectId}',
      bind: { path: ['projectId'] },
      input: { projectId: undefined },
    }), 'REMOTE_BIND_MISSING_PATH_PARAM')

    expectLicheError(() => serializeHttpOperationRequest<Record<string, unknown>>({
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/projects',
      inputFields: ['projectId'],
      bind: { query: ['missing'] },
      input: { projectId: 'p1' },
    }), 'REMOTE_BIND_UNKNOWN_FIELD')

    expectLicheError(() => serializeHttpOperationRequest({
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/projects/{projectId}',
      bind: { path: ['projectId'], query: ['projectId'] },
      input: { projectId: 'p1' },
    }), 'REMOTE_BIND_CONFLICT')

    expectLicheError(() => serializeHttpOperationRequest({
      baseUrl: 'https://api.example.test',
      method: 'POST',
      path: '/projects',
      bind: {},
      input: { name: 'demo' },
    }), 'REMOTE_REQUEST_SERIALIZATION')
  })

  test('calls fetch, parses JSON, and validates output schema', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const result = await callHttpOperation({
      id: 'projects.get',
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/projects/{projectId}',
      bind: { path: ['projectId'] },
      input: { projectId: 'p1' },
      output: z.object({ id: z.string(), ok: z.boolean() }),
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(JSON.stringify({ id: 'p1', ok: true }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    expect(result).toEqual({ id: 'p1', ok: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.example.test/projects/p1')
    expect(calls[0]?.init.method).toBe('GET')
  })

  test('maps network failures and timeouts to retryable remote errors', async () => {
    const network = await expectRejectedLicheError(callHttpOperation({
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
      output: z.object({ ok: z.boolean() }),
      fetch: async () => {
        throw new Error('ECONNRESET')
      },
    }), 'REMOTE_NETWORK')
    expect(network.retryable).toBe(true)
    expect(network.retry_after).toBe(5)
    expect(network.suggested_fix).toContain('retry')

    const timeout = await expectRejectedLicheError(callHttpOperation({
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
      output: z.object({ ok: z.boolean() }),
      timeoutMs: 1,
      fetch: (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        })
      }),
    }), 'REMOTE_TIMEOUT')
    expect(timeout.retryable).toBe(true)
    expect(timeout.retry_after).toBe(5)
  })

  test('maps non-2xx responses to structured HTTP errors with sanitized body preview', async () => {
    const error = await expectRejectedLicheError(callHttpOperation({
      baseUrl: 'https://api.example.test',
      auth: { kind: 'bearer', envVar: 'ACME_TOKEN' },
      env: { ACME_TOKEN: 'secret-token' },
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
      output: z.object({ ok: z.boolean() }),
      safeBodyBytes: 80,
      fetch: async () => new Response('token=secret-token and more detail', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'x-request-id': 'req_123' },
      }),
    }), 'REMOTE_HTTP_STATUS')

    expect(error.details).toMatchObject({
      method: 'GET',
      requestId: 'req_123',
      status: 500,
      statusText: 'Internal Server Error',
      url: 'https://api.example.test/status',
    })
    expect(error.retry_after).toBe(5)
    expect(error.suggested_fix).toContain('remote service recovers')
    expect(String(error.details?.['bodyPreview'])).not.toContain('secret-token')
  })

  test('maps unsupported, malformed, and schema-invalid success bodies', async () => {
    await expectRejectedLicheError(callHttpOperation({
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
      output: z.object({ ok: z.boolean() }),
      fetch: async () => new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    }), 'REMOTE_RESPONSE_UNSUPPORTED_CONTENT_TYPE')

    await expectRejectedLicheError(callHttpOperation({
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
      output: z.object({ ok: z.boolean() }),
      fetch: async () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    }), 'REMOTE_RESPONSE_MALFORMED')

    const schema = await expectRejectedLicheError(callHttpOperation({
      baseUrl: 'https://api.example.test',
      method: 'GET',
      path: '/status',
      bind: {},
      input: {},
      output: z.object({ ok: z.boolean() }),
      fetch: async () => new Response(JSON.stringify({ ok: 'yes' }), {
        headers: { 'content-type': 'application/json' },
      }),
    }), 'REMOTE_RESPONSE_SCHEMA')
    expect(schema.details?.['validation']).toEqual([
      expect.objectContaining({ path: '$.ok' }),
    ])
  })

  test('maps 401 with resolved auth through auth error semantics', async () => {
    const credential: AuthCredential = {
      providerId: 'acme',
      source: 'env',
      kind: 'bearer',
      secret: secret('bad-token'),
      refreshAvailable: false,
    }

    await expectRejectedLicheError(callHttpOperation({
      baseUrl: 'https://api.example.test',
      auth: { kind: 'resolved', credential },
      method: 'GET',
      path: '/me',
      bind: {},
      input: {},
      output: z.object({ id: z.string() }),
      fetch: async () => new Response('unauthorized', { status: 401 }),
    }), 'AUTH_INVALID')
  })
})
