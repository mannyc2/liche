import type {
  Capability,
  NormalizedCapabilityExample,
  NormalizedEffects,
  NormalizedHttpBind,
  NormalizedPolicy,
  NormalizedRuntimeValue,
  NormalizedObjectShape,
} from '../../catalog/types.js'
import type { JsonSchemaNode } from '../../types.js'

export function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function renderStringArray(values: readonly string[]): string {
  return `[${values.map(q).join(', ')}]`
}

type SchemaRenderer = (node: JsonSchemaNode, indent: string) => string

const TYPE_RENDERERS: Record<string, SchemaRenderer> = {
  string: () => 'z.string()',
  number: () => 'z.number()',
  integer: () => 'z.number()',
  boolean: () => 'z.boolean()',
  array: (node, indent) => {
    if (!node.items) throw new Error('Array schema missing items')
    return `z.array(${renderSchemaNode(node.items, indent)})`
  },
  object: (node, indent) => renderObjectSchema(node, indent),
}

export function renderSchemaNode(node: JsonSchemaNode, indent: string): string {
  if (node.enum && Array.isArray(node.enum)) {
    const literals = node.enum.map((v) => JSON.stringify(v)).join(', ')
    return `z.enum([${literals}])`
  }
  const renderer = node.type ? TYPE_RENDERERS[node.type] : undefined
  if (!renderer) {
    throw new Error(
      `Unsupported JSON Schema type for current generator (type=${node.type}): ${JSON.stringify(node).slice(0, 200)}`,
    )
  }
  return renderer(node, indent)
}

function renderObjectSchema(node: JsonSchemaNode, indent: string): string {
  const props = node.properties ?? {}
  const required = new Set(node.required ?? [])
  const keys = Object.keys(props).sort()
  if (keys.length === 0) return 'z.object({})'
  const inner = keys.map((key) => {
    const child = props[key]!
    let expr = renderSchemaNode(child, `${indent}  `)
    if (child.default !== undefined) {
      expr += `.default(${JSON.stringify(child.default)})`
    } else if (!required.has(key)) {
      expr += '.optional()'
    }
    return `${indent}  ${q(key)}: ${expr},`
  })
  return `z.object({\n${inner.join('\n')}\n${indent}})`
}

export function renderSchema(jsonSchema: unknown, indent: string): string {
  return renderSchemaNode(jsonSchema as JsonSchemaNode, indent)
}

export function renderStrictObjectSchema(shape: NormalizedObjectShape, indent: string): string {
  const schema = renderSchema(shape.jsonSchema, indent)
  return schema.startsWith('z.object(') ? `z.strictObject(${schema.slice('z.object('.length)}` : schema
}

export function renderRuntimeValue(value: NormalizedRuntimeValue): string {
  if (value.kind === 'literal') return q(value.value)
  if (value.kind === 'env') {
    const parts = [`envVar: ${q(value.envVar)}`]
    if (value.fallback !== undefined) parts.push(`literal: ${q(value.fallback)}`)
    return `{ ${parts.join(', ')} }`
  }
  return `ctx.sources.value('config', ${q(value.path)}) as string`
}

export function renderHttpBind(bind: NormalizedHttpBind): string {
  const parts: string[] = []
  if (bind.path.length > 0) parts.push(`path: ${renderStringArray(bind.path)}`)
  if (bind.query.length > 0) parts.push(`query: ${renderStringArray(bind.query)}`)
  const headerEntries = Object.entries(bind.headers)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${q(key)}: ${q(String(value))}`)
  if (headerEntries.length > 0) parts.push(`headers: { ${headerEntries.join(', ')} }`)
  if (bind.body === true) parts.push(`body: true`)
  else if (Array.isArray(bind.body)) parts.push(`body: ${renderStringArray(bind.body)}`)
  else parts.push(`body: false`)
  return `{ ${parts.join(', ')} }`
}

export function renderExamples(examples: NormalizedCapabilityExample[]): string {
  return `[${examples
    .map((example) => {
      const fields = [`command: ${q(example.command)}`]
      if (example.summary) fields.push(`description: ${q(example.summary)}`)
      return `{ ${fields.join(', ')} }`
    })
    .join(', ')}]`
}

export function renderEffects(effects: NormalizedEffects): string {
  const fields = [`kind: ${q(effects.kind)}`]
  if (effects.idempotent !== undefined) fields.push(`idempotent: ${effects.idempotent ? 'true' : 'false'}`)
  return `{ ${fields.join(', ')} }`
}

export function renderPolicy(policy: NormalizedPolicy): string {
  return `{ dangerous: ${policy.dangerous ? 'true' : 'false'}, requiresConfirmation: ${policy.requiresConfirmation ? 'true' : 'false'}, conformanceEligible: ${policy.conformanceEligible ? 'true' : 'false'} }`
}

export function renderSafety(cap: Capability, hasHttpTransport: boolean, needsAuthResolution: boolean): string {
  const effectKind = cap.effects?.kind
  const readOnly = effectKind === 'read' || effectKind === 'auth-session-read'
  const destructive = cap.policy?.dangerous === true || effectKind === 'delete' || effectKind === 'auth-session-delete'
  const idempotent = cap.effects?.idempotent ?? readOnly
  const interactive = cap.kind === 'command' && cap.id === 'auth.login' ? 'required' : 'never'
  const openWorld = hasHttpTransport || needsAuthResolution || cap.requires.contexts.length > 0 || effectKind === 'exec'
  const auth = cap.requires.auth ? 'required' : 'none'
  return `{ auth: ${q(auth)}, destructive: ${destructive ? 'true' : 'false'}, idempotent: ${idempotent ? 'true' : 'false'}, interactive: ${q(interactive)}, openWorld: ${openWorld ? 'true' : 'false'}, readOnly: ${readOnly ? 'true' : 'false'} }`
}
