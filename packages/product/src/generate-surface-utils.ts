import {
  resolveListShape,
  type Capability,
  type Catalog,
  type CommandCapability,
  type NormalizedPermission,
  type NormalizedShape,
  type ResourceOperationCapability,
} from './catalog.js'
import type { JsonSchemaNode } from './types.js'

export type SurfaceAuthMetadata = {
  required: boolean
  status: 'requires-runtime-resolution' | 'not-required'
  providerId?: string
  envVars?: string[]
  contexts?: Array<{ id: string; flag?: string; envVar?: string }>
  requiredPermissions?: string[]
  requiredScopes?: string[]
}

export function jsonArtifact(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function commandName(capability: Capability): string {
  return capability.command.join(' ')
}

export function toolName(capability: Capability): string {
  return commandName(capability).replace(/\s+/g, '_')
}

export function capabilityInputSchema(catalog: Catalog, cap: Capability): JsonSchemaNode {
  const base = cap.input
    ? shapeToJsonSchema(catalog, cap.input)
    : ({ type: 'object', properties: {} } as JsonSchemaNode)
  if (cap.requires.contexts.length === 0) return cloneSchema(base)

  const properties: Record<string, JsonSchemaNode> = { ...(base.properties ?? {}) }
  const required = new Set(base.required ?? [])
  for (const ctxId of cap.requires.contexts) {
    const ctx = catalog.contexts.find((c) => c.id === ctxId)
    if (!ctx?.select.flag) continue
    if (properties[ctx.select.flag]) continue
    const node: JsonSchemaNode = { type: 'string' }
    if (ctx.label) node.description = ctx.label
    properties[ctx.select.flag] = node
  }

  const out: JsonSchemaNode = { type: 'object', properties }
  if (required.size > 0) out.required = [...required].sort()
  return out
}

export function capabilityOutputSchema(catalog: Catalog, cap: Capability): JsonSchemaNode {
  if (cap.kind === 'resource-operation') return shapeToJsonSchema(catalog, cap.output)
  if (cap.output) return shapeToJsonSchema(catalog, cap.output)
  return { type: 'object', properties: {} }
}

export function capabilityEnvSchema(catalog: Catalog, cap: Capability): JsonSchemaNode | undefined {
  const envVars = new Set<string>()
  if (cap.requires.auth && catalog.auth.kind !== 'none') {
    for (const source of catalog.auth.tokenSources) {
      if (source.kind === 'env') envVars.add(source.envVar)
    }
  }
  for (const ctxId of cap.requires.contexts) {
    const ctx = catalog.contexts.find((c) => c.id === ctxId)
    if (ctx?.select.env) envVars.add(ctx.select.env)
  }
  if (envVars.size === 0) return undefined
  const properties: Record<string, JsonSchemaNode> = {}
  for (const envVar of [...envVars].sort()) properties[envVar] = { type: 'string' }
  return { type: 'object', properties }
}

export function capabilityAuthMetadata(catalog: Catalog, cap: Capability): SurfaceAuthMetadata | undefined {
  if (!cap.requires.auth && cap.requires.contexts.length === 0 && cap.requires.permissions.length === 0) {
    return undefined
  }

  const out: SurfaceAuthMetadata = {
    required: cap.requires.auth,
    status: cap.requires.auth || cap.requires.contexts.length > 0
      ? 'requires-runtime-resolution'
      : 'not-required',
  }
  if (cap.requires.auth && catalog.auth.kind !== 'none') {
    out.providerId = catalog.auth.id
    out.envVars = catalog.auth.tokenSources.flatMap((source) => source.kind === 'env' ? [source.envVar] : [])
  }
  if (cap.requires.contexts.length > 0) {
    out.contexts = cap.requires.contexts.map((ctxId) => {
      const ctx = catalog.contexts.find((c) => c.id === ctxId)
      const entry: { id: string; flag?: string; envVar?: string } = { id: ctxId }
      if (ctx?.select.flag) entry.flag = ctx.select.flag
      if (ctx?.select.env) entry.envVar = ctx.select.env
      return entry
    })
  }
  if (cap.requires.permissions.length > 0) out.requiredPermissions = [...cap.requires.permissions]
  const requiredScopes = requiredScopesFor(catalog.permissions, cap)
  if (requiredScopes.length > 0) out.requiredScopes = requiredScopes
  return out
}

export function commandExecution(cap: Capability): Record<string, unknown> {
  if (cap.kind === 'resource-operation') return resourceExecution(cap)
  return commandCapabilityExecution(cap)
}

export function schemaSummary(schema: JsonSchemaNode): Record<string, string> {
  const properties = schema.properties ?? {}
  const out: Record<string, string> = {}
  for (const key of Object.keys(properties).sort()) {
    const prop = properties[key]!
    out[key] = prop.description ?? prop.type ?? 'value'
  }
  return out
}

export function shapeToJsonSchema(catalog: Catalog, shape: NormalizedShape): JsonSchemaNode {
  if (shape.kind === 'object') return cloneSchema(shape.jsonSchema)
  const resolved = resolveListShape(catalog, shape)
  if (!resolved.ok) {
    throw new Error(
      `Generator cannot render list shape: resource '${resolved.resourceId}' is not declared in this catalog`,
    )
  }
  return cloneSchema(resolved.jsonSchema)
}

function resourceExecution(cap: ResourceOperationCapability): Record<string, unknown> {
  const out: Record<string, unknown> = {
    mode: cap.http ? 'remote-http' : 'unbound-resource-operation',
  }
  if (cap.http) out.http = cap.http
  return out
}

function commandCapabilityExecution(cap: CommandCapability): Record<string, unknown> {
  if (cap.execution.mode === 'local') {
    return { mode: 'local', needs: cap.execution.needs }
  }
  if (cap.execution.mode === 'remote-http') {
    return { mode: 'remote-http', http: cap.execution.http }
  }
  const out: Record<string, unknown> = {
    mode: 'hybrid-workflow',
    steps: cap.execution.steps,
  }
  if (cap.execution.http) out.http = cap.execution.http
  return out
}

function requiredScopesFor(permissions: NormalizedPermission[], cap: Capability): string[] {
  const byId = new Map(permissions.map((permission) => [permission.id, permission]))
  return cap.requires.permissions.flatMap((id) => {
    const scope = byId.get(id)?.scope
    return scope ? [scope] : []
  })
}

function cloneSchema(schema: JsonSchemaNode): JsonSchemaNode {
  return JSON.parse(JSON.stringify(schema)) as JsonSchemaNode
}
