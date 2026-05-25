import { fieldToJsonSchema } from '../catalog/shape.js'
import { resolveListShape } from '../catalog/shape.js'
import type {
  Capability,
  Catalog,
  NormalizedResource,
  NormalizedShape,
  ResourceOperationCapability,
} from '../catalog/types.js'
import type { NormalizedField } from '../schema/field.js'
import type { JsonSchemaNode } from '../types.js'
import { objectFieldsToJsonSchema, objectInputProperties, sortRecord } from './surface-utils.js'

export type GenerateOpenapiOptions = {
  generatorVersion: string
  canonicalIrDigest: string
  generationOptionsDigest: string
  surfaceId?: string
}

export function generateOpenapi(catalog: Catalog, options: GenerateOpenapiOptions): string {
  const eligible = catalog.capabilities
    .filter(isOpenapiEligible)
    .slice()
    .sort(compareCapabilitiesForOutput)

  const referencedResources = new Set<string>()
  const paths: Record<string, Record<string, unknown>> = {}

  for (const cap of eligible) {
    const resource = findResource(catalog, cap.resourceId)
    const fullPath = composePath(resource.path, cap.http!.path)
    const method = cap.http!.method.toLowerCase()
    const operation = renderOperation(catalog, cap, referencedResources)
    const byMethod = paths[fullPath] ?? {}
    byMethod[method] = operation
    paths[fullPath] = byMethod
  }

  const componentSchemas: Record<string, JsonSchemaNode> = {}
  for (const resourceId of [...referencedResources].sort()) {
    const resource = findResource(catalog, resourceId)
    componentSchemas[resourceId] = objectFieldsToJsonSchema(resource.fields)
  }

  const info: Record<string, unknown> = {
    title: catalog.product.name,
    version: catalog.product.version,
  }
  if (catalog.product.description) info.description = catalog.product.description
  info['x-liche-generator-version'] = options.generatorVersion
  info['x-liche-catalog-digest'] = options.canonicalIrDigest
  info['x-liche-generation-options-digest'] = options.generationOptionsDigest
  info['x-liche-surface-id'] = options.surfaceId ?? 'openapi'

  const document = {
    openapi: '3.1.0',
    info,
    paths: sortRecord(paths),
    components: { schemas: sortRecord(componentSchemas) },
  }

  return `${JSON.stringify(document, null, 2)}\n`
}

function isOpenapiEligible(cap: Capability): cap is ResourceOperationCapability {
  return cap.kind === 'resource-operation' && cap.surfaces.openapi === true && cap.http !== undefined
}

function compareCapabilitiesForOutput(
  a: ResourceOperationCapability,
  b: ResourceOperationCapability,
): number {
  const pa = a.http!.path
  const pb = b.http!.path
  if (pa !== pb) return pa < pb ? -1 : 1
  return a.http!.method < b.http!.method ? -1 : a.http!.method > b.http!.method ? 1 : 0
}

function findResource(catalog: Catalog, resourceId: string): NormalizedResource {
  const resource = catalog.resources.find((r) => r.id === resourceId)
  if (!resource) {
    throw new Error(
      `OpenAPI generator cannot locate resource '${resourceId}' referenced by a capability`,
    )
  }
  return resource
}

function composePath(resourcePath: string, opPath: string): string {
  const left = resourcePath.endsWith('/') ? resourcePath.slice(0, -1) : resourcePath
  if (!opPath) return left || '/'
  const right = opPath.startsWith('/') ? opPath : `/${opPath}`
  return `${left}${right}` || '/'
}

function renderOperation(
  catalog: Catalog,
  cap: ResourceOperationCapability,
  referencedResources: Set<string>,
): Record<string, unknown> {
  const operation: Record<string, unknown> = {
    operationId: cap.id,
    summary: cap.summary,
  }
  if (cap.description) operation.description = cap.description
  operation.tags = [cap.resourceId]

  const parameters = renderParameters(cap)
  if (parameters.length > 0) operation.parameters = parameters

  const requestBody = renderRequestBody(cap)
  if (requestBody) operation.requestBody = requestBody

  operation.responses = renderResponses(catalog, cap, referencedResources)

  return operation
}

