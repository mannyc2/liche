import { describe, expect, test } from 'bun:test'
import { createLocalTelemetrySink } from '../src/telemetry.js'

describe('@liche/extensions/telemetry local sink', () => {
  test('writes JSONL only when opted in and redacts secret-shaped fields', async () => {
    const writes: string[] = []
    const sink = createLocalTelemetrySink({
      env: { LICHE_TELEMETRY: '1', LICHE_TELEMETRY_FILE: '/tmp/liche-telemetry.jsonl' },
      append: (_path, text) => {
        writes.push(text)
      },
    })

    await sink({
      agent: false,
      cli: { name: 'shipyard' },
      command: { id: 'deploy', path: ['deploy'] },
      format: 'json',
      formatExplicit: true,
      invocation: 'cli',
      occurredAt: '2026-05-21T00:00:00.000Z',
      surface: { kind: 'command' },
      type: 'command.completed',
      result: 'success',
      token: 'secret-token',
      authorization: 'Bearer secret-token',
    } as any)

    expect(writes).toHaveLength(1)
    expect(writes[0]).not.toContain('secret-token')
    expect(writes[0]).toContain('[redacted]')
  })

  test('does nothing without explicit opt-in', async () => {
    const writes: string[] = []
    const sink = createLocalTelemetrySink({
      env: { LICHE_TELEMETRY_FILE: '/tmp/liche-telemetry.jsonl' },
      append: (_path, text) => {
        writes.push(text)
      },
    })

    await sink({
      agent: false,
      cli: { name: 'shipyard' },
      format: 'json',
      formatExplicit: true,
      invocation: 'cli',
      occurredAt: '2026-05-21T00:00:00.000Z',
      type: 'version.rendered',
    })

    expect(writes).toEqual([])
  })

  test('redaction handles nested token fields and bearer strings', async () => {
    const writes: string[] = []
    const sink = createLocalTelemetrySink({
      env: { LICHE_TELEMETRY: '1', LICHE_TELEMETRY_FILE: '/tmp/liche-telemetry.jsonl' },
      append: (_path, text) => {
        writes.push(text)
      },
    })

    await sink({
      agent: false,
      cli: { name: 'shipyard' },
      format: 'json',
      formatExplicit: true,
      invocation: 'cli',
      occurredAt: '2026-05-21T00:00:00.000Z',
      type: 'version.rendered',
      nested: { apiKey: 'abc123' },
      message: 'Authorization: Bearer abc123',
    } as any)

    expect(JSON.parse(writes[0]!)).toMatchObject({
      nested: { apiKey: '[redacted]' },
      message: 'Authorization: Bearer [redacted]',
    })
  })
})
