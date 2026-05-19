import type {
  AuthSpec,
  ContextSpec,
  PermissionSpec,
  ProductContextEntry,
  RequiresSpec,
  TokenSource,
} from './auth.js'
import type {
  CommandSpec,
  Execution,
  HttpBind,
  HttpSpec,
  SurfaceHints,
  WorkflowStep,
} from './command.js'
import type { FieldBuilder, NormalizedField } from './field.js'
import type {
  BindingSpec,
  Product,
  ProductScope,
  ResourceBuilder,
  ResourceOperationSpec,
} from './product.js'
import type { ListShape, ObjectShape, Shape } from './shape.js'
import type { JsonSchemaNode } from './types.js'
import type { Vocabulary } from './vocabulary.js'

export type NormalizedHttpBind = {
  path: string[]
  query: string[]
  headers: Record<string, string>
  body: true | string[] | false
}

export type NormalizedHttpSpec = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  bind: NormalizedHttpBind
}

export type NormalizedWorkflowStep = {
  id: string
  label: string
  uses: 'local' | 'api'
}

export type NormalizedExecution =
  | { mode: 'remote-http'; http: NormalizedHttpSpec; handler?: string }
  | { mode: 'local'; handler: string; needs: string[] }
  | {
      mode: 'hybrid-workflow'
      handler: string
      http?: NormalizedHttpSpec
      steps: NormalizedWorkflowStep[]
    }

export type NormalizedSurfaces = {
  cli: boolean
  cliCommand?: string
  docs: boolean
  dashboard: boolean
  dashboardView?: string
  dashboardPlacement?: string
  agent: boolean
  openapi: boolean
  // The authored surfaces.openapi value, preserved so lints can spot
  // authoring intent that normalization erases (e.g., openapi=true on a
  // local command). Undefined when the author did not write surfaces.openapi.
  openapiRequested?: boolean
}

export type NormalizedObjectShape = {
  kind: 'object'
  properties: Record<string, NormalizedField>
  jsonSchema: JsonSchemaNode
}

export type NormalizedListShape = {
  kind: 'list'
  resourceId: string
}

export type NormalizedShape = NormalizedObjectShape | NormalizedListShape

export type NormalizedResource = {
  id: string
  label: string
  path: string
  doc?: string
  scope?: string
  fields: Record<string, NormalizedField>
}

export type NormalizedBinding = {
  key: string
  doc?: string
  fields: NormalizedObjectShape
}

export type NormalizedRequires = {
  auth: boolean
  contexts: string[]
  permissions: string[]
}

export type ResourceOperationCapability = {
  kind: 'resource-operation'
  id: string
  resourceId: string
  verb: string
  command: string[]
  summary: string
  description?: string
  http?: NormalizedHttpSpec
  input?: NormalizedShape
  output: NormalizedShape
  requires: NormalizedRequires
  surfaces: NormalizedSurfaces
}

export type CommandCapability = {
  kind: 'command'
  id: string
  family: 'workflow' | 'auth' | 'setup' | 'diagnostic' | 'dev'
  command: string[]
  summary: string
  description?: string
  execution: NormalizedExecution
  input?: NormalizedShape
  output?: NormalizedShape
  requires: NormalizedRequires
  surfaces: NormalizedSurfaces
}

export type Capability = ResourceOperationCapability | CommandCapability

export type NormalizedProductScope = {
  kind: string
  param: string
}

export type NormalizedVocabulary = {
  verbs: string[]
  flags: string[]
  aliases: Record<string, string>
}

export type NormalizedTokenSource = {
  kind: 'env'
  envVar: string
  mode: 'any' | 'ci'
  label?: string
  scopes?: string[]
}

export type NormalizedAuth =
  | { kind: 'none' }
  | {
      kind: 'bearer' | 'apiKey'
      id: string
      header?: string
      tokenSources: NormalizedTokenSource[]
    }

export type NormalizedContextSelect = {
  flag?: string
  env?: string
}

export type NormalizedContext = {
  id: string
  source: 'env' | 'remote'
  label?: string
  select: NormalizedContextSelect
  idField?: string
  nameField?: string
  list?: NormalizedHttpSpec
}

export type NormalizedPermission = {
  id: string
  scope?: string
  description?: string
}

