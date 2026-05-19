import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import contract from './fixtures/acme.contract.js'
import { canonicalDigest, generateCli, normalizeContract } from '../src/index.js'
import acmeGenerated from './fixtures/acme.generated.js'
import acmeHandwritten from './fixtures/acme.handwritten.js'

const FIXTURE_DIR = join(import.meta.dir, 'fixtures')

async function runCli(cli: typeof acmeGenerated, argv: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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
  test('generator output equals checked-in fixtures/acme.generated.ts', () => {
    const ir = normalizeContract(contract)
    const canonicalIrDigest = canonicalDigest(ir)
    const generationOptionsDigest = canonicalDigest({ surfaceId: 'cli' })
    const source = generateCli(ir, {
      generatorVersion: '0.0.0',
      canonicalIrDigest,
      generationOptionsDigest,
    })
    const golden = readFileSync(join(FIXTURE_DIR, 'acme.generated.ts'), 'utf8')
    expect(source).toBe(golden)
  })
})

describe('generated CLI — boundary discipline', () => {
  test('generated source imports only Cli and z from @lili/core', () => {
    const source = readFileSync(join(FIXTURE_DIR, 'acme.generated.ts'), 'utf8')
    const coreImports = [...source.matchAll(/from '@lili\/core'/g)]
    expect(coreImports).toHaveLength(1)
    // The single import line must be exactly Cli + z
    const importLine = source.match(/import \{ ([^}]+) \} from '@lili\/core'/)
    expect(importLine?.[1]).toBe('Cli, z')
  })

  test('generated source does not import from @lili/core subpaths or internals', () => {
    const source = readFileSync(join(FIXTURE_DIR, 'acme.generated.ts'), 'utf8')
    expect(source).not.toContain('@lili/core/')
    expect(source).not.toContain('stateSymbol')
    expect(source).not.toContain('InternalCli')
  })
})

describe('generated CLI — runtime parity with handwritten', () => {
  test('projects get returns identical JSON envelope', async () => {
    const argv = ['projects', 'get', '--projectId', 'abc', '--json']
    const gen = await runCli(acmeGenerated, argv)
    const hand = await runCli(acmeHandwritten, argv)
    expect(gen.exitCode).toBe(0)
    expect(hand.exitCode).toBe(0)
    const genJson = JSON.parse(gen.stdout)
    const handJson = JSON.parse(hand.stdout)
    expect(genJson).toEqual(handJson)
    expect(genJson.ok).toBe(true)
    expect(genJson.data).toEqual({ project: { id: 'abc', name: 'project-abc' } })
    expect(genJson.meta).toEqual({ locality: { mode: 'local', source: 'schema-default' } })
  })

  test('projects deploy (workflow) returns identical JSON envelope', async () => {
    const argv = ['projects', 'deploy', '--projectId', 'abc', '--target', 'prod', '--json']
    const gen = await runCli(acmeGenerated, argv)
    const hand = await runCli(acmeHandwritten, argv)
    const genJson = JSON.parse(gen.stdout)
    const handJson = JSON.parse(hand.stdout)
    expect(genJson).toEqual(handJson)
    expect(genJson.data).toEqual({ deploymentId: 'dep-abc-prod' })
  })

  test('--format json is rejected on generated CLI', async () => {
    const out = await runCli(acmeGenerated, ['projects', 'get', '--projectId', 'abc', '--format', 'json'])
    expect(out.exitCode).toBe(1)
    expect(out.stderr).toContain('--format is disabled')
  })

  test('agent helper builtins stay disabled on generated product CLIs', async () => {
    const out = await runCli(acmeGenerated, ['skills', 'list', '--json'])
    expect(out.stdout).toContain('Usage: acme <command>')
    expect(out.stdout).not.toContain('skills list')
  })
})

describe('generated CLI — workflow command is not forced into CRUD or HTTP', () => {
  test('IR for projects.deploy has no remote.bind', () => {
    const ir = normalizeContract(contract)
    const deploy = ir.operations.find((op) => op.id === 'projects.deploy')!
    expect(deploy.remote).toBeUndefined()
    expect(deploy.effects.kind).toBe('exec')
  })
})
