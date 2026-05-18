export function camel(input: string): string {
  return input.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())
}

export function kebab(input: string): string {
  return input.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return !!value && typeof (value as any)[Symbol.asyncIterator] === 'function'
}

export async function collectAsync(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const output: unknown[] = []
  for await (const item of iterable) output.push(item)
  return output
}
