import type { Dict } from '../types.js'

export function pick(data: unknown, expression: string): unknown {
  return splitPaths(expression)
    .map((path) => path.trim())
    .filter(Boolean)
    .reduce((out, path) => merge(out, pickPath(data, path.split('.'))), undefined as unknown)
}

function splitPaths(expression: string): string[] {
  const paths: string[] = []
  let current = ''
  let bracketDepth = 0

  for (const char of expression) {
    if (char === '[') bracketDepth++
    if (char === ']') bracketDepth = Math.max(0, bracketDepth - 1)

    if (char === ',' && bracketDepth === 0) {
      paths.push(current)
      current = ''
    } else current += char
  }

  paths.push(current)
  return paths
}

function pickPath(value: any, parts: string[]): unknown {
  if (!parts.length) return value

  const [head, ...tail] = parts
  const match = head?.match(/^([\w-]+)(?:\[([\d,]+)\])?$/)
  if (!match) return undefined

  const key = match[1]!
  let selected = value?.[key]

  if (match[2]) selected = match[2].split(',').map((index) => selected?.[Number(index)])
  if (Array.isArray(selected) && tail.length) selected = selected.map((item) => pickPath(item, tail))
  else if (tail.length) selected = pickPath(selected, tail)

  return { [key]: selected }
}

function merge(a: unknown, b: unknown): unknown {
  if (!isObject(a)) return b
  if (!isObject(b)) return a

  const output: Dict = { ...a }
  for (const [key, value] of Object.entries(b)) {
    output[key] = isObject(output[key]) && isObject(value) ? merge(output[key], value) : value
  }
  return output
}

function isObject(value: unknown): value is Dict {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
