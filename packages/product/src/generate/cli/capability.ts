import { resolveListShape } from '../../catalog/shape.js'
import type {
  Capability,
  Catalog,
  NormalizedRuntimeValue,
  NormalizedShape,
  ResourceOperationCapability,
} from '../../catalog/types.js'
import type { JsonSchemaNode } from '../../types.js'
import {
  renderAuthCapability,
  renderAuthPreamble,
  requiredScopesFor,
} from './auth.js'
import { parseHandler } from './imports.js'
import {
  capabilityHasAuthMetadata,
  hasHttpTransport,
  isAuthCommand,
  missingRemoteError,
  neededContexts,
  needsAuthExtension,
  needsMcpServer,
  needsTokens,
  needsAuthResolution,
} from './predicates.js'
import {
  q,
  renderEffects,
  renderExamples,
  renderHttpBind,
  renderPolicy,
  renderRuntimeValue,
  renderSafety,
  renderSchema,
  renderStringArray,
} from './render.js'
import { renderConfigExtension, renderOpsCommands } from './runtime.js'

export function renderCli(catalog: Catalog): string[] {
  const lines: string[] = []
  lines.push(`const cli = defineCli({`)
  lines.push(`  name: ${q(catalog.product.id)},`)
  lines.push(`  version: ${q(catalog.product.version)},`)
  lines.push(`  generated: { machineOutput: 'envelope' },`)
  const extensions = renderExtensionDeclarations(catalog)
  if (extensions.length > 0) lines.push(`  extensions: [${extensions.join(', ')}],`)
  if (catalog.ops.enabled && catalog.ops.telemetry !== false) {
    lines.push(`  events: [createLocalTelemetrySink({ enabledEnvVar: TELEMETRY_ENABLED_ENV_VAR, fileEnvVar: TELEMETRY_FILE_ENV_VAR })],`)
  }
  lines.push(`  commands: [`)
  for (const cap of catalog.capabilities) {
    lines.push(...renderCapability('    ', catalog, cap))
  }
  if (catalog.ops.enabled) lines.push(...renderOpsCommands('    ', catalog))
  lines.push(`  ],`)
  lines.push(`})`)
  lines.push('')
  lines.push(`export default cli`)
  return lines
}

function renderExtensionDeclarations(catalog: Catalog): string[] {
  const extensions: string[] = [
    'help()',
    'version()',
    'outputControls({ json: true, fullOutput: true, filterOutput: true })',
    'reflectionControls({ schema: true })',
    'llms()',
  ]
  if (needsTokens(catalog)) extensions.push('tokens()')
  if (needsAuthExtension(catalog)) extensions.push('authExtension()')
  if (needsMcpServer(catalog)) extensions.push('mcpServer()')
  if (catalog.config) {
    extensions.push(renderConfigExtension(catalog))
    extensions.push('configDoctor()')
  }
  return extensions
}

function renderCapability(indent: string, catalog: Catalog, cap: Capability): string[] {
  if (isAuthCommand(cap)) return renderAuthCapability(indent, catalog, cap)
  const lines: string[] = []
  lines.push(`${indent}defineCommand({`)
  lines.push(`${indent}  path: ${renderStringArray(cap.command)},`)
  lines.push(`${indent}  agent: ${cap.surfaces.agent ? 'true' : 'false'},`)
  lines.push(`${indent}  summary: ${q(cap.summary)},`)
  if (cap.description) lines.push(`${indent}  description: ${q(cap.description)},`)
  if (cap.examples.length > 0) lines.push(`${indent}  examples: ${renderExamples(cap.examples)},`)
  if (cap.effects) lines.push(`${indent}  effects: ${renderEffects(cap.effects)},`)
  if (cap.policy) lines.push(`${indent}  policy: ${renderPolicy(cap.policy)},`)
  const inputSchema = capabilityInputSchema(catalog, cap)
  const outputSchema = capabilityOutputSchema(catalog, cap)
  const envSchema = capabilityEnvSchema(catalog, cap)
  const authMetadata = renderCommandAuthMetadata(catalog, cap)
  if (authMetadata) lines.push(`${indent}  auth: ${authMetadata},`)
  const optionSources = capabilityOptionSources(cap)
  lines.push(`${indent}  input: {`)
  if (envSchema) lines.push(`${indent}    env: ${renderSchema(envSchema, `${indent}    `)},`)
  if (optionSources) lines.push(`${indent}    sources: ${optionSources},`)
  lines.push(`${indent}    options: ${renderSchema(inputSchema, `${indent}    `)},`)
  lines.push(`${indent}  },`)
  lines.push(`${indent}  output: ${renderSchema(outputSchema, `${indent}  `)},`)
  lines.push(`${indent}  safety: ${renderSafety(cap, hasHttpTransport(cap), needsAuthResolution(cap))},`)
  lines.push(`${indent}  async run({ ctx }) {`)
  lines.push(...renderCapabilityRun(`${indent}    `, catalog, cap))
  lines.push(`${indent}  },`)
  lines.push(`${indent}}),`)
  return lines
}

