import { describe, expect, test } from 'bun:test'
import { createValidator, wireEventSchema, type WireEvent } from '../src/internal/schema.js'

function validEvent(overrides: Partial<WireEvent> = {}): WireEvent {
  return {
    agent: false,
    cli: { name: 'shipyard', version: '0.1.0' },
    format: 'json',
    formatExplicit: true,
    invocation: 'cli',
    occurredAt: '2026-05-21T00:00:00.000Z',
    type: 'command.completed',
    telemetry: {
      schemaVersion: 1,
      sessionId: 'sess-1',
      runId: 'run-1',
      sdk: { name: '@liche/telemetry', version: '1.0.0' },
      runtime: { name: 'bun', version: '1.3.9', platform: 'darwin', arch: 'arm64' },
    },
    ...overrides,
  } as WireEvent
}

describe('wireEventSchema', () => {
  test('accepts a minimal valid event', () => {
    const result = wireEventSchema.safeParse(validEvent())
    expect(result.success).toBe(true)
  })

  test('accepts every CliEventType', () => {
    const types = [
      'command.selected',
      'command.started',
      'command.completed',
      'command.failed',
      'validation.failed',
      'parse.failed',
      'command.not_found',
      'help.rendered',
      'version.rendered',
      'completion.generated',
      'schema.generated',
      'mcp.initialize',
      'mcp.tools_listed',
      'mcp.tool_call.started',
      'mcp.tool_call.completed',
      'mcp.tool_call.failed',
      'hook.failed',
    ] as const
    for (const type of types) {
      const result = wireEventSchema.safeParse(validEvent({ type }))
      expect(result.success).toBe(true)
    }
  })

  test('accepts events with command, error, mcp, surface, result, durationMs, exitCode', () => {
    const result = wireEventSchema.safeParse(
      validEvent({
        command: { id: 'deploy', path: ['deploy'] },
        durationMs: 123,
        exitCode: 0,
        result: 'success',
        surface: { kind: 'command', name: 'deploy' },
        error: { code: 'X', exitCode: 1, retryable: false },
        mcp: { method: 'tools/call', toolCount: 3 },
      }),
    )
    expect(result.success).toBe(true)
  })

  test('rejects missing required fields', () => {
    const result = wireEventSchema.safeParse({ ...validEvent(), occurredAt: undefined })
    expect(result.success).toBe(false)
  })

  test('rejects invalid invocation enum', () => {
    const result = wireEventSchema.safeParse({ ...validEvent(), invocation: 'desktop' })
    expect(result.success).toBe(false)
  })

  test('rejects missing telemetry envelope', () => {
    const { telemetry: _t, ...rest } = validEvent() as Record<string, unknown>
    void _t
    const result = wireEventSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  test('rejects schemaVersion other than 1', () => {
    const v = validEvent()
    const result = wireEventSchema.safeParse({ ...v, telemetry: { ...v.telemetry, schemaVersion: 2 } })
    expect(result.success).toBe(false)
  })
})

describe('createValidator', () => {
  test('returns ok on valid input', () => {
    const v = createValidator({ warn: () => {} })
    const result = v.parse(validEvent())
    expect(result.ok).toBe(true)
    expect(v.stats.dropped).toBe(0)
  })

  test('returns ok=false and increments dropped on invalid input', () => {
    const warnings: string[] = []
    const v = createValidator({ warn: (m) => warnings.push(m) })
    const result = v.parse({ type: 'command.completed', missing: 'most-fields' })
    expect(result.ok).toBe(false)
    expect(v.stats.dropped).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('[telemetry] validation.dropped')
    expect(warnings[0]).toContain('command.completed')
  })

  test('warn rate-limited to once per event.type per process', () => {
    const warnings: string[] = []
    const v = createValidator({ warn: (m) => warnings.push(m) })
    for (let i = 0; i < 50; i += 1) {
      v.parse({ type: 'command.completed', missing: 'fields' })
    }
    expect(v.stats.dropped).toBe(50)
    expect(warnings).toHaveLength(1)
  })

  test('different event types each warn once', () => {
    const warnings: string[] = []
    const v = createValidator({ warn: (m) => warnings.push(m) })
    v.parse({ type: 'command.completed', missing: 'fields' })
    v.parse({ type: 'command.completed', missing: 'fields' })
    v.parse({ type: 'command.failed', missing: 'fields' })
    v.parse({ type: 'command.failed', missing: 'fields' })
    v.parse({ type: 'help.rendered', missing: 'fields' })
    expect(warnings).toHaveLength(3)
    expect(v.stats.dropped).toBe(5)
  })

  test('missing type still produces one warning with <unknown> identifier', () => {
    const warnings: string[] = []
    const v = createValidator({ warn: (m) => warnings.push(m) })
    v.parse({ no: 'type' })
    v.parse({ also: 'no-type' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('<unknown>')
  })

  test('valid events flow after a dropped one (no poisoning)', () => {
    const v = createValidator({ warn: () => {} })
    v.parse({ type: 'command.completed', missing: 'fields' })
    const ok = v.parse(validEvent())
    expect(ok.ok).toBe(true)
  })

  test('default warn uses console.warn (smoke — does not throw)', () => {
    const v = createValidator()
    expect(() => v.parse({ type: 'command.completed', missing: 'fields' })).not.toThrow()
  })
})
