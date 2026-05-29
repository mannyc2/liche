import { run, type CliInstance } from '@liche/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkAgainstDir, conformProduct, generateToDir } from '@liche/product'
import product from './product.js'

type GeneratedCliModule = {
  default: CliInstance
}

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

describe('product-workers example', () => {
  let outDir: string

  beforeEach(async () => {
    mkdirSync(join(import.meta.dir, '.tmp'), { recursive: true })
    outDir = mkdtempSync(join(import.meta.dir, '.tmp/generated-'))
    await copyImpl(outDir)
  })

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
  })

  test('generates synchronized surfaces', async () => {
    const result = await generateToDir(product, {
      outDir,
      generatorVersion: 'example',
    })

    expect(Object.keys(result.artifacts).sort()).toEqual([
      'agent-reference',
      'catalog',
      'cli',
      'command-manifest',
      'config-schema',
      'discovery',
      'docs-reference',
      'mcp-tools',
      'openapi',
    ])

    const check = await checkAgainstDir(product, {
      outDir,
      generatorVersion: 'example',
    })
    expect(check).toEqual({ ok: true })
  })

  test('runs local and hybrid commands through generated core CLI', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)

    const deploy = await runGenerated(cli, [
      'deploy',
      '--entrypoint',
      'src/index.ts',
      '--environment',
      'preview',
      '--json',
    ])
    expect(deploy.exitCode).toBe(0)
    expect(JSON.parse(deploy.stdout)).toMatchObject({
      data: {
        deployment_id: 'dep-src-index-ts-preview',
        url: 'https://preview.workers.example.test',
      },
      meta: { execution: { mode: 'hybrid-workflow', source: 'schema-default' } },
      ok: true,
    })

    const dev = await runGenerated(cli, ['dev', '--entrypoint', 'src/index.ts', '--json'])
    expect(dev.exitCode).toBe(0)
    expect(JSON.parse(dev.stdout)).toMatchObject({
      data: { url: 'http://localhost:8787?entry=src%2Findex.ts' },
      meta: { execution: { mode: 'local', source: 'schema-default' } },
      ok: true,
    })
  })

  test('resource remote transport uses config-backed base URL', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe('/')
        return Response.json([
          { id: 'worker-a', name: 'Worker A', created_at: '2026-05-20T00:00:00.000Z' },
        ])
      },
    })

    try {
      const configPath = join(outDir, 'workers.jsonc')
      writeFileSync(configPath, JSON.stringify({ apiBaseUrl: server.url.origin }))
      const list = await runGenerated(cli, ['--config', configPath, 'script', 'list', '--json'])
      expect(list.exitCode).toBe(0)
      expect(JSON.parse(list.stdout)).toMatchObject({
        ok: true,
        data: [
          { id: 'worker-a', name: 'Worker A', created_at: '2026-05-20T00:00:00.000Z' },
        ],
        meta: { execution: { mode: 'remote-http', source: 'config' } },
      })
    } finally {
      server.stop(true)
    }
  })

  test('conformance runs against an owned fixture server', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe('/')
        return Response.json([
          { id: 'worker-a', name: 'Worker A', created_at: '2026-05-20T00:00:00.000Z' },
        ])
      },
    })

    try {
      const report = await conformProduct(product, {
        baseUrl: server.url.origin,
        capability: 'script.list',
      })
      expect(report.summary).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 })
      expect(report.cases[0]).toMatchObject({
        capability: 'script.list',
        status: 'passed',
        request: { method: 'GET' },
        response: { status: 200 },
      })
    } finally {
      server.stop(true)
    }
  })

  test('generated local ops expose diagnostics, notices, catalog, and opt-in telemetry', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    const cli = await loadGenerated(result.generatedPath)

    const doctor = await runGenerated(cli, ['doctor', '--json'], {
      PATH: '/tmp/project/node_modules/.bin',
    })
    expect(doctor.exitCode).toBe(0)
    const doctorJson = JSON.parse(doctor.stdout)
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
    expect(byId['remote.base-url']).toMatchObject({
      status: 'pass',
      details: { configPath: 'apiBaseUrl', source: 'schema-default' },
    })
    expect(byId['agent.commands']).toMatchObject({
      status: 'warn',
      details: { visible: ['deploy', 'script.list'], risky: [], underAnnotated: ['deploy'] },
    })
    expect(byId['release.update']).toMatchObject({
      status: 'warn',
      details: { currentVersion: '0.1.0', latestVersion: '0.2.0' },
    })
    expect(byId['release.yanks']).toMatchObject({ status: 'fail', details: { count: 1, currentVersionYanked: true } })
    expect(doctorJson.data.summary).toEqual({ pass: 10, warn: 5, fail: 2 })

    const catalog = await runGenerated(cli, ['catalog', '--json'])
    expect(JSON.parse(catalog.stdout).data.ops.telemetry.enabledEnvVar).toBe('WORKERS_TELEMETRY')
    expect(JSON.parse(catalog.stdout).data.ops.release.channel).toBe('stable')

    const notices = await runGenerated(cli, ['notices', '--json'])
    expect(JSON.parse(notices.stdout).data.yanks[0].id).toBe('workers-cli-0.1.0')

    const release = await runGenerated(cli, ['release', '--json'])
    expect(JSON.parse(release.stdout).data.yankedVersions[0].version).toBe('0.1.0')

    const telemetryFile = join(outDir, 'telemetry.jsonl')
    const telemetryStatus = await runGenerated(cli, ['telemetry', 'status', '--json'], {
      LICHE_INVOCATION: 'cli',
      WORKERS_TELEMETRY: '1',
      WORKERS_TELEMETRY_FILE: telemetryFile,
    })
    expect(JSON.parse(telemetryStatus.stdout).data).toMatchObject({
      enabled: true,
      reason: 'cli-enabled',
      source: 'WORKERS_TELEMETRY',
      invocation: 'cli',
    })

    const savedTelemetry = {
      LICHE_TELEMETRY_CI: process.env.LICHE_TELEMETRY_CI,
      WORKERS_TELEMETRY: process.env.WORKERS_TELEMETRY,
      WORKERS_TELEMETRY_FILE: process.env.WORKERS_TELEMETRY_FILE,
    }
    try {
      process.env.LICHE_TELEMETRY_CI = '1'
      process.env.WORKERS_TELEMETRY = '1'
      process.env.WORKERS_TELEMETRY_FILE = telemetryFile
      const deploy = await runGenerated(cli, ['deploy', '--entrypoint', 'src/index.ts', '--json'])
      expect(deploy.exitCode).toBe(0)
      const lines = (await readEventually(telemetryFile)).trim().split('\n')
      expect(lines.some((line) => line.includes('command.completed'))).toBe(true)
    } finally {
      if (savedTelemetry.LICHE_TELEMETRY_CI === undefined) delete process.env.LICHE_TELEMETRY_CI
      else process.env.LICHE_TELEMETRY_CI = savedTelemetry.LICHE_TELEMETRY_CI
      if (savedTelemetry.WORKERS_TELEMETRY === undefined) delete process.env.WORKERS_TELEMETRY
      else process.env.WORKERS_TELEMETRY = savedTelemetry.WORKERS_TELEMETRY
      if (savedTelemetry.WORKERS_TELEMETRY_FILE === undefined) delete process.env.WORKERS_TELEMETRY_FILE
      else process.env.WORKERS_TELEMETRY_FILE = savedTelemetry.WORKERS_TELEMETRY_FILE
    }
  })
})

async function copyImpl(outDir: string): Promise<void> {
  const implDir = join(outDir, 'impl')
  mkdirSync(implDir, { recursive: true })
  const source = await Bun.file(join(import.meta.dir, 'impl/wrangler.ts')).text()
  writeFileSync(join(implDir, 'wrangler.ts'), source)
}

async function loadGenerated(path: string): Promise<GeneratedCliModule['default']> {
  const mod = (await import(`${path}?t=${Date.now()}`)) as GeneratedCliModule
  return mod.default
}

async function runGenerated(
  cli: GeneratedCliModule['default'],
  argv: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await run(cli, argv, {
    env,
    exit: (code) => {
      exitCode = code
    },
    streams: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
    stderr: (chunk) => {
      stderr += chunk
    },
    stdout: (chunk) => {
      stdout += chunk
    },
  })
  return { exitCode, stderr, stdout }
}
