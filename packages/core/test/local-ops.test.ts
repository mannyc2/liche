import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { createLocalTelemetrySink, runLocalDoctor } from '../src/index.js'

describe('local ops doctor', () => {
  test('reports PATH and package-manager checks as structured diagnostics', async () => {
    const root = mkdtempSync(join(tmpdir(), 'liche-doctor-'))
    const bin = join(root, 'bin')
    const localBin = join(root, 'node_modules', '.bin')
    try {
      await Bun.$`mkdir -p ${bin} ${localBin}`
      writeFileSync(join(bin, 'bun'), '#!/bin/sh\n')
      writeFileSync(join(localBin, 'npm'), '#!/bin/sh\n')

      const report = await runLocalDoctor({
        cliName: 'shipyard',
        version: '1.0.0',
        env: { PATH: [bin, localBin].join(delimiter) },
        packageManagers: ['bun', 'npm', 'pnpm'],
      })

      expect(report.cli).toEqual({ name: 'shipyard', version: '1.0.0' })
      expect(report.checks.find((check) => check.id === 'path.present')?.status).toBe('pass')
      expect(report.checks.find((check) => check.id === 'path.local-bin')?.status).toBe('pass')
      expect(report.checks.find((check) => check.id === 'package-manager.bun')?.status).toBe('pass')
      expect(report.checks.find((check) => check.id === 'package-manager.npm')?.status).toBe('pass')
      expect(report.checks.find((check) => check.id === 'package-manager.pnpm')?.status).toBe('warn')
      expect(report.summary).toEqual({ pass: 4, warn: 1, fail: 0 })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('empty PATH fails the required PATH and Bun checks', async () => {
    const report = await runLocalDoctor({
      cliName: 'shipyard',
      env: { PATH: '' },
      packageManagers: ['bun'],
    })

    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ['path.present', 'fail'],
      ['path.local-bin', 'warn'],
      ['package-manager.bun', 'fail'],
    ])
    expect(report.summary).toEqual({ pass: 0, warn: 1, fail: 2 })
  })
})

describe('local telemetry sink', () => {
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
