import { callHttpOperation, serializeHttpOperationRequest, z } from '@liche/core'
import type { HttpFetch, HttpOperationBind, HttpOperationCall, HttpOperationRequestSpec, Schema } from '@liche/core'
import { canonicalDigest } from '@liche/build'
import {
  normalizeProduct,
  resolveListShape,
  type Capability,
  type Catalog,
  type NormalizedHttpBind,
  type NormalizedHttpSpec,
  type NormalizedRuntimeValue,
  type NormalizedShape,
} from './catalog.js'
import type { RuntimeProduct } from './product.js'
import type { JsonSchemaNode } from './types.js'

export type ConformanceCase = {
  name: string
  capability: string
  argv?: readonly string[]
  input: Record<string, unknown>
  target?: {
    baseUrl?: string
    headers?: Record<string, string>
  }
  expectRequest?: {
    method: string
    path: string
    query?: Record<string, string | string[]>
    headers?: Record<string, string>
    body?: unknown
  }
  expectResponse?: {
    status?: number
    body?: unknown
  }
  safety?: {
    destructive: boolean
    requiresOptIn: boolean
    setup?: string
    teardown?: string
  }
}

export type ConformanceStatus = 'passed' | 'failed' | 'skipped'

export type ConformanceReportCase = {
  capability: string
  name: string
  status: ConformanceStatus
  reason?: string
  request?: {
    method: string
    url: string
    headers?: Record<string, string>
    bodyPreview?: string
  }
  response?: {
    status?: number
    contentType?: string
    bodyPreview?: string
  }
  errors: Array<{ code: string; message: string; path?: string }>
}

export type ConformanceReport = {
  reportVersion: 1
  catalog: {
    name: string
    version: string
    contractDigest: string
  }
  target: {
    baseUrl: string
    env?: string
  }
  run: {
    startedAt: string
    finishedAt: string
    durationMs: number
  }
  summary: {
    passed: number
    failed: number
    skipped: number
    total: number
  }
  cases: ConformanceReportCase[]
}

export type ConformProductOptions = {
  baseUrl?: string
  capability?: string
  env?: Record<string, string | undefined>
  fetch?: HttpFetch
  fixtures?: readonly ConformanceCase[]
  includeDestructive?: boolean
  now?: () => Date
}

type RunnableCapability = {
  cap: Capability
  http: NormalizedHttpSpec
  output: Schema
  inputFields: string[]
}

type PreparedCase = {
  fixture?: ConformanceCase
  input: Record<string, unknown>
  name: string
  runnable: RunnableCapability
}

export async function conformProduct(product: RuntimeProduct, options: ConformProductOptions = {}): Promise<ConformanceReport> {
  const catalog = normalizeProduct(product)
  const started = (options.now ?? (() => new Date()))()
  const startedAt = started.toISOString()
  const fixtures = options.fixtures ?? []
  const cases: ConformanceReportCase[] = []
  const capabilities = runnableCapabilities(catalog).filter((r) => matchesCapability(r.cap.id, options.capability))
  const byCapability = new Map<string, ConformanceCase[]>()
  for (const fixture of fixtures) {
    const bucket = byCapability.get(fixture.capability) ?? []
    bucket.push(fixture)
    byCapability.set(fixture.capability, bucket)
  }

  for (const runnable of capabilities) {
    const capFixtures = byCapability.get(runnable.cap.id) ?? []
    const prepared = prepareCases(runnable, capFixtures, options.includeDestructive === true)
    for (const item of prepared) {
      cases.push(await runCase(catalog, item, options))
    }
  }

  for (const [capability, unknownFixtures] of byCapability) {
    if (capabilities.some((r) => r.cap.id === capability)) continue
    for (const fixture of unknownFixtures) {
      cases.push({
        capability,
        name: fixture.name,
        status: 'failed',
        reason: 'Fixture references an unknown or non-HTTP conformance capability.',
        errors: [{ code: 'CONFORMANCE_UNKNOWN_CAPABILITY', message: `No HTTP-backed capability '${capability}' exists.` }],
      })
    }
  }

  const finished = (options.now ?? (() => new Date()))()
  const summary = {
    passed: cases.filter((c) => c.status === 'passed').length,
    failed: cases.filter((c) => c.status === 'failed').length,
    skipped: cases.filter((c) => c.status === 'skipped').length,
    total: cases.length,
  }
  return {
    reportVersion: 1,
    catalog: {
      name: catalog.product.id,
      version: catalog.product.version,
      contractDigest: canonicalDigest(catalog),
    },
    target: {
      baseUrl: options.baseUrl ?? resolveCatalogBaseUrl(catalog.remote?.baseUrl, options.env ?? {}) ?? '',
    },
    run: {
      startedAt,
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
    },
    summary,
    cases,
  }
}

