import { describe, expect, test } from 'bun:test'
import {
  consoleSink,
  httpSink,
  jsonlFileSink,
  noopSink,
  wrapSink,
  type TelemetrySink,
} from '../src/internal/sinks.js'
import type { WireEvent } from '../src/internal/schema.js'

function event(overrides: Partial<WireEvent> = {}): WireEvent {
  return {
    isTty: false,
    cli: { name: 'shipyard', version: '0.1.0' },
    format: 'json',
    formatExplicit: true,
    occurredAt: '2026-05-21T00:00:00.000Z',
    type: 'command.completed',
    durationMs: 12,
    exitCode: 0,
    result: 'success',
    telemetry: {
      schemaVersion: 1,
      sessionId: 's1',
      runId: 'r1',
      sdk: { name: '@liche/telemetry', version: '1.0.0' },
      runtime: { name: 'bun', version: '1.3.9', platform: 'darwin', arch: 'arm64' },
    },
    ...overrides,
  } as WireEvent
}

describe('jsonlFileSink', () => {
  test('appends one JSON line per emit', async () => {
    const writes: Array<{ path: string; text: string }> = []
    const sink = jsonlFileSink({ path: '/tmp/t.jsonl', append: (path, text) => void writes.push({ path, text }) })
    await sink.emit(event())
    await sink.emit(event({ type: 'command.failed' }))
    expect(writes).toHaveLength(2)
    expect(writes[0]!.path).toBe('/tmp/t.jsonl')
    expect(writes[0]!.text.endsWith('\n')).toBe(true)
    expect(JSON.parse(writes[0]!.text)).toMatchObject({ type: 'command.completed' })
    expect(JSON.parse(writes[1]!.text)).toMatchObject({ type: 'command.failed' })
  })
})

describe('consoleSink', () => {
  test('emits prefixed JSON line via injected write', () => {
    const out: string[] = []
    const sink = consoleSink({ write: (text) => out.push(text) })
    sink.emit(event())
    expect(out).toHaveLength(1)
    expect(out[0]!.startsWith('[telemetry] ')).toBe(true)
    expect(JSON.parse(out[0]!.replace(/^\[telemetry\] /, ''))).toMatchObject({ type: 'command.completed' })
  })
})

describe('noopSink', () => {
  test('does nothing', () => {
    expect(noopSink().emit(event())).toBeUndefined()
  })
})

describe('httpSink', () => {
  type Call = { url: string; init: RequestInit }
  function fakeFetch(responses: Array<Response | Error>): { calls: Call[]; fetch: typeof fetch } {
    const calls: Call[] = []
    let i = 0
    return {
      calls,
      fetch: (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init: init ?? {} })
        const next = responses[i++ % responses.length]
        if (next instanceof Error) throw next
        return next!
      }) as unknown as typeof fetch,
    }
  }

  test('happy path — POSTs JSON body with batched events', async () => {
    const { calls, fetch: f } = fakeFetch([new Response('', { status: 200 })])
    const sink = httpSink({ url: 'https://example.test/ingest', batchSize: 2, flushMs: 10000, fetch: f })
    await sink.emit(event())
    await sink.emit(event({ type: 'command.failed' }))
    // batchSize hit → POST fires
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toHaveLength(1)
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.events).toHaveLength(2)
  })

  test('flush() drains buffer immediately', async () => {
    const { calls, fetch: f } = fakeFetch([new Response('', { status: 200 })])
    const sink = httpSink({ url: 'https://example.test/ingest', batchSize: 100, flushMs: 10000, fetch: f })
    await sink.emit(event())
    expect(calls).toHaveLength(0)
    await sink.flush!(5000)
    expect(calls).toHaveLength(1)
  })

  test('5xx retries once with delay', async () => {
    const { calls, fetch: f } = fakeFetch([new Response('', { status: 503 }), new Response('', { status: 200 })])
    const sink = httpSink({ url: 'https://example.test/ingest', batchSize: 1, fetch: f, retry: { delayMs: 1, maxAttempts: 2 } })
    await sink.emit(event())
    expect(calls).toHaveLength(2)
  })

  test('4xx drops without retry', async () => {
    const { calls, fetch: f } = fakeFetch([new Response('', { status: 400 })])
    const sink = httpSink({ url: 'https://example.test/ingest', batchSize: 1, fetch: f, retry: { delayMs: 1, maxAttempts: 2 } })
    await sink.emit(event())
    expect(calls).toHaveLength(1)
  })

  test('network error retries once then drops', async () => {
    const { calls, fetch: f } = fakeFetch([new Error('ECONNRESET'), new Error('ECONNRESET')])
    const sink = httpSink({ url: 'https://example.test/ingest', batchSize: 1, fetch: f, retry: { delayMs: 1, maxAttempts: 2 } })
    await sink.emit(event())
    expect(calls).toHaveLength(2)
  })

  test('429 honors Retry-After and blocks subsequent emits during window', async () => {
    const { calls, fetch: f } = fakeFetch([
      new Response('', { status: 429, headers: { 'retry-after': '0.05' } }),
    ])
    const sink = httpSink({ url: 'https://example.test/ingest', batchSize: 1, fetch: f })
    await sink.emit(event())
    expect(calls).toHaveLength(1)
    // Within blocked window — subsequent emit's POST is skipped
    await sink.emit(event())
    expect(calls).toHaveLength(1)
    await new Promise((r) => setTimeout(r, 70))
    await sink.emit(event())
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  test('OTLP format produces resourceLogs envelope', async () => {
    const { calls, fetch: f } = fakeFetch([new Response('', { status: 200 })])
    const sink = httpSink({ url: 'https://example.test/v1/logs', batchSize: 1, format: 'otlp', fetch: f })
    await sink.emit(event())
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.resourceLogs).toBeDefined()
    expect(body.resourceLogs[0].scopeLogs[0].logRecords[0].body.stringValue).toBe('command.completed')
    expect(body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes).toContainEqual({ key: 'cli.result', value: { stringValue: 'success' } })
  })
})