export type Catalog = {
  kind: 'lili.catalog'
  catalogVersion: 1
  product: {
    id: string
    name: string
    version: string
    description?: string
    scope?: NormalizedProductScope
  }
  vocabulary: NormalizedVocabulary
  auth: NormalizedAuth
  permissions: NormalizedPermission[]
  contexts: NormalizedContext[]
  resources: NormalizedResource[]
  bindings: NormalizedBinding[]
  capabilities: Capability[]
}

export function normalizeProduct(product: Product): Catalog {
  if (product.authSpec === undefined) {
    throw new Error(
      `Product '${product.id}' must declare an auth posture via .auth(Auth.none()|Auth.bearer(...)|Auth.apiKey(...)) before normalization.`,
    )
  }
  const auth = normalizeAuth(product.authSpec)
  const permissions = normalizePermissions(product.permissionSpecs)
  const permissionIds = new Set(permissions.map((p) => p.id))
  const contexts = product.contexts.map(normalizeContext)
  const contextIds = new Set(contexts.map((c) => c.id))
  const resources = product.resources.map(normalizeResource)
  const resourceCapabilities = product.resources.flatMap((r) =>
    r.operations.map(({ verb, spec }) =>
      normalizeResourceOperation(r.id, verb, spec, auth.kind !== 'none', contextIds, permissionIds),
    ),
  )
  const commandCapabilities = product.commands.map(({ id, spec }) =>
    normalizeCommand(id, spec, auth.kind !== 'none', contextIds, permissionIds),
  )
  const bindings = product.bindings.map(normalizeBinding)
  return {
    kind: 'lili.catalog',
    catalogVersion: 1,
    product: normalizeProductHeader(product),
    vocabulary: normalizeVocabulary(product.vocabulary),
    auth,
    permissions,
    contexts,
    resources,
    bindings,
    capabilities: [...resourceCapabilities, ...commandCapabilities],
  }
}

function normalizeAuth(spec: AuthSpec): NormalizedAuth {
  if (spec.kind === 'none') return { kind: 'none' }
  const tokenSources = spec.sources.map(normalizeTokenSource)
  const out: NormalizedAuth = {
    kind: spec.kind,
    id: spec.id,
    tokenSources,
  }
  if (spec.header) out.header = spec.header
  return out
}

function normalizeTokenSource(source: TokenSource): NormalizedTokenSource {
  const out: NormalizedTokenSource = {
    kind: 'env',
    envVar: source.envVar,
    mode: source.mode ?? 'any',
  }
  if (source.label) out.label = source.label
  if (source.scopes) out.scopes = [...source.scopes]
  return out
}

function normalizePermissions(specs: Readonly<Record<string, PermissionSpec>>): NormalizedPermission[] {
  return Object.keys(specs).sort().map((id) => {
    const spec = specs[id]!
    const out: NormalizedPermission = { id }
    if (spec.kind === 'scope') out.scope = spec.scope
    if (spec.description) out.description = spec.description
    return out
  })
}

function normalizeContext(entry: ProductContextEntry): NormalizedContext {
  const { id, spec } = entry
  const out: NormalizedContext = {
    id,
    source: spec.kind,
    select: normalizeContextSelect(spec),
  }
  if (spec.label) out.label = spec.label
  if (spec.kind === 'remote') {
    if (spec.idField) out.idField = spec.idField
    if (spec.nameField) out.nameField = spec.nameField
    if (spec.list) out.list = normalizeHttpSpec(spec.list.http)
  }
  return out
}

function normalizeContextSelect(spec: ContextSpec): NormalizedContextSelect {
  const out: NormalizedContextSelect = {}
  if (spec.select.flag) out.flag = spec.select.flag
  if (spec.select.env) out.env = spec.select.env
  return out
}

function normalizeRequires(
  spec: RequiresSpec | undefined,
  authEnabled: boolean,
  contextIds: Set<string>,
  permissionIds: Set<string>,
  capabilityId: string,
): NormalizedRequires {
  const out: NormalizedRequires = {
    auth: spec?.auth === true,
    contexts: spec?.contexts ? [...spec.contexts] : [],
    permissions: spec?.permissions ? [...spec.permissions] : [],
  }
  if (out.auth && !authEnabled) {
    throw new Error(
      `Capability '${capabilityId}' requires auth but product declared Auth.none().`,
    )
  }
  for (const ctx of out.contexts) {
    if (!contextIds.has(ctx)) {
      throw new Error(`Capability '${capabilityId}' requires undeclared context '${ctx}'.`)
    }
  }
  for (const permission of out.permissions) {
    if (!permissionIds.has(permission)) {
      throw new Error(`Capability '${capabilityId}' requires undeclared permission '${permission}'.`)
    }
  }
  return out
}

