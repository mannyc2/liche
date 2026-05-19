import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalDigest, generateCli, normalizeProduct } from '../src/index.js'
import workersProduct from './fixtures/workers.product.js'
import workersGenerated from './fixtures/workers.generated.js'
import workersHandwritten from './fixtures/workers.handwritten.js'

const FIXTURE_DIR = join(import.meta.dir, 'fixtures')

type CapturedRun = { stdout: string; stderr: string; exitCode: number }

async function runCli(cli: typeof workersGenerated, argv: string[]): Promise<CapturedRun> {
  let stdout = ''
  let stderr = ''
  let exitCode = 0
  await cli.serve(argv, {
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
    exit: (code) => { exitCode = code },
    isTty: false,
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
  test('generated source imports only Cli and z from @lili/core', () => {
    const source = readFileSync(join(FIXTURE_DIR, 'workers.generated.ts'), 'utf8')
    const coreImports = [...source.matchAll(/from '@lili\/core'/g)]
    expect(coreImports).toHaveLength(1)
    const importLine = source.match(/import \{ ([^}]+) \} from '@lili\/core'/)
    expect(importLine?.[1]).toBe('Cli, z')
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

  test('script list returns the Phase 4 not-implemented error envelope', async () => {
    const argv = ['script', 'list', '--json']
    const gen = await runCli(workersGenerated, argv)
    const env = JSON.parse(gen.stdout)
    expect(env.ok).toBe(false)
    expect(env.error.code).toBe('REMOTE_NOT_IMPLEMENTED')
    expect(env.error.message).toContain('Phase 4')
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
