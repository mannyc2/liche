import type { FieldBuilder, NormalizedField } from '../schema/field.js'
import type { ListShape, ObjectShape, Shape } from '../schema/shape.js'
import type { JsonSchemaNode } from '../types.js'
import type {
  Catalog,
  NormalizedListShape,
  NormalizedObjectShape,
  NormalizedResource,
  NormalizedShape,
} from './types.js'

export function normalizeShape(shape: Shape): NormalizedShape {
  if (shape.kind === 'list') return normalizeListShape(shape)
  return normalizeObjectShape(shape)
}

function normalizeListShape(shape: ListShape): NormalizedListShape {
  return { kind: 'list', resourceId: shape.resourceId }
}

function normalizeObjectShape(shape: ObjectShape): NormalizedObjectShape {
  const properties = normalizeFieldMap(shape.properties)
  return { kind: 'object', properties, jsonSchema: objectShapeToJsonSchema(properties) }
}

export function normalizeFieldMap(fields: Readonly<Record<string, FieldBuilder>>): Record<string, NormalizedField> {
  const out: Record<string, NormalizedField> = {}
  for (const key of Object.keys(fields)) {
    out[key] = fields[key]!.toField()
  }
  return out
}

function objectShapeToJsonSchema(properties: Record<string, NormalizedField>): JsonSchemaNode {
  const keys = Object.keys(properties)
  const required: string[] = []
  const props: Record<string, JsonSchemaNode> = {}
  for (const key of keys) {
    const f = properties[key]!
    props[key] = fieldToJsonSchema(f)
    if (f.required) required.push(key)
  }
  const node: JsonSchemaNode = { type: 'object', properties: props }
  if (required.length > 0) node.required = [...required].sort()
  return node
}

export function fieldToJsonSchema(field: NormalizedField): JsonSchemaNode {
  const base: Record<string, unknown> = {}
  switch (field.type) {
    case 'string':
      base.type = 'string'
      break
    case 'int':
      base.type = 'integer'
      break
    case 'bool':
      base.type = 'boolean'
      break
    case 'uuid':
      base.type = 'string'
      base.format = 'uuid'
      break
    case 'hostname':
      base.type = 'string'
      base.format = 'hostname'
      break
    case 'datetime':
      base.type = 'string'
      base.format = 'date-time'
      break
    case 'enum':
      base.type = 'string'
      if (field.values) base.enum = [...field.values]
      break
  }
  if (field.description) base.description = field.description
  if (field.default !== undefined) base.default = field.default
  if (field.configPath !== undefined) base['x-liche-config-path'] = field.configPath
  if (field.secret) base['x-liche-secret'] = true
  if (field.identifier) base['x-liche-identifier'] = true
  if (field.humanLabel) base['x-liche-human-label'] = true
  if (field.mutability !== 'mutable') base['x-liche-mutability'] = field.mutability
  return base
}

export type ResolvedListShape =
  | { ok: true; resource: NormalizedResource; jsonSchema: JsonSchemaNode }
  | { ok: false; resourceId: string }

export function resolveListShape(catalog: Catalog, shape: NormalizedListShape): ResolvedListShape {
  const resource = catalog.resources.find((r) => r.id === shape.resourceId)
  if (!resource) return { ok: false, resourceId: shape.resourceId }
  const itemSchema = objectShapeToJsonSchema(resource.fields)
  return {
    ok: true,
    resource,
    jsonSchema: { type: 'array', items: itemSchema },
  }
}
