import type {
  AuthCommandSpec,
  AuthIdentitySpec,
  AuthSpec,
  ContextSpec,
  PermissionSpec,
  ProductContextEntry,
  RequiresSpec,
  TokenSource,
} from './auth.js'
import type {
  CapabilityExample,
  CommandSpec,
  EffectKind,
  EffectsSpec,
  Execution,
  HttpBind,
  HttpSpec,
  PolicySpec,
  SurfaceHints,
  WorkflowStep,
} from './command.js'
import type { FieldBuilder, NormalizedField } from './field.js'
import type {
  BindingSpec,
  ProductResource,
  ProductScope,
  ResourceOperationSpec,
  RuntimeProduct,
} from './product.js'
import type { ProductConfigSpec } from './config.js'
import type { ProductRemoteSpec, RuntimeValueSpec } from './runtime.js'
import type { ListShape, ObjectShape, Shape } from './shape.js'
import type { JsonSchemaNode } from './types.js'
import type { Vocabulary } from './vocabulary.js'
import {
  normalizeOpsSpec,
  type ProductNotice,
  type ProductPackageManager,
  type ProductReleaseSpec,
} from './ops.js'

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

export type NormalizedConfigScopes = {
  project: { discoverUpwards: boolean } | false
  user: { xdg: boolean } | false
}

export type NormalizedConfig = {
  files: string[]
  scopes: NormalizedConfigScopes
  fields: NormalizedObjectShape
}

export type NormalizedRuntimeValue =
  | { kind: 'literal'; value: string }
  | { kind: 'env'; envVar: string; fallback?: string }
  | { kind: 'config'; path: string }

export type NormalizedRemote = {
  baseUrl: NormalizedRuntimeValue
}

export type NormalizedOps = {
  enabled: boolean
  doctor: false | {
    packageManagers: ProductPackageManager[]
  }
  telemetry: false | {
    enabledEnvVar: string
    fileEnvVar: string
  }
  notices: {
    updates: ProductNotice[]
    channels: ProductNotice[]
    yanks: ProductNotice[]
  }
  release: false | ProductReleaseSpec
}

export type NormalizedRequires = {
  auth: boolean
  contexts: string[]
  permissions: string[]
}

export type NormalizedEffects = {
  kind: EffectKind
  idempotent?: boolean
}

export type NormalizedPolicy = {
  dangerous: boolean
  requiresConfirmation: boolean
  conformanceEligible: boolean
}

export type NormalizedCapabilityExample = {
  summary?: string
  command: string
}

export type ResourceOperationCapability = {
  kind: 'resource-operation'
  id: string
  resourceId: string
  verb: string
  command: string[]
  summary: string
  description?: string
  effects?: NormalizedEffects
  policy?: NormalizedPolicy
  examples: NormalizedCapabilityExample[]
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
  generated?: boolean
  summary: string
  description?: string
  effects?: NormalizedEffects
  policy?: NormalizedPolicy
  examples: NormalizedCapabilityExample[]
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
} | {
  kind: 'session'
  profiles: boolean
  refresh: boolean
}

export type NormalizedAuthCommands = {
  login?: string
  logout?: string
  switch?: string
  whoami?: string
}

export type NormalizedAuthIdentity = {
  http: NormalizedHttpSpec
  subject: string
  label?: string
}

export type NormalizedAuth =
  | { kind: 'none' }
  | {
      kind: 'bearer' | 'apiKey' | 'oauthDevice'
      id: string
      header?: string
      tokenKind?: 'bearer' | 'apiKey'
      tokenSources: NormalizedTokenSource[]
      commands?: NormalizedAuthCommands
      identity?: NormalizedAuthIdentity
      oauthDevice?: {
        clientId: string
        endpoints: {
          deviceAuthorization: string
          token: string
          revoke?: string
        }
        scopes?: string[]
      }
      session?: { enabled: boolean; profiles: boolean }
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
  ops: NormalizedOps
  auth: NormalizedAuth
  permissions: NormalizedPermission[]
  contexts: NormalizedContext[]
  config?: NormalizedConfig
  remote?: NormalizedRemote
  resources: NormalizedResource[]
  bindings: NormalizedBinding[]
  capabilities: Capability[]
}

