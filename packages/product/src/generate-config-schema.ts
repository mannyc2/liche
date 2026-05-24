import type { Catalog } from './catalog.js'
import { jsonArtifact } from './generate-surface-utils.js'
import type { JsonSchemaNode } from './types.js'

export type GenerateConfigSchemaOptions = {
  generatorVersion: string
  canonicalCatalogDigest: string
  surfaceId?: string
}

export function shouldGenerateConfigSchema(catalog: Catalog): boolean {
  return catalog.bindings.length > 0 || catalog.config !== undefined
}

export function generateConfigSchema(
  catalog: Catalog,
  options: GenerateConfigSchemaOptions,
): string {
  const properties: Record<string, JsonSchemaNode> = {}
  const required = new Set<string>()
  if (catalog.config) {
    for (const [key, node] of Object.entries(catalog.config.fields.jsonSchema.properties ?? {})) {
      properties[key] = node
    }
    for (const key of catalog.config.fields.jsonSchema.required ?? []) required.add(key)
  }
  for (const binding of catalog.bindings) {
    const node: JsonSchemaNode = {
      type: 'array',
      items: binding.fields.jsonSchema,
    }
    if (binding.doc) node.description = binding.doc
    properties[binding.key] = node
  }
  const requiredList = [...required].sort()

  return jsonArtifact({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `liche://${catalog.product.id}/config.schema.json`,
    title: `${catalog.product.name} config`,
    type: 'object',
    additionalProperties: false,
    properties,
    ...(requiredList.length > 0 ? { required: requiredList } : undefined),
    'x-liche-manifest-version': 'liche.config-schema.v1',
    'x-liche-product': catalog.product,
    'x-liche-catalog-digest': options.canonicalCatalogDigest,
    'x-liche-generator-version': options.generatorVersion,
    'x-liche-surface-id': options.surfaceId ?? 'config-schema',
  })
}
