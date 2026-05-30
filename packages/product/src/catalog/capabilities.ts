import type { RequiresSpec } from '../auth/types.js'
import type {
  CapabilityExample,
  CommandSpec,
  EffectsSpec,
  Execution,
  PolicySpec,
  SurfaceHints,
  WorkflowStep,
} from '../command/types.js'
import type { BindingSpec, ProductResource, ResourceOperationSpec } from '../product/types.js'
import { normalizeHttpSpec } from './http.js'
import { normalizeFieldMap, normalizeShape } from './shape.js'
import type {
  CommandCapability,
  NormalizedBinding,
  NormalizedCapabilityExample,
  NormalizedEffects,
  NormalizedExecution,
  NormalizedPolicy,
  NormalizedRequires,
  NormalizedResource,
  NormalizedSurfaces,
  NormalizedWorkflowStep,
  ResourceOperationCapability,
} from './types.js'

export function normalizeResource(resource: ProductResource): NormalizedResource {
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

export function normalizeBinding(binding: BindingSpec): NormalizedBinding {
  const fields = normalizeShape(binding.fields)
  if (fields.kind !== 'object') {
    throw new Error(`Binding '${binding.key}' fields must be Shape.object(), got Shape.list`)
  }
  const out: NormalizedBinding = { key: binding.key, fields }
  if (binding.doc) out.doc = binding.doc
  return out
}

export function normalizeResourceOperation(
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

export function normalizeCommand(
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
    throw new Error(`Capability '${capabilityId}' requires auth but product declared Auth.none().`)
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

function normalizeSurfacesForResourceOperation(hints: SurfaceHints | undefined, hasHttp: boolean): NormalizedSurfaces {
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
    openapi: true,
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

function readDashboardInclusion(value: SurfaceHints['dashboard']): {
  included: boolean
  view?: string
  placement?: string
} {
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

function resolveOpenApiForCommand(value: boolean | undefined, execution: NormalizedExecution): boolean {
  if (execution.mode === 'remote-http') return value !== false
  if (execution.mode === 'local') return false
  return value === true && execution.http !== undefined
}