function renderCapabilityRun(indent: string, catalog: Catalog, cap: Capability): string[] {
  const preamble = renderAuthPreamble(indent, catalog, cap, hasHttpTransport(cap))
  if (cap.kind === 'resource-operation') {
    if (!cap.http) throw new Error(`Generated CLI cannot render resource operation '${cap.id}' because it has no HTTP transport.`)
    if (!catalog.remote) throw missingRemoteError(cap.id)
    return renderRemoteCall(indent, catalog, cap, cap.http, preamble)
  }
  const mode = cap.execution.mode
  if (mode === 'remote-http') {
    if (!catalog.remote) throw missingRemoteError(cap.id)
    return renderRemoteCall(indent, catalog, cap, cap.execution.http, preamble)
  }
  const parsed = parseHandler(cap.execution.handler)
  return [
    ...preamble,
    `${indent}const data = await ${parsed.export}(ctx.options)`,
    `${indent}return ctx.ok(data, { execution: { mode: ${q(mode)}, source: 'schema-default' } })`,
  ]
}

function renderRemoteCall(
  indent: string,
  catalog: Catalog,
  cap: Capability,
  http: NonNullable<ResourceOperationCapability['http']>,
  preamble: string[],
): string[] {
  const remote = renderRemoteBaseUrlSetup(indent, catalog.remote!.baseUrl)
  const inputExpr = neededContexts(cap).length > 0
    ? `{ ...(ctx.options as Record<string, unknown>), ...context }`
    : `ctx.options as Record<string, unknown>`
  const authExpr = needsAuthResolution(cap)
    ? `credential ? { kind: 'resolved', credential } : { kind: 'none' }`
    : `{ kind: 'none' }`
  return [
    ...preamble,
    ...remote.lines,
    `${indent}const data = await callHttpOperation({`,
    `${indent}  id: ${q(cap.id)},`,
    `${indent}  baseUrl: ${remote.value},`,
    `${indent}  auth: ${authExpr},`,
    `${indent}  method: ${q(http.method)},`,
    `${indent}  path: ${q(http.path)},`,
    `${indent}  bind: ${renderHttpBind(http.bind)},`,
    `${indent}  input: ${inputExpr},`,
    `${indent}  inputFields: ${renderStringArray(remoteInputFieldNames(catalog, cap))},`,
    `${indent}  output: ${renderSchema(capabilityOutputSchema(catalog, cap), `${indent}  `)},`,
    `${indent}  env: ctx.env as Record<string, string | undefined>,`,
    ...(cap.requires.permissions.length > 0 ? [`${indent}  requiredPermissions: ${renderStringArray(cap.requires.permissions)},`] : []),
    `${indent}})`,
    `${indent}return ctx.ok(data, { execution: { mode: 'remote-http', source: ${remote.source} } })`,
  ]
}

function renderRemoteBaseUrlSetup(
  indent: string,
  value: NormalizedRuntimeValue,
): { lines: string[]; source: string; value: string } {
  if (value.kind === 'literal') {
    return { lines: [], source: q('schema-default'), value: q(value.value) }
  }

  if (value.kind === 'env') {
    const envExpr = `ctx.env[${q(value.envVar)}]`
    const source = `${envExpr} && ${envExpr}.length > 0 ? 'env' : 'schema-default'`
    return { lines: [], source, value: renderRuntimeValue(value) }
  }

  const path = q(value.path)
  return {
    lines: [
      `${indent}const remoteBaseUrl = ctx.sources.value('config', ${path})`,
      `${indent}if (typeof remoteBaseUrl !== 'string' || remoteBaseUrl.length === 0) {`,
      `${indent}  return ctx.error({`,
      `${indent}    code: 'REMOTE_CONFIG_MISSING_BASE_URL',`,
      `${indent}    code_actions: [{ title: 'Inspect config', argv: ['config', 'doctor'] }],`,
      `${indent}    message: 'Remote base URL is required.',`,
      `${indent}    suggested_fix: ${q(`Set ${value.path} in config before retrying.`)},`,
      `${indent}  })`,
      `${indent}}`,
      `${indent}const remoteBaseUrlSource = ctx.sources.source('config', ${path}).kind === 'default' ? 'schema-default' : 'config'`,
    ],
    source: 'remoteBaseUrlSource',
    value: 'remoteBaseUrl',
  }
}

