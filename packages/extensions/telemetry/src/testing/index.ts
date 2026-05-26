import type { TelemetrySink, WireEvent } from '../index.js'

export type MemorySink = TelemetrySink & {
  readonly events: ReadonlyArray<WireEvent>
  clear(): void
}

export function memorySink(): MemorySink {
  const events: WireEvent[] = []
  return {
    name: 'memory',
    emit(event) {
      events.push(event)
    },
    get events() {
      return events
    },
    clear() {
      events.length = 0
    },
  }
}

export function throwingSink(message = 'boom'): TelemetrySink {
  return {
    name: 'throwing',
    emit() {
      throw new Error(message)
    },
  }
}

export function delayingSink(ms: number): TelemetrySink {
  return {
    name: 'delaying',
    emit() {
      return new Promise<void>((resolve) => setTimeout(resolve, ms))
    },
  }
}

export function makeTestEnv(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return { ...overrides }
}

export function expectRedacted(event: WireEvent, jsonPath: string): void {
  const parts = jsonPath.replace(/^\$\.?/, '').split('.')
  let cursor: unknown = event
  for (const part of parts) {
    if (cursor && typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[part]
    } else {
      throw new Error(`expectRedacted: path ${jsonPath} not found`)
    }
  }
  if (cursor !== '[redacted]') {
    throw new Error(`expectRedacted: ${jsonPath} = ${JSON.stringify(cursor)} (expected '[redacted]')`)
  }
}