function renderParameters(cap: ResourceOperationCapability): unknown[] {
  const out: Array<{ name: string; sortKey: string; value: Record<string, unknown> }> = []
  const inputProps = objectInputProperties(cap.input)
  const http = cap.http!

  for (const name of http.bind.path) {
    const field = inputProps[name]
    out.push({
      name,
      sortKey: `0:${name}`,
      value: {
        name,
        in: 'path',
        required: true,
        schema: field ? fieldToJsonSchema(field) : { type: 'string' },
      },
    })
  }

  for (const name of http.bind.query) {
    const field = inputProps[name]
    const required = field ? field.required : false
    const param: Record<string, unknown> = {
      name,
      in: 'query',
      schema: field ? fieldToJsonSchema(field) : { type: 'string' },
    }
    if (required) param.required = true
    out.push({ name, sortKey: `1:${name}`, value: param })
  }

  for (const name of Object.keys(http.bind.headers).sort()) {
    const value = http.bind.headers[name]!
    out.push({
      name,
      sortKey: `2:${name}`,
      value: {
        name,
        in: 'header',
        required: true,
        schema: { type: 'string', const: value },
      },
    })
  }

  return out.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0)).map(
    (p) => p.value,
  )
}

function renderRequestBody(cap: ResourceOperationCapability): Record<string, unknown> | undefined {
  const http = cap.http!
  if (http.bind.body === false) return undefined
  const inputProps = objectInputProperties(cap.input)
  if (Object.keys(inputProps).length === 0) return undefined

  const consumed = new Set<string>([...http.bind.path, ...http.bind.query])
  let fieldNames: string[]
  if (http.bind.body === true) {
    fieldNames = Object.keys(inputProps).filter((k) => !consumed.has(k))
  } else {
    fieldNames = [...http.bind.body].filter((k) => !consumed.has(k))
  }
  if (fieldNames.length === 0) return undefined

  const subset: Record<string, NormalizedField> = {}
  for (const name of fieldNames) {
    const field = inputProps[name]
    if (!field) {
      throw new Error(
        `OpenAPI generator: body field '${name}' on capability '${cap.id}' is not declared in its input shape`,
      )
    }
    subset[name] = field
  }
  const schema = objectFieldsToJsonSchema(subset)
  const required = Object.values(subset).some((f) => f.required)

  const body: Record<string, unknown> = {
    content: { 'application/json': { schema } },
  }
  if (required) body.required = true
  return body
}

function renderResponses(
  catalog: Catalog,
  cap: ResourceOperationCapability,
  referencedResources: Set<string>,
): Record<string, unknown> {
  const ok: Record<string, unknown> = { description: 'Successful response' }
  const outputSchema = projectOutputSchema(catalog, cap.output, referencedResources)
  if (outputSchema) ok.content = { 'application/json': { schema: outputSchema } }

  const errorSchema: JsonSchemaNode = {
    type: 'object',
    properties: { error: { type: 'string' } },
    required: ['error'],
  }
  return {
    '200': ok,
    default: {
      description: 'Unexpected error',
      content: { 'application/json': { schema: errorSchema } },
    },
  }
}

function projectOutputSchema(
  catalog: Catalog,
  shape: NormalizedShape,
  referencedResources: Set<string>,
): unknown {
  if (shape.kind === 'object') return shape.jsonSchema
  const resolved = resolveListShape(catalog, shape)
  if (!resolved.ok) {
    throw new Error(
      `OpenAPI generator cannot render list shape: resource '${resolved.resourceId}' is not declared in this catalog`,
    )
  }
  referencedResources.add(resolved.resource.id)
  return {
    type: 'array',
    items: { $ref: `#/components/schemas/${resolved.resource.id}` },
  }
}
