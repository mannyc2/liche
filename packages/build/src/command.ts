import type { Shape } from './shape.js'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type HttpBind = {
  path?: readonly string[]
  query?: readonly string[]
  headers?: Readonly<Record<string, string>>
  body?: true | readonly string[] | false
}

export type HttpSpec = {
  method: HttpMethod
  path: string
  bind?: HttpBind
}

export type LocalNeed = string

export type WorkflowStep = {
  id: string
  label: string
  uses: 'local' | 'api'
}

export type SurfaceHints = {
  cli?: boolean | { command?: string }
  docs?: boolean
  agent?: boolean
  dashboard?: boolean | { view?: string; placement?: string }
  openapi?: boolean
}

export type CommandFamily = 'workflow' | 'auth' | 'setup' | 'diagnostic' | 'dev'

export type RemoteHttpExecution = {
  mode: 'remote-http'
  http: HttpSpec
  handler?: string
}

export type LocalExecution = {
  mode: 'local'
  handler: string
  needs?: readonly LocalNeed[]
}

export type HybridWorkflowExecution = {
  mode: 'hybrid-workflow'
  handler: string
  http?: HttpSpec
  steps?: readonly WorkflowStep[]
}

export type Execution = RemoteHttpExecution | LocalExecution | HybridWorkflowExecution

export type CommandSpec = {
  family: CommandFamily
  summary: string
  description?: string
  input?: Shape
  output?: Shape
  permission?: string
  surfaces?: SurfaceHints
  execution: Execution
}

type CommandShared = {
  summary: string
  description?: string
  input?: Shape
  output?: Shape
  permission?: string
  surfaces?: SurfaceHints
}

export type WorkflowInit = CommandShared & {
  family?: CommandFamily
  handler: string
  http?: HttpSpec
  steps?: readonly WorkflowStep[]
}

export type LocalInit = CommandShared & {
  family?: CommandFamily
  handler: string
  needs?: readonly LocalNeed[]
}

export type RemoteHttpInit = CommandShared & {
  family?: CommandFamily
  http: HttpSpec
  handler?: string
}

export const Command = {
  workflow(init: WorkflowInit): CommandSpec {
    const execution: HybridWorkflowExecution = { mode: 'hybrid-workflow', handler: init.handler }
    if (init.http) execution.http = init.http
    if (init.steps) execution.steps = init.steps
    return buildCommandSpec(init, init.family ?? 'workflow', execution)
  },
  local(init: LocalInit): CommandSpec {
    const execution: LocalExecution = { mode: 'local', handler: init.handler }
    if (init.needs) execution.needs = init.needs
    return buildCommandSpec(init, init.family ?? 'dev', execution)
  },
  remoteHttp(init: RemoteHttpInit): CommandSpec {
    const execution: RemoteHttpExecution = { mode: 'remote-http', http: init.http }
    if (init.handler) execution.handler = init.handler
    return buildCommandSpec(init, init.family ?? 'workflow', execution)
  },
} as const

function buildCommandSpec(shared: CommandShared, family: CommandFamily, execution: Execution): CommandSpec {
  const spec: CommandSpec = { family, summary: shared.summary, execution }
  if (shared.description) spec.description = shared.description
  if (shared.input) spec.input = shared.input
  if (shared.output) spec.output = shared.output
  if (shared.permission) spec.permission = shared.permission
  if (shared.surfaces) spec.surfaces = shared.surfaces
  return spec
}
