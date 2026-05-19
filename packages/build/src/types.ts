export type LocalityIR = {
  modes: Array<'local' | 'remote'>
  default: 'local' | 'remote'
}

export type RemoteAuthIR = {
  kind: 'none' | 'bearer' | 'apiKey'
  envVar?: string
  header?: string
}

export type JsonSchemaNode = {
  $schema?: string
  type?: string
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
  enum?: unknown[]
  default?: unknown
  additionalProperties?: boolean
}
