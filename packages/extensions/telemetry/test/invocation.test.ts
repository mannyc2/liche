import { describe, expect, test } from 'bun:test'
import { defineCli, defineCommand, outputControls, run, z } from '@liche/core'
import type { CliInstance } from '@liche/core'
import { telemetry } from '../src/index.js'
import { memorySink } from '../src/testing/index.js'

function buildStatusCli(): CliInstance {
  return defineCli({
    name: 'shipyard',
    version: '0.1.0',
    extensions: [outputControls({ json: true }), telemetry()],
    commands: [
      defineCommand({
        path: ['noop'],
        output: z.object({ ok: z.boolean() }),
        run: () => ({ ok: true }),
      }),
    ],
  })
}

async function runStatus(cli: CliInstance, env: Record<string, string | undefined>): Promise<{ invocation: string; enabled: boolean; reason: string; exitCode: number }> {
  let stdout = ''
  let exitCode = 0
  await run(cli, ['telemetry', 'status', '--json'], {
    env,
    isTty: false,
    stdout: (s) => {
      stdout += s
    },
    stderr: () => {},
    exit: (code) => {
      exitCode = code
    },
  })
  const parsed = JSON.parse(stdout) as { data: { invocation: string; enabled: boolean; reason: string } }
  return { ...parsed.data, exitCode }
}

describe('telemetry status — invocation detection via RunOptions.env', () => {
  test('LICHE_INVOCATION=cli wins even with CI markers in the same env', async () => {
    const cli = buildStatusCli()
    const result = await runStatus(cli, { LICHE_INVOCATION: 'cli', CI: 'true', GITHUB_ACTIONS: 'true' })
    expect(result.invocation).toBe('cli')
  })

  test('LICHE_INVOCATION=ci is honored when no CI markers are set', async () => {
    const cli = buildStatusCli()
    const result = await runStatus(cli, { LICHE_INVOCATION: 'ci' })
    expect(result.invocation).toBe('ci')
  })

  test('LICHE_INVOCATION=mcp round-trips through status output', async () => {
    const cli = buildStatusCli()
    const result = await runStatus(cli, { LICHE_INVOCATION: 'mcp' })
    expect(result.invocation).toBe('mcp')
  })

  test('LICHE_INVOCATION=agent round-trips through status output', async () => {
    const cli = buildStatusCli()
    const result = await runStatus(cli, { LICHE_INVOCATION: 'agent' })
    expect(result.invocation).toBe('agent')
  })

  test('invalid LICHE_INVOCATION falls back to CI-marker detection', async () => {
    const cli = buildStatusCli()
    const withCi = await runStatus(cli, { LICHE_INVOCATION: 'bogus', GITHUB_ACTIONS: 'true' })
    expect(withCi.invocation).toBe('ci')
    const withoutCi = await runStatus(cli, { LICHE_INVOCATION: 'bogus' })
    expect(withoutCi.invocation).toBe('cli')
  })

  test.each(['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'BUILDKITE', 'TF_BUILD'] as const)(
    'CI marker %s alone → invocation=ci',
    async (key) => {
      const cli = buildStatusCli()
      const result = await runStatus(cli, { [key]: 'true' })
      expect(result.invocation).toBe('ci')
    },
  )

  test('no LICHE_INVOCATION and no CI markers → invocation=cli', async () => {
    const cli = buildStatusCli()
    const result = await runStatus(cli, {})
    expect(result.invocation).toBe('cli')
  })

  test('falsy CI marker values do not flip detection', async () => {
    const cli = buildStatusCli()
    expect((await runStatus(cli, { CI: '0' })).invocation).toBe('cli')
    expect((await runStatus(cli, { CI: 'false' })).invocation).toBe('cli')
    expect((await runStatus(cli, { CI: '' })).invocation).toBe('cli')
  })
})

describe('telemetry status — ambient process env does not leak', () => {
  test('process.env CI markers are ignored when RunOptions.env omits them', async () => {
    const saved = process.env['CI']
    process.env['CI'] = 'true'
    try {
      const cli = buildStatusCli()
      const result = await runStatus(cli, { SHIPYARD_TELEMETRY: '1', LICHE_INVOCATION: 'cli' })
      expect(result.invocation).toBe('cli')
      expect(result.enabled).toBe(true)
      expect(result.reason).toBe('cli-enabled')
    } finally {
      if (saved === undefined) delete process.env['CI']
      else process.env['CI'] = saved
    }
  })

  test('process.env LICHE_TELEMETRY=0 does not leak into status when RunOptions.env enables', async () => {
    const saved = process.env['LICHE_TELEMETRY']
    process.env['LICHE_TELEMETRY'] = '0'
    try {
      const cli = buildStatusCli()
      const result = await runStatus(cli, { SHIPYARD_TELEMETRY: '1', LICHE_INVOCATION: 'cli' })
      expect(result.enabled).toBe(true)
      expect(result.reason).toBe('cli-enabled')
    } finally {
      if (saved === undefined) delete process.env['LICHE_TELEMETRY']
      else process.env['LICHE_TELEMETRY'] = saved
    }
  })
})

describe('telemetry event subscriber — invocation detection via TelemetryOptions.env', () => {
  test('event detector honors LICHE_INVOCATION from telemetry-configured env source', async () => {
    const telemetryEnv: Record<string, string | undefined> = {
      LICHE_INVOCATION: 'ci',
      LICHE_TELEMETRY_CI: '1',
    }
    const sink = memorySink()
    const cli = defineCli({
      name: 'shipyard',
      version: '0.1.0',
      extensions: [telemetry({ sinks: [sink], env: telemetryEnv, invocations: ['ci'] })],
      commands: [
        defineCommand({
          path: ['deploy'],
          output: z.object({ id: z.string() }),
          run: () => ({ id: 'dep-1' }),
        }),
      ],
    })

    let exitCode = 0
    await run(cli, ['deploy'], {
      env: {},
      isTty: false,
      stdout: () => {},
      stderr: () => {},
      exit: (code) => {
        exitCode = code
      },
    })
    expect(exitCode).toBe(0)
    expect(sink.events.length).toBeGreaterThan(0)
    expect(sink.events.map((e) => e.type)).toContain('command.completed')
  })

  test('event detector falls back to cli when no LICHE_INVOCATION and no CI markers', async () => {
    const telemetryEnv: Record<string, string | undefined> = { SHIPYARD_TELEMETRY: '1' }
    const sink = memorySink()
    const cli = defineCli({
      name: 'shipyard',
      version: '0.1.0',
      extensions: [telemetry({ sinks: [sink], env: telemetryEnv })],
      commands: [
        defineCommand({
          path: ['deploy'],
          output: z.object({ id: z.string() }),
          run: () => ({ id: 'dep-1' }),
        }),
      ],
    })

    await run(cli, ['deploy'], { env: {}, isTty: false, stdout: () => {}, stderr: () => {}, exit: () => {} })
    expect(sink.events.length).toBeGreaterThan(0)
  })
})