function runnableCapabilities(catalog: Catalog): RunnableCapability[] {
  const out: RunnableCapability[] = []
  for (const cap of catalog.capabilities) {
    if (!cap.policy?.conformanceEligible) continue
    if (cap.kind === 'resource-operation' && cap.http) {
      out.push({
        cap,
        http: cap.http,
        output: schemaForShape(catalog, cap.output),
        inputFields: cap.input ? inputFieldNames(catalog, cap.input) : [],
      })
      continue
    }
    if (cap.kind === 'command' && cap.execution.mode === 'remote-http') {
      out.push({
        cap,
        http: cap.execution.http,
        output: cap.output ? schemaForShape(catalog, cap.output) : z.object({}),
        inputFields: cap.input ? inputFieldNames(catalog, cap.input) : [],
      })
    }
  }
  return out
}

function prepareCases(
  runnable: RunnableCapability,
  fixtures: readonly ConformanceCase[],
  includeDestructive: boolean,
): PreparedCase[] {
  if (isDestructive(runnable.cap) && !includeDestructive) {
    const skippedCase: PreparedCase = {
      input: {},
      name: `${runnable.cap.id} skipped`,
      runnable,
    }
    if (fixtures[0]) skippedCase.fixture = fixtures[0]
    return [skippedCase]
  }
  if (fixtures.length > 0) {
    return fixtures.map((fixture) => ({ fixture, input: fixture.input, name: fixture.name, runnable }))
  }
  if (runnable.inputFields.length > 0) {
    return [{
      input: {},
      name: `${runnable.cap.id} missing fixture`,
      runnable,
    }]
  }
  return [{
    input: {},
    name: runnable.cap.examples[0]?.summary ?? runnable.cap.examples[0]?.command ?? runnable.cap.id,
    runnable,
  }]
}

async function runCase(
  catalog: Catalog,
  item: PreparedCase,
  options: ConformProductOptions,
): Promise<ConformanceReportCase> {
  const { fixture, input, name, runnable } = item
  if (isDestructive(runnable.cap) && options.includeDestructive !== true) {
    return skipped(runnable.cap.id, name, 'Destructive or confirmation-required capability skipped without --include-destructive.')
  }
  if (!fixture && runnable.inputFields.length > 0) {
    return skipped(runnable.cap.id, name, 'Capability requires explicit input fixture.')
  }

  const baseUrl = fixture?.target?.baseUrl ?? options.baseUrl ?? resolveCatalogBaseUrl(catalog.remote?.baseUrl, options.env ?? {})
  if (!baseUrl) {
    return failed(runnable.cap.id, name, 'CONFORMANCE_MISSING_BASE_URL', 'Conformance target base URL is required.')
  }

  const requestSpec = requestFor(catalog, runnable, input, baseUrl, options.env ?? {})
  let serialized: ReturnType<typeof serializeHttpOperationRequest>
  try {
    serialized = serializeHttpOperationRequest(requestSpec)
    const mismatch = compareExpectedRequest(serialized, fixture?.expectRequest)
    if (mismatch) return failed(runnable.cap.id, name, 'CONFORMANCE_REQUEST_MISMATCH', mismatch, reportRequest(serialized))
  } catch (error) {
    return errorCase(runnable.cap.id, name, error, undefined)
  }

  let observedResponse: { status: number; contentType?: string; bodyPreview?: string } | undefined
  const fetcher: HttpFetch = async (inputUrl, init) => {
    const response = await (options.fetch ?? fetch)(inputUrl, init)
    const text = await response.clone().text()
    observedResponse = {
      status: response.status,
      bodyPreview: redact(text, secretValues(catalog, options.env ?? {})).slice(0, 4096),
    }
    const contentType = response.headers.get('content-type')
    if (contentType) observedResponse.contentType = contentType
    return response
  }

  try {
    const call: HttpOperationCall<Record<string, unknown>, unknown> = {
      ...requestSpec,
      fetch: fetcher,
      output: runnable.output,
      requiredPermissions: runnable.cap.requires.permissions,
    }
    const data = await callHttpOperation(call)
    const responseMismatch = fixture?.expectResponse?.body !== undefined &&
      JSON.stringify(data) !== JSON.stringify(fixture.expectResponse.body)
    if (responseMismatch) {
      return failed(
        runnable.cap.id,
        name,
        'CONFORMANCE_RESPONSE_MISMATCH',
        'Response body did not match fixture expectation.',
        reportRequest(serialized),
        observedResponse,
      )
    }
    const passed: ConformanceReportCase = {
      capability: runnable.cap.id,
      name,
      status: 'passed',
      request: reportRequest(serialized),
      errors: [],
    }
    if (observedResponse) passed.response = observedResponse
    return passed
  } catch (error) {
    return errorCase(runnable.cap.id, name, error, reportRequest(serialized), observedResponse)
  }
}

