import { z } from '@liche/core'
import type { Schema } from '@liche/core'
import { serializeHttpOperationRequest } from '@liche/http'
import type { HttpOperationBind, HttpOperationRequestSpec } from '@liche/http'
import { resolveListShape } from '../catalog/shape.js'
import type {
  Capability,
  Catalog,
  NormalizedHttpBind,
  NormalizedRuntimeValue,
  NormalizedShape,
} from '../catalog/types.js'
import type { JsonSchemaNode } from '../types.js'
import { redact } from './redact.js'
import type { ConformanceCase, ConformanceReportCase, RunnableCapability } from './types.js'

export function runnableCapabilities(catalog: Catalog): RunnableCapability[] {
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

export function requestFor(
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
  if (catalog.auth.kind === 'apiKey')
    return { kind: 'apiKey', envVar: source.envVar, header: catalog.auth.header ?? 'x-api-key' }
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

export function isDestructive(cap: Capability): boolean {
  return cap.policy?.dangerous === true || cap.policy?.requiresConfirmation === true
}

export function matchesCapability(capability: string, pattern: string | undefined): boolean {
  if (!pattern) return true
  if (pattern.endsWith('*')) return capability.startsWith(pattern.slice(0, -1))
  return capability === pattern
}

export function resolveCatalogBaseUrl(
  value: NormalizedRuntimeValue | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  if (!value) return undefined
  if (value.kind === 'literal') return value.value
  if (value.kind === 'env') return env[value.envVar] ?? value.fallback
  return undefined
}

export function compareExpectedRequest(
  request: ReturnType<typeof serializeHttpOperationRequest>,
  expected: ConformanceCase['expectRequest'] | undefined,
): string | undefined {
  if (!expected) return undefined
  const url = new URL(request.url)
  if (expected.method.toUpperCase() !== request.method)
    return `Expected ${expected.method} but serialized ${request.method}.`
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

export function reportRequest(
  request: ReturnType<typeof serializeHttpOperationRequest>,
): NonNullable<ConformanceReportCase['request']> {
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
