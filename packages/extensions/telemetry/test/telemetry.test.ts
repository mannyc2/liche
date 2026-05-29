import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, run, z } from '@liche/core'
import { telemetry, type WireEvent } from '../src/index.js'
import { memorySink } from '../src/testing/index.js'

function buildCli(env: Record<string, string | undefined>, telemetryOpts: Parameters<typeof telemetry>[0] = {}): ReturnType<typeof defineCli> {
  return defineCli({
    name: 'shipyard',
    version: '0.1.0',
    extensions: [telemetry({ ...telemetryOpts, env: telemetryOpts.env ?? env })],
    commands: [
      defineCommand({
        path: ['deploy'],
        summary: 'Deploy a service',
        output: z.object({ id: z.string() }),
        run: () => ({ id: 'dep-1' }),
      }),
    ],
  })
}

async function runSilent(cli: ReturnType<typeof defineCli>, argv: string[], env: Record<string, string | undefined>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await run(cli, argv, {
    env,
    streams: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    stdout: (s) => {
      stdout += s
    },
    stderr: (s) => {
      stderr += s
    },
    exit: (code) => {
      exitCode = code
    },
  })
  return { stdout, stderr, exitCode }
}

describe('opt-in by default', () => {
  test('no env vars set → no events emitted', async () => {
    const env = {}
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink] })
    await runSilent(cli, ['deploy'], env)
    expect(sink.events).toHaveLength(0)
  })

  test('SHIPYARD_TELEMETRY=1 enables for cli invocation', async () => {
    const env = { SHIPYARD_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink] })
    await runSilent(cli, ['deploy'], env)
    expect(sink.events.length).toBeGreaterThan(0)
    expect(sink.events.map((e) => e.type)).toContain('command.completed')
  })

  test('LICHE_TELEMETRY=1 enables for cli invocation', async () => {
    const env = { LICHE_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink] })
    await runSilent(cli, ['deploy'], env)
    expect(sink.events.length).toBeGreaterThan(0)
  })

  test('env function is resolved at invocation time', async () => {
    const env: Record<string, string | undefined> = {}
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink], env: () => env })
    env['SHIPYARD_TELEMETRY'] = '1'
    await runSilent(cli, ['deploy'], env)
    expect(sink.events.map((e) => e.type)).toContain('command.completed')
  })
})

describe('kill switches', () => {
  test('DO_NOT_TRACK overrides per-CLI enable', async () => {
    const env = { SHIPYARD_TELEMETRY: '1', DO_NOT_TRACK: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink] })
    await runSilent(cli, ['deploy'], env)
    expect(sink.events).toHaveLength(0)
  })

  test('LICHE_TELEMETRY=0 overrides per-CLI enable', async () => {
    const env = { SHIPYARD_TELEMETRY: '1', LICHE_TELEMETRY: '0' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink] })
    await runSilent(cli, ['deploy'], env)
    expect(sink.events).toHaveLength(0)
  })
})

describe('event allowlist (CORE-OBS-004)', () => {
  test('default "essential" preset includes terminal events', async () => {
    const env = { SHIPYARD_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink] })
    await runSilent(cli, ['deploy'], env)
    expect(sink.events.map((e) => e.type)).toContain('command.completed')
  })

  test('custom allowlist filters events', async () => {
    const env = { SHIPYARD_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink], events: ['command.failed'] })
    await runSilent(cli, ['deploy'], env)
    expect(sink.events).toHaveLength(0)
  })

  test('"errors-only" preset emits no events on success', async () => {
    const env = { SHIPYARD_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink], events: 'errors-only' })
    await runSilent(cli, ['deploy'], env)
    expect(sink.events).toHaveLength(0)
  })
})

describe('enrichment (telemetry envelope)', () => {
  test('events carry telemetry.{schemaVersion, sessionId, runId, sdk, runtime}', async () => {
    const env = { SHIPYARD_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink] })
    await runSilent(cli, ['deploy'], env)
    const completed = sink.events.find((e) => e.type === 'command.completed') as WireEvent | undefined
    expect(completed).toBeDefined()
    expect(completed!.telemetry.schemaVersion).toBe(1)
    expect(typeof completed!.telemetry.sessionId).toBe('string')
    expect(completed!.telemetry.sdk.name).toBe('@liche/telemetry')
    expect(completed!.telemetry.runtime.name).toBe('bun')
    expect(completed!.telemetry.runtime.platform).toBe(process.platform)
  })

  test('sessionId is stable across events in one run', async () => {
    const env = { SHIPYARD_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink] })
    await runSilent(cli, ['deploy'], env)
    const sessions = new Set(sink.events.map((e) => e.telemetry.sessionId))
    expect(sessions.size).toBe(1)
  })
})

describe('telemetry subcommands', () => {
  test('telemetry status returns resolved consent', async () => {
    const env = { SHIPYARD_TELEMETRY: '1' }
    const cli = buildCli(env)
    const { stdout } = await runSilent(cli, ['telemetry', 'status'], env)
    const parsed = JSON.parse(stdout).data
    expect(parsed.enabled).toBe(true)
    expect(parsed.reason).toBe('cli-enabled')
  })

  test('telemetry status reports disabled by default', async () => {
    const env = {}
    const cli = buildCli(env)
    const { stdout } = await runSilent(cli, ['telemetry', 'status'], env)
    const parsed = JSON.parse(stdout).data
    expect(parsed.enabled).toBe(false)
    expect(parsed.reason).toBe('no-consent')
  })

  test('telemetry enable prints the env var', async () => {
    const env = {}
    const cli = buildCli(env)
    const { stdout } = await runSilent(cli, ['telemetry', 'enable'], env)
    const parsed = JSON.parse(stdout).data
    expect(parsed.envVar).toBe('SHIPYARD_TELEMETRY')
    expect(parsed.instructions).toContain('export SHIPYARD_TELEMETRY=1')
  })

  test('telemetry disable prints kill switches', async () => {
    const env = {}
    const cli = buildCli(env)
    const { stdout } = await runSilent(cli, ['telemetry', 'disable'], env)
    const parsed = JSON.parse(stdout).data
    expect(parsed.instructions).toContain('DO_NOT_TRACK=1')
  })

  test('telemetry inspect prints LICHE_TELEMETRY_DEBUG recipe', async () => {
    const env = {}
    const cli = buildCli(env)
    const { stdout } = await runSilent(cli, ['telemetry', 'inspect'], env)
    const parsed = JSON.parse(stdout).data
    expect(parsed.instructions).toContain('LICHE_TELEMETRY_DEBUG=stderr')
  })
})

describe('debug mode', () => {
  test('LICHE_TELEMETRY_DEBUG=stderr installs a stderr console sink', async () => {
    const env = { SHIPYARD_TELEMETRY: '1', LICHE_TELEMETRY_DEBUG: 'stderr' }
    const cli = buildCli(env, { events: 'all' })
    const original = process.stderr.write.bind(process.stderr)
    const captured: string[] = []
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    }) as unknown as typeof process.stderr.write
    try {
      await runSilent(cli, ['deploy'], env)
    } finally {
      process.stderr.write = original as typeof process.stderr.write
    }
    const all = captured.join('')
    expect(all).toContain('[telemetry]')
    expect(all).toContain('command.completed')
  })
})

describe('redaction', () => {
  test('events carry no Bearer-prefixed strings after redaction', async () => {
    const env = { SHIPYARD_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = buildCli(env, { sinks: [sink], events: 'all' })
    await runSilent(cli, ['deploy'], env)
    for (const event of sink.events) {
      expect(JSON.stringify(event)).not.toContain('Bearer ')
    }
  })
})