function requestFor(
  catalog: Catalog,
  runnable: RunnableCapability,
  input: Record<string, unknown>,
  baseUrl: string,
  env: Record<string, string | undefined>,
): HttpOperationRequestSpec<Record<string, unknown>> {
  return {
    id: runnable.cap.id,
    baseUrl,
    auth: transportAuth(catalog, runnable.cap, env),
    method: runnable.http.method,
    path: runnable.http.path,
    bind: httpBind(runnable.http.bind),
    input,
    inputFields: runnable.inputFields,
    env,
  }
}

function transportAuth(
  catalog: Catalog,
  cap: Capability,
  _env: Record<string, string | undefined>,
): HttpOperationRequestSpec<Record<string, unknown>>['auth'] {
  if (!cap.requires.auth || catalog.auth.kind === 'none') return { kind: 'none' }
  const source = catalog.auth.tokenSources.find((s) => s.kind === 'env')
  if (!source || source.kind !== 'env') return { kind: 'none' }
  if (catalog.auth.kind === 'apiKey') return { kind: 'apiKey', envVar: source.envVar, header: catalog.auth.header ?? 'x-api-key' }
  return { kind: 'bearer', envVar: source.envVar }
}

function httpBind(bind: NormalizedHttpBind): HttpOperationBind<Record<string, unknown>> {
  return {
    path: bind.path,
    query: bind.query,
    headers: bind.headers,
    body: bind.body,
  }
}

function schemaForShape(catalog: Catalog, shape: NormalizedShape): Schema {
  if (shape.kind === 'list') {
    const resolved = resolveListShape(catalog, shape)
    if (!resolved.ok) throw new Error(`Unknown list resource '${resolved.resourceId}'`)
    return z.array(schemaForJsonSchema(resolved.jsonSchema.items!))
  }
  return schemaForJsonSchema(shape.jsonSchema)
}

function schemaForJsonSchema(node: JsonSchemaNode): Schema {
  if (node.enum && Array.isArray(node.enum)) return z.enum(node.enum as [string, ...string[]])
  switch (node.type) {
    case 'string':
      return z.string()
    case 'number':
    case 'integer':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      if (!node.items) throw new Error('Array schema missing items')
      return z.array(schemaForJsonSchema(node.items))
    case 'object':
      return objectSchema(node)
    default:
      throw new Error(`Unsupported JSON Schema node in conformance: ${JSON.stringify(node).slice(0, 200)}`)
  }
}

function objectSchema(node: JsonSchemaNode): Schema {
  const required = new Set(node.required ?? [])
  const shape: Record<string, Schema> = {}
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    let schema = schemaForJsonSchema(child)
    if (child.default !== undefined) schema = schema.default(child.default)
    else if (!required.has(key)) schema = schema.optional()
    shape[key] = schema
  }
  return z.object(shape)
}

function inputFieldNames(catalog: Catalog, shape: NormalizedShape): string[] {
  if (shape.kind === 'list') {
    const resolved = resolveListShape(catalog, shape)
    if (!resolved.ok) return []
    return Object.keys(resolved.resource.fields).sort()
  }
  return Object.keys(shape.properties).sort()
}

