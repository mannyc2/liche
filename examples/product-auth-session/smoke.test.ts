import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { checkAgainstDir, generateToDir } from '@liche/product'
import product from './product.js'

type GeneratedCli = {
  serve: (
    argv: string[],
    options: {
      stdout: (chunk: string) => void
      stderr: (chunk: string) => void
      exit: (code: number) => void
      isTty: boolean
      env?: Record<string, string | undefined>
      stdin?: AsyncIterable<string>
    },
  ) => Promise<void>
}

describe('product-auth-session example', () => {
  let outDir: string
  let savedHome: string | undefined

  beforeEach(() => {
    mkdirSync(join(import.meta.dir, '.tmp'), { recursive: true })
    outDir = mkdtempSync(join(import.meta.dir, '.tmp/generated-'))
    savedHome = process.env.LICHE_HOME
    process.env.LICHE_HOME = join(outDir, 'home')
  })

  afterEach(() => {
    if (savedHome === undefined) delete process.env.LICHE_HOME
    else process.env.LICHE_HOME = savedHome
    rmSync(outDir, { recursive: true, force: true })
  })

  test('generated OAuth login/whoami/switch/logout round-trip through file sessions', async () => {
    const result = await generateToDir(product, { outDir, generatorVersion: 'example' })
    expect(await checkAgainstDir(product, { outDir, generatorVersion: 'example' })).toEqual({ ok: true })

    const cli = await loadGenerated(result.generatedPath)
    const originalFetch = globalThis.fetch
    globalThis.fetch = fakeAuthFetch() as typeof fetch
    try {
      const login = await runGenerated(cli, ['login', '--json'], {}, true)
      expect(login.exitCode).toBe(0)
      expect(login.stdout).not.toContain('oauth-token')

      const switched = await runGenerated(cli, ['switch', '--org', 'org_1', '--json'])
      expect(JSON.parse(switched.stdout).data).toMatchObject({
        profile: 'default',
        contexts: { org: 'org_1' },
      })

      const whoami = await runGenerated(cli, ['whoami', '--json'])
      expect(JSON.parse(whoami.stdout).data).toMatchObject({
        authenticated: true,
        source: 'session',
        profile: 'default',
        account: { id: 'user_1', label: 'dev@example.test' },
        contexts: { org: 'org_1' },
      })
      expect(whoami.stdout).not.toContain('oauth-token')

      const logout = await runGenerated(cli, ['logout', '--json'])
      expect(JSON.parse(logout.stdout).data).toMatchObject({
        authenticated: false,
        deleted: 1,
        profile: 'default',
      })

      const after = await runGenerated(cli, ['whoami', '--json'])
      expect(JSON.parse(after.stdout).data).toEqual({ authenticated: false })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

function fakeAuthFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/device')) {
      expect(init?.method).toBe('POST')
      return Response.json({
        device_code: 'device-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://auth.acme.example.test/activate',
        expires_in: 60,
        interval: 1,
      })
    }
    if (url.endsWith('/token')) {
      return Response.json({ access_token: 'oauth-token', expires_in: 3600, scope: 'cache.write' })
    }
    if (url.endsWith('/me')) {
      expect((init?.headers as Headers).get('authorization')).toBe('Bearer oauth-token')
      return Response.json({ id: 'user_1', email: 'dev@example.test' })
    }
    throw new Error(`unexpected fetch ${url}`)
  }) as typeof fetch
}

async function loadGenerated(path: string): Promise<GeneratedCli> {
  const mod = (await import(`${path}?t=${Date.now()}`)) as { default: GeneratedCli }
  return mod.default
}

async function runGenerated(
  cli: GeneratedCli,
  argv: string[],
  env: Record<string, string | undefined> = {},
  isTty = false,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  let exitCode = 0
  let stderr = ''
  let stdout = ''
  await cli.serve(argv, {
    env,
    exit: (code) => {
      exitCode = code
    },
    isTty,
    stderr: (chunk) => {
      stderr += chunk
    },
    stdout: (chunk) => {
      stdout += chunk
    },
  })
  return { exitCode, stderr, stdout }
}
