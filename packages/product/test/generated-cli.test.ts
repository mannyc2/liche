import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ServeOptions } from '@lili/core'
import { canonicalDigest, generateCli, normalizeProduct } from '../src/index.js'
import workersProduct from './fixtures/workers.product.js'
import workersGenerated from './fixtures/workers.generated.js'
import workersHandwritten from './fixtures/workers.handwritten.js'

const FIXTURE_DIR = join(import.meta.dir, 'fixtures')

type CapturedRun = { stdout: string; stderr: string; exitCode: number }

async function runCli(
  cli: typeof workersGenerated,
  argv: string[],
  options: Omit<ServeOptions, 'exit' | 'stderr' | 'stdout'> = {},
): Promise<CapturedRun> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await cli.serve(argv, {
    ...options,
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
    exit: (code) => { exitCode = code },
    isTty: options.isTty ?? false,
  })
  return { stdout, stderr, exitCode }
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
  test('generated source imports only public @lili/core APIs required by the fixture', () => {
    const source = readFileSync(join(FIXTURE_DIR, 'workers.generated.ts'), 'utf8')
    const coreImports = [...source.matchAll(/from '@lili\/core'/g)]
    expect(coreImports).toHaveLength(1)
    const importLine = source.match(/import \{ ([^}]+) \} from '@lili\/core'/)
    expect(importLine?.[1]).toBe('Config, callHttpOperation, createLocalTelemetrySink, defineCli, defineCommand, runLocalDoctor, z')
  })

  test('generated source does not import from @lili/core subpaths or internals', () => {
    const source = readFileSync(join(FIXTURE_DIR, 'workers.generated.ts'), 'utf8')
    expect(source).not.toContain('@lili/core/')
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
    const dir = mkdtempSync(join(tmpdir(), 'lili-workers-config-'))
    const configPath = join(dir, 'workers.jsonc')
    try {
      writeFileSync(configPath, JSON.stringify({ apiBaseUrl: server.url.origin }))
      const gen = await runCli(workersGenerated, ['--config', configPath, 'script', 'list', '--json'])
      const env = JSON.parse(gen.stdout)
      expect(gen.exitCode).toBe(0)
      expect(env).toEqual({
        ok: true,
        data: [{ id: 'script-1', name: 'Worker One', created_at: '2026-05-20T00:00:00.000Z' }],
        meta: { execution: { mode: 'remote-http', source: 'config' } },
      })
    } finally {
      rmSync(dir, { force: true, recursive: true })
      server.stop(true)
    }
  })

  test('--format json is rejected on generated CLIs', async () => {
    const out = await runCli(workersGenerated, ['deploy', '--entrypoint', 'x', '--format', 'json'])
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('--format is disabled')
  })

  test('agent helper builtins stay disabled on generated product CLIs', async () => {
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
    expect(doctorJson.data.checks.map((check: { id: string }) => check.id)).toEqual([
      'path.present',
      'path.local-bin',
      'package-manager.bun',
      'package-manager.npm',
    ])

    const catalog = JSON.parse((await runCli(workersGenerated, ['catalog', '--json'])).stdout)
    expect(catalog.data.product.id).toBe('workers')
    expect(catalog.data.ops.notices.updates[0].id).toBe('workers-cli-1.1.0')

    const notices = JSON.parse((await runCli(workersGenerated, ['notices', '--json'])).stdout)
    expect(notices.data.yanks[0].id).toBe('workers-cli-0.9.0')

    const telemetry = JSON.parse((await runCli(workersGenerated, ['telemetry', '--json'], {
      env: {
        WORKERS_TELEMETRY: '1',
        WORKERS_TELEMETRY_FILE: '/tmp/workers-telemetry.jsonl',
      },
    })).stdout)
    expect(telemetry.data).toEqual({
      enabled: true,
      sink: { kind: 'file', path: '/tmp/workers-telemetry.jsonl' },
      redaction: 'enabled',
    })
  })

  test('generated telemetry sink is opt-in and writes local JSONL when enabled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lili-workers-telemetry-'))
    const file = join(dir, 'telemetry.jsonl')
    const saved = {
      WORKERS_TELEMETRY: process.env.WORKERS_TELEMETRY,
      WORKERS_TELEMETRY_FILE: process.env.WORKERS_TELEMETRY_FILE,
    }
    try {
      process.env.WORKERS_TELEMETRY = '1'
      process.env.WORKERS_TELEMETRY_FILE = file
      const out = await runCli(workersGenerated, ['deploy', '--entrypoint', 'src/index.ts', '--json'])
      expect(out.exitCode).toBe(0)
      const lines = readFileSync(file, 'utf8').trim().split('\n')
      expect(lines.length).toBeGreaterThan(0)
      expect(lines.some((line) => line.includes('command.completed'))).toBe(true)
    } finally {
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