function capabilityInputSchema(catalog: Catalog, cap: Capability): JsonSchemaNode {
  const base = cap.input
    ? shapeToJsonSchema(catalog, cap.input)
    : ({ type: 'object', properties: {} } as JsonSchemaNode)
  if (cap.requires.contexts.length === 0) return base
  // Inject declared context flags as optional string options so env fallback
  // can still resolve the context inside resolveContext.
  const properties: Record<string, JsonSchemaNode> = { ...(base.properties ?? {}) }
  const required = new Set(base.required ?? [])
  for (const ctxId of cap.requires.contexts) {
    const ctx = catalog.contexts.find((c) => c.id === ctxId)
    if (!ctx) continue
    const flag = ctx.select.flag
    if (!flag) continue
    if (properties[flag]) continue
    const node: JsonSchemaNode = { type: 'string' }
    if (ctx.label) node.description = ctx.label
    properties[flag] = node
  }
  const out: JsonSchemaNode = { type: 'object', properties }
  if (required.size > 0) out.required = [...required].sort()
  return out
}

function capabilityEnvSchema(catalog: Catalog, cap: Capability): JsonSchemaNode | undefined {
  const envVars = new Set<string>()
  if (needsAuthResolution(cap) && catalog.auth.kind !== 'none') {
    for (const source of catalog.auth.tokenSources) {
      if (source.kind === 'env') envVars.add(source.envVar)
    }
  }
  for (const ctxId of cap.requires.contexts) {
    const ctx = catalog.contexts.find((c) => c.id === ctxId)
    if (ctx?.select.env) envVars.add(ctx.select.env)
  }
  if (catalog.remote?.baseUrl.kind === 'env' && hasHttpTransport(cap)) envVars.add(catalog.remote.baseUrl.envVar)
  if (envVars.size === 0) return undefined
  const properties: Record<string, JsonSchemaNode> = {}
  for (const envVar of [...envVars].sort()) properties[envVar] = { type: 'string' }
  return { type: 'object', properties }
}

function capabilityOptionSources(cap: Capability): string | undefined {
  if (!cap.input || cap.input.kind !== 'object') return undefined
  const entries = Object.entries(cap.input.properties)
    .filter(([, field]) => field.configPath !== undefined)
    .map(([key, field]) => `${q(key)}: [{ provider: 'config', path: ${q(field.configPath!)} }]`)
    .sort()
  return entries.length ? `{ options: { ${entries.join(', ')} } }` : undefined
}

function capabilityOutputSchema(catalog: Catalog, cap: Capability): JsonSchemaNode {
  if (cap.kind === 'resource-operation') return shapeToJsonSchema(catalog, cap.output)
  if (cap.output) return shapeToJsonSchema(catalog, cap.output)
  return { type: 'object', properties: {} }
}

function shapeToJsonSchema(catalog: Catalog, shape: NormalizedShape): JsonSchemaNode {
  if (shape.kind === 'object') return shape.jsonSchema
  const resolved = resolveListShape(catalog, shape)
  if (!resolved.ok) {
    throw new Error(
      `Generator cannot render list shape: resource '${resolved.resourceId}' is not declared in this catalog`,
    )
  }
  return resolved.jsonSchema
}

function renderCommandAuthMetadata(catalog: Catalog, cap: Capability): string | undefined {
  if (!capabilityHasAuthMetadata(cap)) return undefined
  const status =
    cap.requires.auth || cap.requires.contexts.length > 0
      ? 'requires-runtime-resolution'
      : 'not-required'
  const fields = [
    `required: ${cap.requires.auth ? 'true' : 'false'}`,
    `status: ${q(status)}`,
  ]
  if (cap.requires.auth && catalog.auth.kind !== 'none') {
    fields.push(`providerId: ${q(catalog.auth.id)}`)
    fields.push(`envVars: ${renderStringArray(catalog.auth.tokenSources.flatMap((s) => s.kind === 'env' ? [s.envVar] : []))}`)
  }
  const contexts = cap.requires.contexts.map((ctxId) => {
    const ctx = catalog.contexts.find((c) => c.id === ctxId)
    const parts = [`id: ${q(ctxId)}`]
    if (ctx?.select.flag) parts.push(`flag: ${q(ctx.select.flag)}`)
    if (ctx?.select.env) parts.push(`envVar: ${q(ctx.select.env)}`)
    return `{ ${parts.join(', ')} }`
  })
  if (contexts.length > 0) fields.push(`contexts: [${contexts.join(', ')}]`)
  if (cap.requires.permissions.length > 0) {
    fields.push(`requiredPermissions: ${renderStringArray(cap.requires.permissions)}`)
  }
  const requiredScopes = requiredScopesFor(catalog.permissions, cap)
  if (requiredScopes.length > 0) fields.push(`requiredScopes: ${renderStringArray(requiredScopes)}`)
  return `{ ${fields.join(', ')} }`
}

function inputFieldNames(catalog: Catalog, cap: Capability): string[] {
  if (!cap.input) return []
  const schema = shapeToJsonSchema(catalog, cap.input)
  return Object.keys(schema.properties ?? {}).sort()
}

function remoteInputFieldNames(catalog: Catalog, cap: Capability): string[] {
  return [...new Set([...inputFieldNames(catalog, cap), ...neededContexts(cap)])].sort()
}