export function normalizeProduct(product: RuntimeProduct): Catalog {
  const auth = normalizeAuth(product.authSpec ?? { kind: 'none' })
  const permissions = normalizePermissions(product.permissionSpecs)
  const permissionIds = new Set(permissions.map((p) => p.id))
  const contexts = product.contexts.map(normalizeContext)
  const contextIds = new Set(contexts.map((c) => c.id))
  const config = product.configSpec ? normalizeConfig(product.configSpec) : undefined
  const remote = product.remoteSpec ? normalizeRemote(product.remoteSpec) : undefined
  const resources = product.resources.map(normalizeResource)
  const resourceCapabilities = product.resources.flatMap((r) =>
    r.operations.map(({ verb, spec }) =>
      normalizeResourceOperation(r.id, verb, spec, auth.kind !== 'none', contextIds, permissionIds),
    ),
  )
  const commandCapabilities = product.commands.map(({ id, spec }) =>
    normalizeCommand(id, spec, auth.kind !== 'none', contextIds, permissionIds),
  )
  const authCapabilities = normalizeAuthCapabilities(auth, contexts)
  const bindings = product.bindings.map(normalizeBinding)
  return {
    kind: 'lili.catalog',
    catalogVersion: 1,
    product: normalizeProductHeader(product),
    vocabulary: normalizeVocabulary(product.vocabulary),
    ops: normalizeOpsSpec(product.opsSpec),
    auth,
    permissions,
    contexts,
    ...(config ? { config } : undefined),
    ...(remote ? { remote } : undefined),
    resources,
    bindings,
    capabilities: [...resourceCapabilities, ...commandCapabilities, ...authCapabilities],
  }
}

function normalizeConfig(config: ProductConfigSpec): NormalizedConfig {
  const fields = normalizeShape(config.fields)
  if (fields.kind !== 'object') {
    throw new Error(`Product config fields must be Shape.object(), got Shape.list`)
  }
  return {
    files: config.files ? [...config.files] : [],
    scopes: normalizeConfigScopes(config),
    fields,
  }
}

function normalizeConfigScopes(config: ProductConfigSpec): NormalizedConfigScopes {
  const project = config.scopes?.project
  const user = config.scopes?.user
  return {
    project: project === false
      ? false
      : { discoverUpwards: project === true || (typeof project === 'object' && project.discoverUpwards === true) },
    user: user === true || (typeof user === 'object' && user.xdg === true)
      ? { xdg: true }
      : false,
  }
}

function normalizeRemote(remote: ProductRemoteSpec): NormalizedRemote {
  return { baseUrl: normalizeRuntimeValue(remote.baseUrl) }
}

function normalizeRuntimeValue(value: RuntimeValueSpec): NormalizedRuntimeValue {
  if (value.kind === 'literal') return { kind: 'literal', value: value.value }
  if (value.kind === 'env') {
    const out: NormalizedRuntimeValue = { kind: 'env', envVar: value.envVar }
    if (value.fallback !== undefined) out.fallback = value.fallback
    return out
  }
  return { kind: 'config', path: value.path }
}

function normalizeAuth(spec: AuthSpec): NormalizedAuth {
  if (spec.kind === 'none') return { kind: 'none' }
  const tokenSources = spec.sources.map(normalizeTokenSource)
  const out: NormalizedAuth = {
    kind: spec.kind,
    id: spec.id,
    tokenSources,
  }
  if (spec.kind === 'oauthDevice') {
    out.tokenKind = spec.token.kind
    if (spec.token.header) out.header = spec.token.header
    if (spec.commands) out.commands = normalizeAuthCommands(spec.commands)
    if (spec.identity) out.identity = normalizeAuthIdentity(spec.identity)
    out.oauthDevice = {
      clientId: spec.clientId,
      endpoints: { ...spec.endpoints },
      ...(spec.scopes ? { scopes: [...spec.scopes] } : undefined),
    }
  } else if (spec.header) out.header = spec.header
  const sessionSource = tokenSources.find((source) => source.kind === 'session')
  if (sessionSource) out.session = { enabled: true, profiles: sessionSource.profiles }
  return out
}

function normalizeTokenSource(source: TokenSource): NormalizedTokenSource {
  if (source.kind === 'session') {
    return {
      kind: 'session',
      profiles: source.profiles !== false,
      refresh: source.refresh === true,
    }
  }
  const out: NormalizedTokenSource = {
    kind: 'env',
    envVar: source.envVar,
    mode: source.mode ?? 'any',
  }
  if (source.label) out.label = source.label
  if (source.scopes) out.scopes = [...source.scopes]
  return out
}

