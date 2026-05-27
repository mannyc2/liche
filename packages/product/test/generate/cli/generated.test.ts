import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '@liche/core'
import type { RunOptions } from '@liche/core'
import {
  Auth,
  Command,
  Field,
  Runtime,
  Shape,
  canonicalDigest,
  defineProduct,
  generateCli,
  normalizeProduct,
} from '../../../src/index.js'
import type { RuntimeProduct } from '../../../src/index.js'
import workersProduct from '../../fixtures/workers.product.js'
import workersGenerated from '../../fixtures/workers.generated.js'
import workersHandwritten from '../../fixtures/workers.handwritten.js'

const FIXTURE_DIR = join(import.meta.dir, '..', '..', 'fixtures')
type GeneratedCli = typeof workersGenerated

type CapturedRun = { stdout: string; stderr: string; exitCode: number }

async function readEventually(path: string, timeoutMs = 1000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() < deadline) {
    try {
      const text = readFileSync(path, 'utf8')
      if (text.trim()) return text
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`Timed out waiting for ${path}`)
}

async function runCli(
  cli: GeneratedCli,
  argv: string[],
  options: Omit<RunOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<CapturedRun> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await run(cli, argv, {
    ...options,
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
    exit: (code) => { exitCode = code },
    isTty: options.isTty ?? false,
  })
  return { stdout, stderr, exitCode }
}

async function generateTempCli(product: RuntimeProduct): Promise<{ cli: GeneratedCli; dir: string }> {
  const root = join(import.meta.dir, '.tmp')
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, 'generated-'))
  const catalog = normalizeProduct(product)
  const source = generateCli(catalog, {
    generatorVersion: 'test',
    canonicalIrDigest: canonicalDigest(catalog),
    generationOptionsDigest: canonicalDigest({ surfaceId: 'cli' }),
  })
  const path = join(dir, 'generated.ts')
  writeFileSync(path, source)
  const mod = await import(`${path}?t=${Date.now()}-${Math.random()}`) as { default: GeneratedCli }
  return { cli: mod.default, dir }
}

describe('generated CLI — source matches golden', () => {
  test('generator output equals checked-in fixtures/workers.generated.ts', () => {
    const catalog = normalizeProduct(workersProduct)
    const inputDigest = canonicalDigest(catalog)
    const optionsDigest = canonicalDigest({
      surfaceId: 'cli',
      generatedFileName: 'workers.generated.ts',
      manifestFileName: 'workers.generated.manifest.json',
    })
    const source = generateCli(catalog, {
      generatorVersion: '0.0.0',
      canonicalIrDigest: inputDigest,
      generationOptionsDigest: optionsDigest,
      surfaceId: 'cli',
    })
    const golden = readFileSync(join(FIXTURE_DIR, 'workers.generated.ts'), 'utf8')
    expect(source).toBe(golden)
  })
})

describe('generated CLI — boundary discipline', () => {
  test('generated source imports only public @liche/core APIs required by the fixture', () => {
    const source = readFileSync(join(FIXTURE_DIR, 'workers.generated.ts'), 'utf8')
    const coreImports = [...source.matchAll(/from '@liche\/core'/g)]
    expect(coreImports).toHaveLength(1)
    const importLine = source.match(/import \{ ([^}]+) \} from '@liche\/core'/)
    expect(importLine?.[1]).toBe('callHttpOperation, defineCli, defineCommand, help, outputControls, reflectionControls, version, z')
    expect(source).toContain(`import { llms } from '@liche/agents'`)
    expect(source).toContain(`import { config as configExtension, configDoctor, files } from '@liche/config'`)
    expect(source).toContain(`import { jsonlFileSink, telemetry } from '@liche/telemetry'`)
    expect(source).toContain(`async function runGeneratedLocalDoctor`)
    expect(source).not.toContain(`@liche/extensions/support`)
    expect(source).not.toContain(`runLocalDoctor`)
  })

  test('generated source does not import from @liche/core subpaths or internals', () => {
    const source = readFileSync(join(FIXTURE_DIR, 'workers.generated.ts'), 'utf8')
    expect(source).not.toContain('@liche/core/')
    expect(source).not.toContain('stateSymbol')
    expect(source).not.toContain('InternalCli')
  })

  test('generated header records source=catalog and product@version', () => {
    const source = readFileSync(join(FIXTURE_DIR, 'workers.generated.ts'), 'utf8')
    expect(source).toContain(' * product: workers@1.0.0')
    expect(source).toContain(' * source: catalog')
  })
})

