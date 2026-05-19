import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { canonicalDigest, generateCli, normalizeProduct } from '../src/index.js'
import workersAuthProduct from './fixtures/workers-auth.product.js'
import workersProduct from './fixtures/workers.product.js'

function generate(product: typeof workersAuthProduct): string {
  const catalog = normalizeProduct(product)
  const inputDigest = canonicalDigest(catalog)
  const optionsDigest = canonicalDigest({
    surfaceId: 'cli',
    generatedFileName: 'workers-auth.generated.ts',
    manifestFileName: 'workers-auth.generated.manifest.json',
  })
  return generateCli(catalog, {
    generatorVersion: '0.0.0',
    canonicalIrDigest: inputDigest,
    generationOptionsDigest: optionsDigest,
    surfaceId: 'cli',
  })
}

describe('generateCli — auth-bearing fixture (Phase 3D-A) — source assertions', () => {
  test('imports applyAuth, resolveAuth, resolveContext alongside Cli and z', () => {
    const source = generate(workersAuthProduct)
    const importLine = source.match(/import \{ ([^}]+) \} from '@lili\/core'/)
    expect(importLine?.[1]).toBe('Cli, applyAuth, resolveAuth, resolveContext, z')
  })

  test('emits AUTH_PROVIDER constant carrying id, kind, header (when present), and token sources', () => {
    const source = generate(workersAuthProduct)
    expect(source).toContain(`const AUTH_PROVIDER = {`)
    expect(source).toContain(`id: 'acme'`)
    expect(source).toContain(`kind: 'bearer'`)
    expect(source).toContain(`envVar: 'ACME_TOKEN'`)
    expect(source).toContain(`mode: 'any'`)
    expect(source).toContain(`envVar: 'ACME_CI_TOKEN'`)
    expect(source).toContain(`mode: 'ci'`)
  })

  test('emits CONTEXTS array with the declared flag/envVar/label', () => {
    const source = generate(workersAuthProduct)
    expect(source).toContain(`const CONTEXTS = [`)
    expect(source).toContain(`id: 'org'`)
    expect(source).toContain(`label: 'Organization'`)
    expect(source).toContain(`flag: 'org'`)
    expect(source).toContain(`envVar: 'ACME_ORG_ID'`)
  })

  test('declared context flag is injected as a required string option on the command', () => {
    const source = generate(workersAuthProduct)
    expect(source).toMatch(/\.command\('purge', \{[\s\S]*?options: z\.object\(\{[\s\S]*?'org': z\.string\(\)/)
  })

  test('run body resolves auth and context before the (Phase 4) stub return', () => {
    const source = generate(workersAuthProduct)
    expect(source).toMatch(
      /const credential = await resolveAuth\(\{[\s\S]*?provider: AUTH_PROVIDER,[\s\S]*?required: true,[\s\S]*?invocation: 'cli',[\s\S]*?env: process\.env,[\s\S]*?\}\)/,
    )
    expect(source).toMatch(
      /const context = await resolveContext\(\{[\s\S]*?contexts: CONTEXTS,[\s\S]*?required: \['org'\],[\s\S]*?explicit: ctx\.options[\s\S]*?env: process\.env,[\s\S]*?providerId: AUTH_PROVIDER\.id,[\s\S]*?\}\)/,
    )
    expect(source).toContain('const headers = new Headers()')
    expect(source).toContain('if (credential) applyAuth(headers, credential)')
    expect(source).toContain(`code: 'REMOTE_NOT_IMPLEMENTED'`)
  })

  test('generated source never inlines raw token values or calls secret.reveal()', () => {
    const source = generate(workersAuthProduct)
    expect(source).not.toContain('.reveal(')
    expect(source).not.toMatch(/Bearer \$\{[^}]*\}/)
    expect(source).not.toContain('process.env.ACME_TOKEN')
  })

  test('no-auth product (workers fixture) does not emit AUTH_PROVIDER, CONTEXTS, or auth-runtime imports', () => {
    const catalog = normalizeProduct(workersProduct)
    const source = generateCli(catalog, {
      generatorVersion: '0.0.0',
      canonicalIrDigest: canonicalDigest(catalog),
      generationOptionsDigest: 'sha256:test',
      surfaceId: 'cli',
    })
    expect(source).not.toContain('AUTH_PROVIDER')
    expect(source).not.toContain('CONTEXTS')
    expect(source).not.toContain('resolveAuth')
    expect(source).not.toContain('applyAuth')
    const importLine = source.match(/import \{ ([^}]+) \} from '@lili\/core'/)
    expect(importLine?.[1]).toBe('Cli, z')
  })
})

describe('generated CLI runtime — auth fixture executes resolveAuth/resolveContext via @lili/core', () => {
  let dir: string
  let modulePath: string
  let savedEnv: Record<string, string | undefined> = {}

  beforeEach(async () => {
    // Generate inside the workspace so @lili/core resolves via the workspace's
    // node_modules. tmpdir() escapes the workspace and breaks Bun's resolver.
    const root = join(import.meta.dir, '.tmp')
    mkdirSync(root, { recursive: true })
    dir = mkdtempSync(join(root, 'auth-gen-'))
    modulePath = join(dir, 'workers-auth.generated.ts')
    writeFileSync(modulePath, generate(workersAuthProduct), 'utf8')
    savedEnv = {
      ACME_TOKEN: process.env.ACME_TOKEN,
      ACME_CI_TOKEN: process.env.ACME_CI_TOKEN,
      ACME_ORG_ID: process.env.ACME_ORG_ID,
    }
    delete process.env.ACME_TOKEN
    delete process.env.ACME_CI_TOKEN
    delete process.env.ACME_ORG_ID
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  async function runGenerated(argv: string[]): Promise<{ stdout: string; exitCode: number }> {
    const mod = (await import(modulePath)) as {
      default: {
        serve: (
          argv: string[],
          opts: {
            stdout: (s: string) => void
            stderr: (s: string) => void
            exit: (code: number) => void
            isTty: boolean
          },
        ) => Promise<void>
      }
    }
    let stdout = ''
    let exitCode = 0
    await mod.default.serve(argv, {
      stdout: (s) => {
        stdout += s
      },
      stderr: () => {},
      exit: (code) => {
        exitCode = code
      },
      isTty: false,
    })
    return { stdout, exitCode }
  }

  test('missing ACME_TOKEN under CLI invocation fails with AUTH_MISSING (no transport reached)', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--org', 'acme-corp', '--json'])
    expect(exitCode).toBe(1)
    expect(stdout).toContain('AUTH_MISSING')
    expect(stdout).not.toContain('REMOTE_NOT_IMPLEMENTED')
  })

  test('with ACME_TOKEN set, the resolution path succeeds and the transport stub fires (REMOTE_NOT_IMPLEMENTED)', async () => {
    process.env.ACME_TOKEN = 'tok-runtime'
    const { stdout, exitCode } = await runGenerated(['purge', '--org', 'acme-corp', '--json'])
    expect(exitCode).toBe(1)
    expect(stdout).toContain('REMOTE_NOT_IMPLEMENTED')
    expect(stdout).not.toContain('AUTH_MISSING')
    expect(stdout).not.toContain('tok-runtime')
  })
})
