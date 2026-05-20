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

  test('declared context flag is injected as an optional string option so env fallback can resolve it', () => {
    const source = generate(workersAuthProduct)
    expect(source).toMatch(/\.command\('purge', \{[\s\S]*?options: z\.object\(\{[\s\S]*?'org': z\.string\(\)\.optional\(\)/)
  })

  test('command env schema includes only the auth and context env vars needed by the capability', () => {
    const source = generate(workersAuthProduct)
    expect(source).toMatch(/env: z\.object\(\{[\s\S]*?'ACME_TOKEN': z\.string\(\)\.optional\(\)/)
    expect(source).toMatch(/env: z\.object\(\{[\s\S]*?'ACME_CI_TOKEN': z\.string\(\)\.optional\(\)/)
    expect(source).toMatch(/env: z\.object\(\{[\s\S]*?'ACME_ORG_ID': z\.string\(\)\.optional\(\)/)
  })

  test('run body resolves auth and context before the (Phase 4) stub return', () => {
    const source = generate(workersAuthProduct)
    expect(source).toMatch(
      /const credential = await resolveAuth\(\{[\s\S]*?provider: AUTH_PROVIDER,[\s\S]*?required: true,[\s\S]*?requiredPermissions: \['cache:write'\],[\s\S]*?requiredScopes: \['cache\.write'\],[\s\S]*?invocation: ctx\.invocation,[\s\S]*?env: ctx\.env as Record<string, string \| undefined>,[\s\S]*?\}\)/,
    )
    expect(source).toMatch(
      /const context = await resolveContext\(\{[\s\S]*?contexts: CONTEXTS,[\s\S]*?required: \['org'\],[\s\S]*?explicit: ctx\.options[\s\S]*?env: ctx\.env as Record<string, string \| undefined>,[\s\S]*?providerId: AUTH_PROVIDER\.id,[\s\S]*?\}\)/,
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

  test('generated command metadata exposes auth requirements without secrets for agent/MCP surfaces', () => {
    const source = generate(workersAuthProduct)
    expect(source).toContain(`auth: { required: true, status: 'requires-runtime-resolution', providerId: 'acme'`)
    expect(source).toContain(`envVars: ['ACME_TOKEN', 'ACME_CI_TOKEN']`)
    expect(source).toContain(`requiredPermissions: ['cache:write']`)
    expect(source).toContain(`requiredScopes: ['cache.write']`)
    expect(source).not.toContain('tok-runtime')
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
      CI: process.env.CI,
    }
    delete process.env.ACME_TOKEN
    delete process.env.ACME_CI_TOKEN
    delete process.env.ACME_ORG_ID
    delete process.env.CI
  })

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true })
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  function asyncIter(values: string[]): AsyncIterable<string> {
    return (async function* () {
      for (const value of values) yield value
    })()
  }

  async function runGenerated(
    argv: string[],
    env: Record<string, string | undefined> = {},
    stdin?: AsyncIterable<string>,
  ): Promise<{ stdout: string; exitCode: number }> {
    const mod = (await import(modulePath)) as {
      default: {
        serve: (
          argv: string[],
          opts: {
            stdout: (s: string) => void
            stderr: (s: string) => void
            exit: (code: number) => void
            isTty: boolean
            env?: Record<string, string | undefined>
            stdin?: AsyncIterable<string>
          },
        ) => Promise<void>
      }
    }
    let stdout = ''
    let exitCode = 0
    const opts: {
      stdout: (s: string) => void
      stderr: (s: string) => void
      exit: (code: number) => void
      isTty: boolean
      env?: Record<string, string | undefined>
      stdin?: AsyncIterable<string>
    } = {
      stdout: (s) => {
        stdout += s
      },
      stderr: () => {},
      exit: (code) => {
        exitCode = code
      },
      isTty: false,
      env,
    }
    if (stdin) opts.stdin = stdin
    await mod.default.serve(argv, opts)
    return { stdout, exitCode }
  }

  test('missing ACME_TOKEN under CLI invocation fails with AUTH_MISSING (no transport reached)', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--org', 'acme-corp', '--json'])
    expect(exitCode).toBe(1)
    expect(stdout).toContain('AUTH_MISSING')
    expect(stdout).not.toContain('REMOTE_NOT_IMPLEMENTED')
  })

  test('with ACME_TOKEN injected through ServeOptions.env, the resolution path succeeds without reading process.env', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--org', 'acme-corp', '--json'], {
      ACME_TOKEN: 'tok-runtime',
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('REMOTE_NOT_IMPLEMENTED')
    expect(stdout).not.toContain('AUTH_MISSING')
    expect(stdout).not.toContain('tok-runtime')
  })

  test('context env fallback reaches resolveContext when --org is omitted', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--json'], {
      ACME_TOKEN: 'tok-runtime',
      ACME_ORG_ID: 'env-org',
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('REMOTE_NOT_IMPLEMENTED')
    expect(stdout).not.toContain('VALIDATION_ERROR')
    expect(stdout).not.toContain('AUTH_CONTEXT_REQUIRED')
  })

  test('missing context produces AUTH_CONTEXT_REQUIRED instead of option validation', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--json'], {
      ACME_TOKEN: 'tok-runtime',
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('AUTH_CONTEXT_REQUIRED')
    expect(stdout).not.toContain('VALIDATION_ERROR')
  })

  test('CI invocation can use a ci-mode token source from ServeOptions.env', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--json'], {
      CI: 'true',
      ACME_CI_TOKEN: 'ci-token',
      ACME_ORG_ID: 'env-org',
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('REMOTE_NOT_IMPLEMENTED')
    expect(stdout).not.toContain('AUTH_MISSING')
    expect(stdout).not.toContain('ci-token')
  })

  test('CI invocation without a token source fails with AUTH_CI_TOKEN_MISSING', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--json'], {
      CI: 'true',
      ACME_ORG_ID: 'env-org',
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('AUTH_CI_TOKEN_MISSING')
  })

  test('--llms --json command manifest includes non-secret auth requirements for agent planning', async () => {
    const { stdout, exitCode } = await runGenerated(['--llms', '--json'])
    expect(exitCode).toBe(0)
    const manifest = JSON.parse(stdout)
    const purge = manifest.commands.find((c: { name: string }) => c.name === 'purge')
    expect(purge.auth).toMatchObject({
      required: true,
      status: 'requires-runtime-resolution',
      providerId: 'acme',
      envVars: ['ACME_TOKEN', 'ACME_CI_TOKEN'],
      requiredPermissions: ['cache:write'],
      requiredScopes: ['cache.write'],
    })
    expect(JSON.stringify(purge.auth)).not.toContain('tok-runtime')
  })

  test('MCP tools/list includes the same non-secret auth requirements', async () => {
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const { stdout, exitCode } = await runGenerated(['--mcp'], {}, asyncIter([`${request}\n`]))
    expect(exitCode).toBe(0)
    const response = JSON.parse(stdout.trim())
    const purge = response.result.tools.find((tool: { name: string }) => tool.name === 'purge')
    expect(purge.auth).toMatchObject({
      required: true,
      status: 'requires-runtime-resolution',
      providerId: 'acme',
      envVars: ['ACME_TOKEN', 'ACME_CI_TOKEN'],
      requiredPermissions: ['cache:write'],
      requiredScopes: ['cache.write'],
    })
    expect(JSON.stringify(purge.auth)).not.toContain('tok-runtime')
  })
})
