import { callHttpOperation, serializeHttpOperationRequest } from '@liche/core'
import type { HttpFetch, HttpOperationCall } from '@liche/core'
import { canonicalDigest } from '@liche/build'
import { normalizeProduct } from '../catalog/normalize.js'
import type { Catalog } from '../catalog/types.js'
import type { RuntimeProduct } from '../product/types.js'
import {
  compareExpectedRequest,
  isDestructive,
  matchesCapability,
  reportRequest,
  requestFor,
  resolveCatalogBaseUrl,
  runnableCapabilities,
} from './http.js'
import { redact, secretValues } from './redact.js'
import type {
  ConformProductOptions,
  ConformanceCase,
  ConformanceReport,
  ConformanceReportCase,
  PreparedCase,
  RunnableCapability,
} from './types.js'

export async function conformProduct(
  product: RuntimeProduct,
  options: ConformProductOptions = {},
): Promise<ConformanceReport> {
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