function normalizeVocabulary(vocab: Vocabulary): NormalizedVocabulary {
  return {
    verbs: [...vocab.verbs],
    flags: [...vocab.flags],
    aliases: { ...vocab.aliases },
  }
}

function normalizeProductHeader(product: Product): Catalog['product'] {
  const out: Catalog['product'] = {
    id: product.id,
    name: product.name,
    version: product.version,
  }
  if (product.description) out.description = product.description
  if (product.scope) out.scope = normalizeProductScope(product.scope)
  return out
}

function normalizeProductScope(scope: ProductScope): NormalizedProductScope {
  return { kind: scope.kind, param: scope.param }
}

function normalizeResource(resource: ResourceBuilder): NormalizedResource {
  const out: NormalizedResource = {
    id: resource.id,
    label: resource.label,
    path: resource.path,
    fields: normalizeFieldMap(resource.fields),
  }
  if (resource.doc) out.doc = resource.doc
  if (resource.scope) out.scope = resource.scope
  return out
}

function normalizeBinding(binding: BindingSpec): NormalizedBinding {
  const fields = normalizeShape(binding.fields)
  if (fields.kind !== 'object') {
    throw new Error(`Binding '${binding.key}' fields must be Shape.object(), got Shape.list`)
  }
  const out: NormalizedBinding = { key: binding.key, fields }
  if (binding.doc) out.doc = binding.doc
  return out
}

function normalizeResourceOperation(
  resourceId: string,
  verb: string,
  spec: ResourceOperationSpec,
  authEnabled: boolean,
  contextIds: Set<string>,
  permissionIds: Set<string>,
): ResourceOperationCapability {
  const http = spec.http ? normalizeHttpSpec(spec.http) : undefined
  const id = `${resourceId}.${verb}`
  const cap: ResourceOperationCapability = {
    kind: 'resource-operation',
    id,
    resourceId,
    verb,
    command: [resourceId, verb],
    summary: spec.summary,
    output: normalizeShape(spec.output),
    requires: normalizeRequires(spec.requires, authEnabled, contextIds, permissionIds, id),
    surfaces: normalizeSurfacesForResourceOperation(spec.surfaces, http !== undefined),
  }
  if (spec.description) cap.description = spec.description
  if (http) cap.http = http
  if (spec.input) cap.input = normalizeShape(spec.input)
  return cap
}

function normalizeCommand(
  id: string,
  spec: CommandSpec,
  authEnabled: boolean,
  contextIds: Set<string>,
  permissionIds: Set<string>,
): CommandCapability {
  const execution = normalizeExecution(spec.execution)
  const cap: CommandCapability = {
    kind: 'command',
    id,
    family: spec.family,
    command: [id],
    summary: spec.summary,
    execution,
    requires: normalizeRequires(spec.requires, authEnabled, contextIds, permissionIds, id),
    surfaces: normalizeSurfacesForCommand(spec.surfaces, execution),
  }
  if (spec.description) cap.description = spec.description
  if (spec.input) cap.input = normalizeShape(spec.input)
  if (spec.output) cap.output = normalizeShape(spec.output)
  return cap
}

function normalizeExecution(execution: Execution): NormalizedExecution {
  if (execution.mode === 'remote-http') {
    const out: NormalizedExecution = { mode: 'remote-http', http: normalizeHttpSpec(execution.http) }
    if (execution.handler) out.handler = execution.handler
    return out
  }
  if (execution.mode === 'local') {
    return {
      mode: 'local',
      handler: execution.handler,
      needs: execution.needs ? [...execution.needs].sort() : [],
    }
  }
  // hybrid-workflow
  const out: NormalizedExecution = {
    mode: 'hybrid-workflow',
    handler: execution.handler,
    steps: execution.steps ? execution.steps.map(normalizeWorkflowStep) : [],
  }
  if (execution.http) out.http = normalizeHttpSpec(execution.http)
  return out
}

