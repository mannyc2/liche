import type { RequiresSpec } from '../auth/types.js'
import type { Shape } from '../schema/shape.js'

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

export type EffectKind =
  | 'read'
  | 'write'
  | 'delete'
  | 'exec'
  | 'auth-session'
  | 'auth-session-read'
  | 'auth-session-write'
  | 'auth-session-delete'
  | 'auth-context-write'

export type EffectsSpec = {
  kind: EffectKind
  idempotent?: boolean
}

export type PolicySpec = {
  dangerous?: boolean
  requiresConfirmation?: boolean
  conformanceEligible?: boolean
}

export type CapabilityExample = {
  summary?: string
  command: string
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
  effects?: EffectsSpec
  policy?: PolicySpec
  examples?: CapabilityExample[]
  input?: Shape
  output?: Shape
  requires?: RequiresSpec
  surfaces?: SurfaceHints
  execution: Execution
}

type CommandShared = {
  summary: string
  description?: string
  effects?: EffectsSpec
  policy?: PolicySpec
  examples?: readonly CapabilityExample[]
  input?: Shape
  output?: Shape
  requires?: RequiresSpec
  surfaces?: SurfaceHints
}

export type WorkflowCommandDefinition = CommandShared & {
  family?: CommandFamily
  handler: string
  http?: HttpSpec
  steps?: readonly WorkflowStep[]
}

export type LocalCommandDefinition = CommandShared & {
  family?: CommandFamily
  handler: string
  needs?: readonly LocalNeed[]
}

export type RemoteHttpCommandDefinition = CommandShared & {
  family?: CommandFamily
  http: HttpSpec
  handler?: string
}

export { type CommandShared as InternalCommandShared }
