export type JsonSchemaNode = {
  $schema?: string
  type?: string
  format?: string
  description?: string
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
  enum?: unknown[]
  default?: unknown
  additionalProperties?: boolean
  // OpenAPI/JSON Schema vendor extension keys (e.g., x-liche-secret).
  // We don't enumerate them; the catalog adds and the generator preserves.
  [extensionKey: `x-${string}`]: unknown
}
