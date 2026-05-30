import type { NormalizedField } from '../schema/field.js'
import type { EffectKind } from '../command/types.js'
import type { JsonSchemaNode } from '../types.js'
import type { NormalizedOpsSpec, ProductNotice, ProductPackageManager, ProductReleaseSpec } from '../ops/types.js'

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

export type NormalizedOps = NormalizedOpsSpec

// Re-export so callers can import everything from catalog/types.
export type { ProductNotice, ProductPackageManager, ProductReleaseSpec }

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

export type NormalizedTokenSource =
  | {
      kind: 'env'
      envVar: string
      mode: 'any' | 'ci'
      label?: string
      scopes?: string[]
    }
  | {
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
  kind: 'liche.catalog'
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