function isDestructive(cap: Capability): boolean {
  return cap.policy?.dangerous === true || cap.policy?.requiresConfirmation === true
}

function matchesCapability(capability: string, pattern: string | undefined): boolean {
  if (!pattern) return true
  if (pattern.endsWith('*')) return capability.startsWith(pattern.slice(0, -1))
  return capability === pattern
}

function resolveCatalogBaseUrl(value: NormalizedRuntimeValue | undefined, env: Record<string, string | undefined>): string | undefined {
  if (!value) return undefined
  if (value.kind === 'literal') return value.value
  if (value.kind === 'env') return env[value.envVar] ?? value.fallback
  return undefined
}

function compareExpectedRequest(
  request: ReturnType<typeof serializeHttpOperationRequest>,
  expected: ConformanceCase['expectRequest'] | undefined,
): string | undefined {
  if (!expected) return undefined
  const url = new URL(request.url)
  if (expected.method.toUpperCase() !== request.method) return `Expected ${expected.method} but serialized ${request.method}.`
  if (expected.path !== url.pathname) return `Expected path ${expected.path} but serialized ${url.pathname}.`
  if (expected.query) {
    for (const [key, value] of Object.entries(expected.query)) {
      const actual = url.searchParams.getAll(key)
      const want = Array.isArray(value) ? value : [value]
      if (JSON.stringify(actual) !== JSON.stringify(want)) {
        return `Expected query ${key}=${JSON.stringify(want)} but serialized ${JSON.stringify(actual)}.`
      }
    }
  }
  if (expected.body !== undefined && request.body !== JSON.stringify(expected.body)) {
    return 'Serialized body did not match fixture expectation.'
  }
  return undefined
}

function reportRequest(request: ReturnType<typeof serializeHttpOperationRequest>): NonNullable<ConformanceReportCase['request']> {
  const out: NonNullable<ConformanceReportCase['request']> = {
    method: request.method,
    url: safeUrl(request.url),
    headers: safeHeaders(request.headers),
  }
  if (request.body) out.bodyPreview = redact(request.body, []).slice(0, 4096)
  return out
}

function safeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of headers) {
    out[key] = key.toLowerCase() === 'authorization' ? '[redacted]' : redact(value, [])
  }
  return out
}

function safeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return url
  }
}

function skipped(capability: string, name: string, reason: string): ConformanceReportCase {
  return { capability, name, status: 'skipped', reason, errors: [] }
}

function failed(
  capability: string,
  name: string,
  code: string,
  message: string,
  request?: ConformanceReportCase['request'],
  response?: ConformanceReportCase['response'],
): ConformanceReportCase {
  const out: ConformanceReportCase = {
    capability,
    name,
    status: 'failed',
    reason: message,
    errors: [{ code, message }],
  }
  if (request) out.request = request
  if (response) out.response = response
  return out
}

function errorCase(
  capability: string,
  name: string,
  error: unknown,
  request?: ConformanceReportCase['request'],
  response?: ConformanceReportCase['response'],
): ConformanceReportCase {
  const e = error as { code?: string; message?: string; fieldErrors?: Array<{ path: string; message: string }> }
  const out: ConformanceReportCase = {
    capability,
    name,
    status: 'failed',
    reason: e.message ?? String(error),
    errors: e.fieldErrors?.map((field) => ({ code: e.code ?? 'CONFORMANCE_ERROR', message: field.message, path: field.path })) ?? [{
      code: e.code ?? 'CONFORMANCE_ERROR',
      message: e.message ?? String(error),
    }],
  }
  if (request) out.request = request
  if (response) out.response = response
  return out
}

function secretValues(catalog: Catalog, env: Record<string, string | undefined>): string[] {
  if (catalog.auth.kind === 'none') return []
  return catalog.auth.tokenSources.flatMap((source) => {
    if (source.kind !== 'env') return []
    const value = env[source.envVar]
    return value ? [value] : []
  })
}

function redact(value: string, secrets: readonly string[]): string {
  let out = value
  for (const secret of secrets) out = out.split(secret).join('[redacted]')
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]')
  out = out.replace(/(["']?(?:api[_-]?key|token|secret)["']?\s*[:=]\s*["'])[^"',\s]+(["'])?/gi, '$1[redacted]$2')
  return out
}
