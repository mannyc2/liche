import { describe, expect, test } from 'bun:test'
import { createRedactionPolicy } from '../src/internal/redact.js'
import { createValidator, type WireEvent } from '../src/internal/schema.js'

function fixture(): WireEvent {
  return {
    agent: false,
    cli: { name: 'shipyard', version: '0.1.0' },
    command: { id: 'deploy', path: ['deploy'] },
    durationMs: 12,
    exitCode: 0,
    format: 'json',
    formatExplicit: true,
    invocation: 'cli',
    occurredAt: '2026-05-21T00:00:00.000Z',
    result: 'success',
    surface: { kind: 'command', name: 'deploy' },
    type: 'command.completed',
    telemetry: {
      schemaVersion: 1,
      sessionId: 's1',
      runId: 'r1',
      sdk: { name: '@liche/telemetry', version: '1.0.0' },
      runtime: { name: 'bun', version: '1.3.9', platform: 'darwin', arch: 'arm64' },
    },
  }
}

function p(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
  return sorted[i]!
}

describe('sync-path performance budget (≤ 200 µs per event)', () => {
  test('redact + validate p99 stays under budget', () => {
    const policy = createRedactionPolicy()
    const validator = createValidator({ warn: () => {} })
    const event = fixture()
    const N = 10_000

    // warmup
    for (let i = 0; i < 1000; i += 1) {
      const redacted = policy.redact(event)
      validator.parse(redacted)
    }

    const samples = new Array<number>(N)
    for (let i = 0; i < N; i += 1) {
      const t0 = Bun.nanoseconds()
      const redacted = policy.redact(event)
      validator.parse(redacted)
      samples[i] = Bun.nanoseconds() - t0
    }

    const p50 = p(samples, 0.5)
    const p99 = p(samples, 0.99)
    // Budget: 200 µs = 200,000 ns
    expect(p99).toBeLessThan(200_000)
    if (process.env['TELEMETRY_PERF_LOG']) console.log(`p50=${p50}ns p99=${p99}ns over ${N} iters`)
  })
})