function normalizeWorkflowStep(step: WorkflowStep): NormalizedWorkflowStep {
  return { id: step.id, label: step.label, uses: step.uses }
}

function normalizeHttpSpec(http: HttpSpec): NormalizedHttpSpec {
  return { method: http.method, path: http.path, bind: normalizeHttpBind(http.bind) }
}

function normalizeHttpBind(bind: HttpBind | undefined): NormalizedHttpBind {
  const raw = bind?.body
  let body: true | string[] | false
  if (raw === undefined || raw === false) body = false
  else if (raw === true) body = true
  else body = [...raw]
  return {
    path: bind?.path ? [...bind.path] : [],
    query: bind?.query ? [...bind.query] : [],
    headers: bind?.headers ? { ...bind.headers } : {},
    body,
  }
}

function normalizeShape(shape: Shape): NormalizedShape {
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

function normalizeFieldMap(
  fields: Readonly<Record<string, FieldBuilder>>,
): Record<string, NormalizedField> {
  const out: Record<string, NormalizedField> = {}
  for (const key of Object.keys(fields)) {
    out[key] = fields[key]!.toField()
  }
  return out
}

function objectShapeToJsonSchema(
  properties: Record<string, NormalizedField>,
): JsonSchemaNode {
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
  if (field.secret) base['x-lili-secret'] = true
  if (field.identifier) base['x-lili-identifier'] = true
  if (field.humanLabel) base['x-lili-human-label'] = true
  if (field.mutability !== 'mutable') base['x-lili-mutability'] = field.mutability
  return base as JsonSchemaNode
}

function normalizeSurfacesForResourceOperation(
  hints: SurfaceHints | undefined,
  hasHttp: boolean,
): NormalizedSurfaces {
  const out = normalizeSurfacesCommon(hints)
  out.openapi = resolveOpenApiForResourceOperation(hints?.openapi, hasHttp)
  return out
}

function normalizeSurfacesForCommand(
  hints: SurfaceHints | undefined,
  execution: NormalizedExecution,
): NormalizedSurfaces {
  const out = normalizeSurfacesCommon(hints)
  out.openapi = resolveOpenApiForCommand(hints?.openapi, execution)
  return out
}

function normalizeSurfacesCommon(hints: SurfaceHints | undefined): NormalizedSurfaces {
  const cli = readCliInclusion(hints?.cli)
  const dashboard = readDashboardInclusion(hints?.dashboard)
  const out: NormalizedSurfaces = {
    cli: cli.included,
    docs: hints?.docs !== false,
    dashboard: dashboard.included,
    agent: hints?.agent === true,
    openapi: true, // overwritten by caller
  }
  if (cli.command !== undefined) out.cliCommand = cli.command
  if (dashboard.view !== undefined) out.dashboardView = dashboard.view
  if (dashboard.placement !== undefined) out.dashboardPlacement = dashboard.placement
  if (hints && hints.openapi !== undefined) out.openapiRequested = hints.openapi
  return out
}

function readCliInclusion(value: SurfaceHints['cli']): { included: boolean; command?: string } {
  if (value === undefined) return { included: true }
  if (value === false) return { included: false }
  if (value === true) return { included: true }
  const out: { included: boolean; command?: string } = { included: true }
  if (value.command !== undefined) out.command = value.command
  return out
}

function readDashboardInclusion(
  value: SurfaceHints['dashboard'],
): { included: boolean; view?: string; placement?: string } {
  if (value === undefined) return { included: false }
  if (value === false) return { included: false }
  if (value === true) return { included: true }
  const out: { included: boolean; view?: string; placement?: string } = { included: true }
  if (value.view !== undefined) out.view = value.view
  if (value.placement !== undefined) out.placement = value.placement
  return out
}

function resolveOpenApiForResourceOperation(value: boolean | undefined, hasHttp: boolean): boolean {
  if (value === false) return false
  if (!hasHttp) return false
  return true
}

function resolveOpenApiForCommand(
  value: boolean | undefined,
  execution: NormalizedExecution,
): boolean {
  if (execution.mode === 'remote-http') return value !== false
  if (execution.mode === 'local') return false
  // hybrid-workflow: excluded unless explicitly true and an HTTP trigger exists
  return value === true && execution.http !== undefined
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