describe('wrapSink — isolation and circuit breaker', () => {
  function throwingSink(name = 'throwing'): TelemetrySink {
    return {
      name,
      emit() {
        throw new Error('boom')
      },
    }
  }

  test('catches synchronous throws', async () => {
    const errs: Array<{ name: string; err: unknown }> = []
    const wrapped = wrapSink(throwingSink(), { onError: (name, err) => errs.push({ name, err }) })
    await wrapped.emit(event())
    expect(errs).toHaveLength(1)
    expect(errs[0]!.name).toBe('throwing')
  })

  test('one sink failure does not poison sibling fan-out', async () => {
    const okWrites: WireEvent[] = []
    const ok = wrapSink({ name: 'ok', emit: (e) => void okWrites.push(e) })
    const bad = wrapSink(throwingSink())
    await Promise.allSettled([ok.emit(event()), bad.emit(event())])
    expect(okWrites).toHaveLength(1)
    expect(ok.stats().failures).toBe(0)
    expect(bad.stats().failures).toBe(1)
  })

  test('trips after 3 consecutive failures and stops calling emit', async () => {
    let calls = 0
    const sink: TelemetrySink = {
      name: 'flaky',
      emit() {
        calls += 1
        throw new Error('fail')
      },
    }
    const wrapped = wrapSink(sink, { threshold: 3 })
    for (let i = 0; i < 10; i += 1) await wrapped.emit(event())
    expect(calls).toBe(3)
    expect(wrapped.stats().tripped).toBe(true)
  })

  test('consecutive failure counter resets on success', async () => {
    let mode: 'fail' | 'ok' = 'fail'
    const sink: TelemetrySink = {
      name: 'mixed',
      emit() {
        if (mode === 'fail') throw new Error('x')
      },
    }
    const wrapped = wrapSink(sink, { threshold: 3 })
    await wrapped.emit(event())
    await wrapped.emit(event())
    mode = 'ok'
    await wrapped.emit(event())
    expect(wrapped.stats().failures).toBe(0)
    expect(wrapped.stats().tripped).toBe(false)
    mode = 'fail'
    await wrapped.emit(event())
    await wrapped.emit(event())
    await wrapped.emit(event())
    expect(wrapped.stats().tripped).toBe(true)
  })

  test('shutdown bypasses circuit breaker for final drain', async () => {
    let shutdownCalls = 0
    const sink: TelemetrySink = {
      name: 'tripped-but-drains',
      emit() {
        throw new Error('x')
      },
      async shutdown() {
        shutdownCalls += 1
      },
    }
    const wrapped = wrapSink(sink, { threshold: 1 })
    await wrapped.emit(event())
    expect(wrapped.stats().tripped).toBe(true)
    await wrapped.shutdown!(1000)
    expect(shutdownCalls).toBe(1)
  })
})
