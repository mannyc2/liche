import type { MiddlewareHandler } from '../types.js'

export function middleware<T extends MiddlewareHandler>(handler: T): T {
  return handler
}
