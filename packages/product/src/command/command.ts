import type {
  CommandFamily,
  CommandSpec,
  Execution,
  HybridWorkflowExecution,
  InternalCommandShared,
  LocalCommandDefinition,
  LocalExecution,
  RemoteHttpCommandDefinition,
  RemoteHttpExecution,
  WorkflowCommandDefinition,
} from './types.js'

export const Command = {
  workflow(definition: WorkflowCommandDefinition): CommandSpec {
    const execution: HybridWorkflowExecution = { mode: 'hybrid-workflow', handler: definition.handler }
    if (definition.http) execution.http = definition.http
    if (definition.steps) execution.steps = definition.steps
    return buildCommandSpec(definition, definition.family ?? 'workflow', execution)
  },
  local(definition: LocalCommandDefinition): CommandSpec {
    const execution: LocalExecution = { mode: 'local', handler: definition.handler }
    if (definition.needs) execution.needs = definition.needs
    return buildCommandSpec(definition, definition.family ?? 'dev', execution)
  },
  remoteHttp(definition: RemoteHttpCommandDefinition): CommandSpec {
    const execution: RemoteHttpExecution = { mode: 'remote-http', http: definition.http }
    if (definition.handler) execution.handler = definition.handler
    return buildCommandSpec(definition, definition.family ?? 'workflow', execution)
  },
} as const

function buildCommandSpec(shared: InternalCommandShared, family: CommandFamily, execution: Execution): CommandSpec {
  const spec: CommandSpec = { family, summary: shared.summary, execution }
  if (shared.description) spec.description = shared.description
  if (shared.effects) spec.effects = shared.effects
  if (shared.policy) spec.policy = shared.policy
  if (shared.examples) spec.examples = [...shared.examples]
  if (shared.input) spec.input = shared.input
  if (shared.output) spec.output = shared.output
  if (shared.requires) spec.requires = shared.requires
  if (shared.surfaces) spec.surfaces = shared.surfaces
  return spec
}