function normalizeAuthCommands(commands: AuthCommandSpec): NormalizedAuthCommands {
  const out: NormalizedAuthCommands = {}
  if (commands.login) out.login = commands.login
  if (commands.logout) out.logout = commands.logout
  if (commands.switch) out.switch = commands.switch
  if (commands.whoami) out.whoami = commands.whoami
  return out
}

function normalizeAuthIdentity(identity: AuthIdentitySpec): NormalizedAuthIdentity {
  const out: NormalizedAuthIdentity = {
    http: normalizeHttpSpec(identity.http),
    subject: identity.subject,
  }
  if (identity.label) out.label = identity.label
  return out
}

function normalizeAuthCapabilities(auth: NormalizedAuth, contexts: NormalizedContext[]): CommandCapability[] {
  if (auth.kind === 'none' || !auth.commands) return []
  const out: CommandCapability[] = []
  const hasSession = auth.tokenSources.some((source) => source.kind === 'session')
  if (auth.commands.whoami && (auth.identity || hasSession)) {
    out.push(authCapability('auth.whoami', auth.commands.whoami, 'Show current authentication status', 'auth-session-read', true))
  }
  if (auth.commands.switch && hasSession && auth.session?.profiles && contexts.length > 0) {
    out.push(authCapability('auth.switch', auth.commands.switch, 'Switch stored auth context', 'auth-context-write', false))
  }
  if (auth.commands.login && auth.kind === 'oauthDevice' && hasSession) {
    out.push(authCapability('auth.login', auth.commands.login, 'Log in with OAuth device flow', 'auth-session-write', false))
  }
  if (auth.commands.logout && hasSession) {
    out.push(authCapability('auth.logout', auth.commands.logout, 'Log out of stored auth session', 'auth-session-delete', false))
  }
  return out
}

function authCapability(
  id: string,
  command: string,
  summary: string,
  effect: EffectKind,
  agent: boolean,
): CommandCapability {
  return {
    kind: 'command',
    id,
    family: 'auth',
    command: [command],
    generated: true,
    summary,
    examples: [],
    execution: { mode: 'local', handler: id, needs: [] },
    effects: { kind: effect },
    policy: {
      dangerous: false,
      requiresConfirmation: false,
      conformanceEligible: false,
    },
    requires: { auth: false, contexts: [], permissions: [] },
    surfaces: {
      cli: true,
      cliCommand: command,
      docs: true,
      dashboard: false,
      agent,
      openapi: false,
    },
  }
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

function normalizeProductHeader(product: RuntimeProduct): Catalog['product'] {
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

function normalizeResource(resource: ProductResource): NormalizedResource {
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
    examples: normalizeExamples(spec.examples),
    output: normalizeShape(spec.output),
    requires: normalizeRequires(spec.requires, authEnabled, contextIds, permissionIds, id),
    surfaces: normalizeSurfacesForResourceOperation(spec.surfaces, http !== undefined),
  }
  if (spec.description) cap.description = spec.description
  if (spec.effects) cap.effects = normalizeEffects(spec.effects)
  if (spec.policy) cap.policy = normalizePolicy(spec.policy)
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
    examples: normalizeExamples(spec.examples),
    execution,
    requires: normalizeRequires(spec.requires, authEnabled, contextIds, permissionIds, id),
    surfaces: normalizeSurfacesForCommand(spec.surfaces, execution),
  }
  if (spec.description) cap.description = spec.description
  if (spec.effects) cap.effects = normalizeEffects(spec.effects)
  if (spec.policy) cap.policy = normalizePolicy(spec.policy)
  if (spec.input) cap.input = normalizeShape(spec.input)
  if (spec.output) cap.output = normalizeShape(spec.output)
  return cap
}

function normalizeEffects(effects: EffectsSpec): NormalizedEffects {
  const out: NormalizedEffects = { kind: effects.kind }
  if (effects.idempotent !== undefined) out.idempotent = effects.idempotent
  return out
}

function normalizePolicy(policy: PolicySpec): NormalizedPolicy {
  return {
    dangerous: policy.dangerous === true,
    requiresConfirmation: policy.requiresConfirmation === true,
    conformanceEligible: policy.conformanceEligible !== false,
  }
}

function normalizeExamples(examples: readonly CapabilityExample[] | undefined): NormalizedCapabilityExample[] {
  return (examples ?? []).map((example) => {
    const out: NormalizedCapabilityExample = { command: example.command }
    if (example.summary) out.summary = example.summary
    return out
  })
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
  if (field.configPath !== undefined) base['x-lili-config-path'] = field.configPath
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