describe('generated CLI — runtime parity with handwritten', () => {
  test('deploy returns identical JSON envelope as handwritten', async () => {
    const argv = ['deploy', '--entrypoint', 'src/index.ts', '--json']
    const gen = await runCli(workersGenerated, argv)
    const hand = await runCli(workersHandwritten, argv)
    expect(gen.exitCode).toBe(0)
    expect(hand.exitCode).toBe(0)
    const genJson = JSON.parse(gen.stdout)
    const handJson = JSON.parse(hand.stdout)
    expect(genJson).toEqual(handJson)
    expect(genJson.ok).toBe(true)
    expect(genJson.data).toEqual({
      deployment_id: 'dep-src/index.ts-preview',
      url: 'https://preview.example.com',
    })
    expect(genJson.meta).toEqual({
      execution: { mode: 'hybrid-workflow', source: 'schema-default' },
    })
  })

  test('dev returns identical JSON envelope as handwritten', async () => {
    const argv = ['dev', '--entrypoint', 'src/server.ts', '--json']
    const gen = await runCli(workersGenerated, argv)
    const hand = await runCli(workersHandwritten, argv)
    const genJson = JSON.parse(gen.stdout)
    const handJson = JSON.parse(hand.stdout)
    expect(genJson).toEqual(handJson)
    expect(genJson.data).toEqual({ url: 'http://localhost:8787?entry=src/server.ts' })
    expect(genJson.meta).toEqual({
      execution: { mode: 'local', source: 'schema-default' },
    })
  })

  test('script list resolves apiBaseUrl from config and calls remote HTTP transport', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe('/')
        return Response.json([
          { id: 'script-1', name: 'Worker One', created_at: '2026-05-20T00:00:00.000Z' },
        ])
      },
    })
    const dir = mkdtempSync(join(tmpdir(), 'liche-workers-config-'))
    const configPath = join(dir, 'workers.jsonc')
    try {
      writeFileSync(configPath, JSON.stringify({ apiBaseUrl: server.url.origin }))
      const gen = await runCli(workersGenerated, ['--config', configPath, 'script', 'list', '--json'])
      const env = JSON.parse(gen.stdout)
      expect(gen.exitCode).toBe(0)
      expect(env).toEqual({
        ok: true,
        data: [{ id: 'script-1', name: 'Worker One', created_at: '2026-05-20T00:00:00.000Z' }],
        error: null,
        meta: { execution: { mode: 'remote-http', source: 'config' } },
      })
    } finally {
      rmSync(dir, { force: true, recursive: true })
      server.stop(true)
    }
  })

  test('remote-http command uses a literal base URL and sends a JSON body', async () => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        expect(request.method).toBe('POST')
        expect(new URL(request.url).pathname).toBe('/ping')
        expect(await request.json()).toEqual({ name: 'Ada' })
        return Response.json({ ok: true, name: 'Ada' })
      },
    })
    const generated = await generateTempCli(defineProduct({
      id: 'literal-remote',
      name: 'Literal Remote',
      version: '1.0.0',
      auth: Auth.none(),
      remote: { baseUrl: Runtime.literal(server.url.origin) },
      commands: {
        ping: Command.remoteHttp({
          summary: 'Ping',
          input: Shape.object({ name: Field.string('Name') }),
          output: Shape.object({ ok: Field.boolean('OK'), name: Field.string('Name') }),
          http: { method: 'POST', path: '/ping', bind: { body: true } },
        }),
      },
    }))
    try {
      const out = await runCli(generated.cli, ['ping', '--name', 'Ada', '--json'])
      expect(out.exitCode).toBe(0)
      expect(JSON.parse(out.stdout)).toEqual({
        ok: true,
        data: { ok: true, name: 'Ada' },
        error: null,
        meta: { execution: { mode: 'remote-http', source: 'schema-default' } },
      })
    } finally {
      server.stop(true)
      rmSync(generated.dir, { force: true, recursive: true })
    }
  })

  test('remote-http command resolves env base URL and fails clearly when missing', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.method).toBe('GET')
        expect(new URL(request.url).pathname).toBe('/status')
        return Response.json({ ready: true })
      },
    })
    const generated = await generateTempCli(defineProduct({
      id: 'env-remote',
      name: 'Env Remote',
      version: '1.0.0',
      auth: Auth.none(),
      remote: { baseUrl: Runtime.env('REMOTE_API_BASE_URL') },
      commands: {
        status: Command.remoteHttp({
          summary: 'Status',
          output: Shape.object({ ready: Field.boolean('Ready') }),
          http: { method: 'GET', path: '/status' },
        }),
      },
    }))
    try {
      const ok = await runCli(generated.cli, ['status', '--json'], {
        env: { REMOTE_API_BASE_URL: server.url.origin },
      })
      expect(ok.exitCode).toBe(0)
      expect(JSON.parse(ok.stdout).meta).toEqual({ execution: { mode: 'remote-http', source: 'env' } })

      const missing = await runCli(generated.cli, ['status', '--json'], { env: {} })
      expect(missing.exitCode).toBe(1)
      const body = JSON.parse(missing.stdout)
      expect(body.error.code).toBe('REMOTE_CONFIG_MISSING_BASE_URL')
      expect(body.error.suggested_fix).toContain('REMOTE_API_BASE_URL')
    } finally {
      server.stop(true)
      rmSync(generated.dir, { force: true, recursive: true })
    }
  })

  test('remote-http command returns structured auth, HTTP status, and schema errors', async () => {
    let mode: 'status' | 'schema' = 'status'
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.headers.get('authorization')).toBe('Bearer secret-token')
        if (mode === 'schema') return Response.json({ ok: 'yes' })
        return Response.json({ error: 'bad token', token: 'secret-token' }, { status: 500 })
      },
    })
    const generated = await generateTempCli(defineProduct({
      id: 'auth-remote',
      name: 'Auth Remote',
      version: '1.0.0',
      auth: Auth.bearer({ id: 'acme', sources: [Auth.token.env('ACME_TOKEN')] }),
      remote: { baseUrl: Runtime.literal(server.url.origin) },
      commands: {
        purge: Command.remoteHttp({
          summary: 'Purge',
          input: Shape.object({ zone: Field.string('Zone') }),
          output: Shape.object({ ok: Field.boolean('OK') }),
          requires: { auth: true },
          http: { method: 'POST', path: '/zones/{zone}/purge', bind: { path: ['zone'], body: [] } },
        }),
      },
    }))
    try {
      const auth = await runCli(generated.cli, ['purge', '--zone', 'zone-a', '--json'], { env: {} })
      expect(auth.exitCode).toBe(1)
      expect(JSON.parse(auth.stdout).error.code).toBe('AUTH_MISSING')

      const status = await runCli(generated.cli, ['purge', '--zone', 'zone-a', '--json'], {
        env: { ACME_TOKEN: 'secret-token' },
      })
      expect(status.exitCode).toBe(1)
      const statusText = status.stdout
      expect(statusText).not.toContain('secret-token')
      const statusBody = JSON.parse(statusText)
      expect(statusBody.error.code).toBe('REMOTE_HTTP_STATUS')
      expect(statusBody.error.details.bodyPreview).toContain('[redacted]')

      mode = 'schema'
      const schema = await runCli(generated.cli, ['purge', '--zone', 'zone-a', '--json'], {
        env: { ACME_TOKEN: 'secret-token' },
      })
      expect(schema.exitCode).toBe(1)
      expect(JSON.parse(schema.stdout).error.code).toBe('REMOTE_RESPONSE_SCHEMA')
    } finally {
      server.stop(true)
      rmSync(generated.dir, { force: true, recursive: true })
    }
  })

  test('--format json is rejected on generated CLIs', async () => {
    const out = await runCli(workersGenerated, ['deploy', '--entrypoint', 'x', '--format', 'json'])
    expect(out.exitCode).toBe(1)
    expect(JSON.parse(out.stdout).error.message).toBe('Unknown option: --format')
  })

  test('agent helper commands stay disabled on generated product CLIs', async () => {
    const out = await runCli(workersGenerated, ['skills', 'list', '--json'])
    expect(out.stdout).toContain('Usage: workers <command>')
    expect(out.stdout).not.toContain('skills list')
  })

  test('generated local ops commands expose doctor, catalog, notices, and telemetry status', async () => {
    const doctor = await runCli(workersGenerated, ['doctor', '--json'], {
      env: { PATH: '/tmp/project/node_modules/.bin' },
    })
    expect(doctor.exitCode).toBe(0)
    const doctorJson = JSON.parse(doctor.stdout)
    expect(doctorJson.data.cli).toEqual({ name: 'workers', version: '1.0.0' })
    const checks = doctorJson.data.checks as Array<{ id: string; status: string; details?: Record<string, unknown> }>
    expect(checks.map((check) => check.id)).toEqual([
      'path.present',
      'path.local-bin',
      'package-manager.bun',
      'package-manager.npm',
      'product.catalog',
      'product.config',
      'remote.base-url',
      'auth.provider',
      'agent.commands',
      'notices.updates',
      'notices.channels',
      'notices.yanks',
      'release.metadata',
      'release.install',
      'release.update',
      'release.channel',
      'release.yanks',
    ])
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]))
    expect(byId['product.config']).toMatchObject({
      status: 'pass',
      details: {
        files: ['workers.jsonc', 'workers.yaml', 'workers.toml'],
        fields: ['accountId', 'apiBaseUrl'],
      },
    })
    expect(byId['remote.base-url']).toMatchObject({
      status: 'pass',
      details: { configPath: 'apiBaseUrl', source: 'schema-default' },
    })
    expect(byId['agent.commands']).toMatchObject({
      status: 'pass',
      details: { visible: [], risky: [] },
    })
    expect(byId['notices.updates']).toMatchObject({ status: 'warn', details: { count: 1 } })
    expect(byId['notices.channels']).toMatchObject({ status: 'pass', details: { count: 1 } })
    expect(byId['notices.yanks']).toMatchObject({ status: 'warn', details: { count: 1 } })
    expect(byId['release.metadata']).toMatchObject({
      status: 'pass',
      details: { version: '1.0.0', channel: 'stable' },
    })
    expect(byId['release.install']).toMatchObject({ status: 'pass', details: { count: 2, managers: ['bun', 'npm'] } })
    expect(byId['release.update']).toMatchObject({
      status: 'warn',
      details: { currentVersion: '1.0.0', latestVersion: '1.1.0' },
    })
    expect(byId['release.channel']).toMatchObject({ status: 'pass', details: { channel: 'stable', packages: 1 } })
    expect(byId['release.yanks']).toMatchObject({ status: 'warn', details: { count: 1, currentVersionYanked: false } })
    expect(doctorJson.data.summary).toEqual({ pass: 11, warn: 5, fail: 1 })

    const catalog = JSON.parse((await runCli(workersGenerated, ['catalog', '--json'])).stdout)
    expect(catalog.data.product.id).toBe('workers')
    expect(catalog.data.ops.notices.updates[0].id).toBe('workers-cli-1.1.0')
    expect(catalog.data.ops.release.install[0].manager).toBe('bun')

    const notices = JSON.parse((await runCli(workersGenerated, ['notices', '--json'])).stdout)
    expect(notices.data.yanks[0].id).toBe('workers-cli-0.9.0')

    const release = JSON.parse((await runCli(workersGenerated, ['release', '--json'])).stdout)
    expect(release.data).toMatchObject({
      version: '1.0.0',
      latestVersion: '1.1.0',
      channel: 'stable',
    })
    expect(release.data.install.map((entry: { manager: string }) => entry.manager)).toEqual(['bun', 'npm'])
    expect(release.data.yankedVersions[0].version).toBe('0.9.0')

    const ciKeys = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'BUILDKITE', 'TF_BUILD'] as const
    const savedCi: Record<string, string | undefined> = {}
    for (const key of ciKeys) {
      savedCi[key] = process.env[key]
      delete process.env[key]
    }
    try {
      const telemetryStatus = JSON.parse((await runCli(workersGenerated, ['telemetry', 'status', '--json'], {
        env: {
          WORKERS_TELEMETRY: '1',
          WORKERS_TELEMETRY_FILE: '/tmp/workers-telemetry.jsonl',
        },
      })).stdout)
      expect(telemetryStatus.data).toMatchObject({
        enabled: true,
        reason: 'cli-enabled',
        source: 'WORKERS_TELEMETRY',
        invocation: 'cli',
      })
    } finally {
      for (const key of ciKeys) {
        if (savedCi[key] !== undefined) process.env[key] = savedCi[key]
      }
    }
  })

  test('generated telemetry sink is opt-in and writes local JSONL when enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'liche-workers-telemetry-'))
    const file = join(dir, 'telemetry.jsonl')
    const saved = {
      LICHE_TELEMETRY_CI: process.env.LICHE_TELEMETRY_CI,
      WORKERS_TELEMETRY: process.env.WORKERS_TELEMETRY,
      WORKERS_TELEMETRY_FILE: process.env.WORKERS_TELEMETRY_FILE,
    }
    try {
      process.env.LICHE_TELEMETRY_CI = '1'
      process.env.WORKERS_TELEMETRY = '1'
      process.env.WORKERS_TELEMETRY_FILE = file
      const out = await runCli(workersGenerated, ['deploy', '--entrypoint', 'src/index.ts', '--json'])
      expect(out.exitCode).toBe(0)
      const lines = (await readEventually(file)).trim().split('\n')
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.some((line) => line.includes('command.completed'))).toBe(true)
    } finally {
      if (saved.LICHE_TELEMETRY_CI === undefined) delete process.env.LICHE_TELEMETRY_CI
      else process.env.LICHE_TELEMETRY_CI = saved.LICHE_TELEMETRY_CI
      if (saved.WORKERS_TELEMETRY === undefined) delete process.env.WORKERS_TELEMETRY
      else process.env.WORKERS_TELEMETRY = saved.WORKERS_TELEMETRY
      if (saved.WORKERS_TELEMETRY_FILE === undefined) delete process.env.WORKERS_TELEMETRY_FILE
      else process.env.WORKERS_TELEMETRY_FILE = saved.WORKERS_TELEMETRY_FILE
      rmSync(dir, { force: true, recursive: true })
    }
  })
})

describe('generated CLI — dev is not treated as HTTP-capable', () => {
  test("catalog records dev's execution mode as 'local', not a fake resource operation", () => {
    const catalog = normalizeProduct(workersProduct)
    const dev = catalog.capabilities.find((c) => c.id === 'dev')!
    expect(dev.kind).toBe('command')
    if (dev.kind !== 'command') throw new Error('unreachable')
    expect(dev.execution.mode).toBe('local')
    expect(dev.surfaces.openapi).toBe(false)
  })

  test("catalog records deploy's execution mode as 'hybrid-workflow', not a resource mutation", () => {
    const catalog = normalizeProduct(workersProduct)
    const deploy = catalog.capabilities.find((c) => c.id === 'deploy')!
    expect(deploy.kind).toBe('command')
    if (deploy.kind !== 'command') throw new Error('unreachable')
    expect(deploy.execution.mode).toBe('hybrid-workflow')
    expect(deploy.surfaces.openapi).toBe(false) // default for hybrid without explicit opt-in
  })
})
