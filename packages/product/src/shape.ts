import type { FieldBuilder } from './field.js'

export type ObjectShape = {
  kind: 'object'
  properties: Record<string, FieldBuilder>
}

export type ListShape = {
  kind: 'list'
  resourceId: string
}

export type Shape = ObjectShape | ListShape

export const Shape = {
  object(properties: Record<string, FieldBuilder>): ObjectShape {
    return { kind: 'object', properties: { ...properties } }
  },
  list(resourceId: string): ListShape {
    return { kind: 'list', resourceId }
  },
} as const
