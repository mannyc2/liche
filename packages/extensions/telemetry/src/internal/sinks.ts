import { appendFile } from 'node:fs/promises'
import type { WireEvent } from './schema.js'

export interface TelemetrySink {
  readonly name: string
  emit(event: WireEvent): void | Promise<void>
  flush?(deadlineMs: number): Promise<void>
  shutdown?(deadlineMs: number): Promise<void>
}

// ─── JSONL file sink ────────────────────────────────────────────────────────────

export type JsonlFileSinkOptions = {
  readonly path: string | (() => string | undefined)
  readonly append?: (path: string, text: string) => Promise<void> | void
}

export function jsonlFileSink(options: JsonlFileSinkOptions): TelemetrySink {
  const write = options.append ?? appendFile
  const resolvePath = typeof options.path === 'function' ? options.path : (): string => options.path as string
  return {
    name: 'jsonl-file',
    async emit(event) {
      const path = resolvePath()
      if (!path) return
      await write(path, `${JSON.stringify(event)}\n`)
    },
  }
}

// ─── console sink ───────────────────────────────────────────────────────────────

export type ConsoleSinkOptions = {
  readonly stream?: 'stdout' | 'stderr'
  readonly write?: (text: string) => void
}

export function consoleSink(options: ConsoleSinkOptions = {}): TelemetrySink {
  const write =
    options.write ??
    ((text: string) => {
      const target = options.stream === 'stdout' ? process.stdout : process.stderr
      target.write(text)
    })
  return {
    name: 'console',
    emit(event) {
      write(`[telemetry] ${JSON.stringify(event)}\n`)
    },
  }
}

// ─── noop sink ──────────────────────────────────────────────────────────────────

export function noopSink(): TelemetrySink {
  return {
    name: 'noop',
    emit() {
      /* no-op */
    },
  }
}

// ─── HTTP sink ──────────────────────────────────────────────────────────────────

export type HttpSinkOptions = {
  readonly url: string
  readonly headers?: Record<string, string>
  readonly timeoutMs?: number
  readonly batchSize?: number
  readonly flushMs?: number
  readonly format?: 'json' | 'otlp'
  readonly fetch?: typeof fetch
  readonly retry?: { delayMs?: number; maxAttempts?: number }
}

export function httpSink(options: HttpSinkOptions): TelemetrySink {
  const {
    url,
    headers = {},
    timeoutMs = 2000,
    batchSize = 20,
    flushMs = 1000,
    format = 'json',
    fetch: fetchImpl = fetch,
    retry = {},
  } = options
  const retryDelayMs = retry.delayMs ?? 250
  const maxAttempts = retry.maxAttempts ?? 2

  let buffer: WireEvent[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  let blockedUntil = 0

  const post = async (events: ReadonlyArray<WireEvent>): Promise<void> => {
    if (events.length === 0) return
    if (Date.now() < blockedUntil) return
    const payload = format === 'otlp' ? toOtlpLogs(events) : { events }
    const body = JSON.stringify(payload)
    const finalHeaders: Record<string, string> = { 'content-type': 'application/json', ...headers }
    let attempt = 0
    while (attempt < maxAttempts) {
      attempt += 1
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetchImpl(url, { method: 'POST', headers: finalHeaders, body, signal: controller.signal })
        clearTimeout(t)
        if (res.ok) return
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after')
          blockedUntil = Date.now() + parseRetryAfter(retryAfter)
          return
        }
        if (res.status >= 400 && res.status < 500) return
        // 5xx falls through to retry
      } catch {
        clearTimeout(t)
        // network/abort errors fall through to retry
      }
      if (attempt < maxAttempts) await sleep(retryDelayMs)
    }
  }

  const armTimer = (): void => {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      const batch = buffer
      buffer = []
      void post(batch)
    }, flushMs)
  }

  const cancelTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  return {
    name: 'http',
    emit(event) {
      buffer.push(event)
      if (buffer.length >= batchSize) {
        cancelTimer()
        const batch = buffer
        buffer = []
        return post(batch)
      }
      armTimer()
      return
    },
    async flush() {
      cancelTimer()
      const batch = buffer
      buffer = []
      await post(batch)
    },
    async shutdown() {
      cancelTimer()
      const batch = buffer
      buffer = []
      await post(batch)
    },
  }
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 1000
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return 1000
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toOtlpLogs(events: ReadonlyArray<WireEvent>): unknown {
  const sample = events[0]
  const resource = sample
    ? {
        attributes: [
          { key: 'service.name', value: { stringValue: sample.cli.name } },
          ...(sample.cli.version ? [{ key: 'service.version', value: { stringValue: sample.cli.version } }] : []),
          { key: 'process.runtime.name', value: { stringValue: sample.telemetry.runtime.name } },
          { key: 'process.runtime.version', value: { stringValue: sample.telemetry.runtime.version } },
        ],
      }
    : { attributes: [] }
  return {
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            scope: {
              name: sample?.telemetry.sdk.name ?? '@liche/telemetry',
              version: sample?.telemetry.sdk.version ?? '0.0.0',
            },
            logRecords: events.map((e) => ({
              timeUnixNano: String(Date.parse(e.occurredAt) * 1_000_000),
              severityText: e.result === 'success' ? 'INFO' : e.type.endsWith('failed') ? 'ERROR' : 'INFO',
              body: { stringValue: e.type },
              attributes: [
                { key: 'cli.event.type', value: { stringValue: e.type } },
                ...(e.command ? [{ key: 'cli.command.id', value: { stringValue: e.command.id } }] : []),
                ...(e.durationMs !== undefined ? [{ key: 'cli.duration_ms', value: { intValue: e.durationMs } }] : []),
                ...(e.exitCode !== undefined ? [{ key: 'cli.exit_code', value: { intValue: e.exitCode } }] : []),
                ...(e.result ? [{ key: 'cli.result', value: { stringValue: e.result } }] : []),
                ...(e.error ? [{ key: 'cli.error.code', value: { stringValue: e.error.code } }] : []),
              ],
            })),
          },
        ],
      },
    ],
  }
}

// ─── circuit-breaker wrapper ────────────────────────────────────────────────────

export type WrappedSinkStats = {
  readonly failures: number
  readonly tripped: boolean
}

export type WrappedSink = TelemetrySink & {
  readonly stats: () => WrappedSinkStats
}

export function wrapSink(
  sink: TelemetrySink,
  options: { threshold?: number; onError?: (sinkName: string, error: unknown) => void } = {},
): WrappedSink {
  const threshold = options.threshold ?? 3
  const onError = options.onError ?? (() => {})
  let consecutiveFailures = 0
  let tripped = false

  const run = async <T>(fn: () => T | Promise<T>): Promise<void> => {
    if (tripped) return
    try {
      await fn()
      consecutiveFailures = 0
    } catch (err) {
      consecutiveFailures += 1
      onError(sink.name, err)
      if (consecutiveFailures >= threshold) tripped = true
    }
  }

  const wrapped: WrappedSink = {
    name: sink.name,
    emit: (event) => run(() => sink.emit(event)),
    stats: () => Object.freeze({ failures: consecutiveFailures, tripped }),
  }
  if (sink.flush) {
    wrapped.flush = (deadlineMs) => run(() => sink.flush!(deadlineMs))
  }
  if (sink.shutdown) {
    // shutdown bypasses the circuit breaker — give every sink a final drain attempt
    wrapped.shutdown = async (deadlineMs) => {
      try {
        await sink.shutdown!(deadlineMs)
      } catch (err) {
        onError(sink.name, err)
      }
    }
  }
  return wrapped
}
