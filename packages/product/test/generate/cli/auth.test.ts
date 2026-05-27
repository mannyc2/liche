import { run, type CliInstance } from '@liche/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Auth, Command, createConfig, Field, Runtime, Shape, canonicalDigest, defineProduct, generateCli, normalizeProduct } from '../../../src/index.js'
import type { RuntimeProduct } from '../../../src/index.js'
import workersAuthProduct from '../../fixtures/workers-auth.product.js'
import workersProduct from '../../fixtures/workers.product.js'

function generate(product: RuntimeProduct): string {
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

function oauthProduct(): RuntimeProduct {
  return defineProduct({
    id: 'workers-oauth',
    name: 'Workers OAuth',
    version: '1.0.0',
    description: 'Workers fixture with OAuth device login and file sessions.',
    remote: { baseUrl: Runtime.literal('https://api.example.test') },
    auth: Auth.oauthDevice({
      id: 'acme',
      token: { kind: 'bearer' },
      clientId: 'acme-cli',
      endpoints: {
        deviceAuthorization: 'https://auth.example.test/device',
        token: 'https://auth.example.test/token',
      },
      sources: [
        Auth.token.env('ACME_TOKEN', { label: 'Bearer token' }),
        Auth.token.env('ACME_CI_TOKEN', { mode: 'ci' }),
        Auth.token.session({ profiles: true }),
      ],
      identity: Auth.identity({ http: { method: 'GET', path: '/me' }, subject: 'id', label: 'email' }),
      commands: Auth.commands({ login: 'login', logout: 'logout', switch: 'switch', whoami: 'whoami' }),
    }),
    permissions: {
      'cache:write': Auth.permission.scope('cache.write'),
    },
    contexts: {
      org: Auth.context.env({ label: 'Organization', select: { flag: 'org', env: 'ACME_ORG_ID' } }),
    },
    ops: {
      doctor: { packageManagers: ['bun'] },
    },
    commands: {
      purge: Command.remoteHttp({
        summary: 'Purge cache for an org',
        http: { method: 'POST', path: '/orgs/{org_id}/purge_cache' },
        requires: { auth: true, contexts: ['org'], permissions: ['cache:write'] },
        surfaces: { agent: true },
      }),
    },
  })
}

function optionalConfigRemoteProduct(): RuntimeProduct {
  return defineProduct({
    id: 'config-remote',
    name: 'Config Remote',
    version: '1.0.0',
    auth: Auth.none(),
    config: createConfig({
      files: ['config-remote.jsonc'],
      fields: Shape.object({
        apiBaseUrl: Field.string('API base URL').optional(),
      }),
      scopes: { project: { discoverUpwards: true }, user: false },
    }),
    remote: { baseUrl: Runtime.config('apiBaseUrl') },
    commands: {
      ping: Command.remoteHttp({
        summary: 'Ping the remote API',
        http: { method: 'GET', path: '/ping' },
      }),
    },
  })
}

describe('generateCli — auth-bearing fixture (Phase 3D-A) — source assertions', () => {
  test('imports HTTP transport, auth primitives, and the auth extension', () => {
    const source = generate(workersAuthProduct)
    const importLine = source.match(/import \{ ([^}]+) \} from '@liche\/core'/)
    expect(importLine?.[1]).toBe('callHttpOperation, defineCli, defineCommand, help, outputControls, reflectionControls, version, z')
    expect(source).toContain(`import { llms } from '@liche/agents'`)
    expect(source).toContain(`import { auth as authExtension, createFileSessionStore, credentialHttpAuth, detectInvocation, resolveAuth, resolveContext } from '@liche/auth'`)
    expect(source).toContain(`import { mcpServer } from '@liche/mcp-server'`)
    expect(source).toContain(`import { tokens } from '@liche/tokens'`)
    expect(source).toContain(`extensions: [help(), version(), outputControls({ json: true, filterOutput: true }), reflectionControls({ schema: true }), llms({ commands: { include: ['purge'] } }), tokens(), authExtension(), mcpServer({ tools: { include: ['purge'] } })],`)
    expect(source).not.toContain(`globals: [`)
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
    expect(source).toMatch(/defineCommand\(\{[\s\S]*?path: \['purge'\],[\s\S]*?options: z\.object\(\{[\s\S]*?'org': z\.string\(\)\.optional\(\)/)
  })

  test('command env schema includes only the auth and context env vars needed by the capability', () => {
    const source = generate(workersAuthProduct)
    expect(source).toMatch(/env: z\.object\(\{[\s\S]*?'ACME_TOKEN': z\.string\(\)\.optional\(\)/)
    expect(source).toMatch(/env: z\.object\(\{[\s\S]*?'ACME_CI_TOKEN': z\.string\(\)\.optional\(\)/)
    expect(source).toMatch(/env: z\.object\(\{[\s\S]*?'ACME_ORG_ID': z\.string\(\)\.optional\(\)/)
  })

  test('run body resolves auth and context before calling core HTTP transport', () => {
    const source = generate(workersAuthProduct)
    expect(source).toMatch(
      /const credential = await resolveAuth\(\{[\s\S]*?provider: AUTH_PROVIDER,[\s\S]*?required: true,[\s\S]*?requiredPermissions: \['cache:write'\],[\s\S]*?requiredScopes: \['cache\.write'\],[\s\S]*?invocation: detectInvocation\(ctx\),[\s\S]*?env: ctx\.env as Record<string, string \| undefined>,[\s\S]*?\}\)/,
    )
    expect(source).toMatch(
      /const context = await resolveContext\(\{[\s\S]*?contexts: CONTEXTS,[\s\S]*?required: \['org'\],[\s\S]*?explicit: ctx\.options[\s\S]*?env: ctx\.env as Record<string, string \| undefined>,[\s\S]*?providerId: AUTH_PROVIDER\.id,[\s\S]*?\}\)/,
    )
    expect(source).not.toContain('applyAuth')
    expect(source).not.toContain('const headers = new Headers()')
    expect(source).toContain(`const data = await callHttpOperation({`)
    expect(source).toContain(`baseUrl: { envVar: 'ACME_API_BASE_URL' },`)
    expect(source).toContain(`auth: credential ? credentialHttpAuth(credential, { requiredPermissions: ['cache:write'] }) : { kind: 'none' },`)
    expect(source).not.toContain(`code: 'REMOTE_NOT_IMPLEMENTED'`)
  })

  test('generated source never inlines raw token values or calls secret.reveal()', () => {
    const source = generate(workersAuthProduct)
    expect(source).not.toContain('.reveal(')
    expect(source).not.toMatch(/Bearer \$\{[^}]*\}/)
    expect(source).not.toContain('process.env.ACME_TOKEN')
  })

  test('generated command metadata does not expose auth requirements through core command contracts', () => {
    const source = generate(workersAuthProduct)
    expect(source).not.toContain(`auth: { required: true, status: 'requires-runtime-resolution'`)
    expect(source).not.toContain(`envVars: ['ACME_TOKEN', 'ACME_CI_TOKEN']`)
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
    expect(source).not.toContain('@liche/auth')
    const importLine = source.match(/import \{ ([^}]+) \} from '@liche\/core'/)
    expect(importLine?.[1]).toBe('callHttpOperation, defineCli, defineCommand, help, outputControls, reflectionControls, version, z')
    expect(source).toContain(`import { config as configExtension, configDoctor, files } from '@liche/config'`)
    expect(source).toContain(`import { jsonlFileSink, telemetry } from '@liche/telemetry'`)
    expect(source).toContain(`async function runGeneratedLocalDoctor`)
    expect(source).not.toContain(`@liche/extensions/support`)
    expect(source).not.toContain(`runLocalDoctor`)
  })

  test('OAuth/session product emits file-session auth commands and OAuth runtime metadata', () => {
    const source = generate(oauthProduct())
    expect(source).toContain(`const PRODUCT_ID = 'workers-oauth'`)
    expect(source).toContain(`const PROFILE_ENV_VAR = 'WORKERS_OAUTH_PROFILE'`)
    expect(source).toContain(`{ kind: 'session', profiles: true, refresh: false }`)
    expect(source).toContain(`oauthDevice: { clientId: 'acme-cli'`)
    expect(source).toContain(`identity: { http: { method: 'GET', path: '/me' }, subject: 'id', label: 'email' }`)
    expect(source).toContain(`path: ['whoami'],`)
    expect(source).toContain(`path: ['switch'],`)
    expect(source).toContain(`path: ['login'],`)
    expect(source).toContain(`path: ['logout'],`)
    expect(source).toContain(`interactive: true`)
    expect(source).toContain(`createFileSessionStore`)
    expect(source).toContain(`oauthDeviceLogin`)
    expect(source).toContain(`authWhoami`)
    expect(source).toContain(`logoutAuthSession`)
    expect(source).not.toContain('.reveal(')
  })
})

describe('generated CLI runtime — auth fixture executes resolveAuth/resolveContext via @liche/auth', () => {
  let dir: string
  let modulePath: string
  let savedEnv: Record<string, string | undefined> = {}

  beforeEach(async () => {
    // Generate inside the workspace so @liche/core resolves via the workspace's
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
      LICHE_HOME: process.env.LICHE_HOME,
    }
    delete process.env.ACME_TOKEN
    delete process.env.ACME_CI_TOKEN
    delete process.env.ACME_ORG_ID
    delete process.env.CI
    delete process.env.LICHE_HOME
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
    isTty = false,
  ): Promise<{ stdout: string; exitCode: number }> {
    const mod = (await import(modulePath)) as { default: CliInstance }
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
      isTty,
      env,
    }
    if (stdin) opts.stdin = stdin
    await run(mod.default, argv, opts)
    return { stdout, exitCode }
  }

  test('missing ACME_TOKEN under CLI invocation fails with AUTH_MISSING (no transport reached)', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--org', 'acme-corp', '--json'])
    expect(exitCode).toBe(1)
    expect(stdout).toContain('AUTH_MISSING')
    expect(stdout).not.toContain('REMOTE_NOT_IMPLEMENTED')
  })

  test('with ACME_TOKEN injected through RunOptions.env, generated remote command calls core HTTP transport', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe('/orgs/acme-corp/purge_cache')
        expect(request.method).toBe('POST')
        expect(request.headers.get('authorization')).toBe('Bearer tok-runtime')
        return Response.json({})
      },
    })
    try {
      const { stdout, exitCode } = await runGenerated(['purge', '--org', 'acme-corp', '--json'], {
        ACME_API_BASE_URL: server.url.origin,
        ACME_TOKEN: 'tok-runtime',
      })
      expect(exitCode).toBe(0)
      expect(JSON.parse(stdout)).toMatchObject({
        ok: true,
        data: {},
        meta: { execution: { mode: 'remote-http', source: 'env' } },
      })
      expect(stdout).not.toContain('AUTH_MISSING')
      expect(stdout).not.toContain('tok-runtime')
    } finally {
      server.stop(true)
    }
  })

  test('context env fallback reaches resolveContext when --org is omitted', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe('/orgs/env-org/purge_cache')
        return Response.json({})
      },
    })
    try {
      const { stdout, exitCode } = await runGenerated(['purge', '--json'], {
        ACME_API_BASE_URL: server.url.origin,
        ACME_TOKEN: 'tok-runtime',
        ACME_ORG_ID: 'env-org',
      })
      expect(exitCode).toBe(0)
      expect(stdout).not.toContain('VALIDATION_ERROR')
      expect(stdout).not.toContain('AUTH_CONTEXT_REQUIRED')
    } finally {
      server.stop(true)
    }
  })

  test('missing context produces AUTH_CONTEXT_REQUIRED instead of option validation', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--json'], {
      ACME_TOKEN: 'tok-runtime',
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('AUTH_CONTEXT_REQUIRED')
    expect(stdout).not.toContain('VALIDATION_ERROR')
  })

  test('CI invocation can use a ci-mode token source from RunOptions.env', async () => {
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.headers.get('authorization')).toBe('Bearer ci-token')
        return Response.json({})
      },
    })
    try {
      const { stdout, exitCode } = await runGenerated(['purge', '--json'], {
        CI: 'true',
        ACME_API_BASE_URL: server.url.origin,
        ACME_CI_TOKEN: 'ci-token',
        ACME_ORG_ID: 'env-org',
      })
      expect(exitCode).toBe(0)
      expect(stdout).not.toContain('AUTH_MISSING')
      expect(stdout).not.toContain('ci-token')
    } finally {
      server.stop(true)
    }
  })

  test('401 and 403 responses map through generated resolved-auth semantics without leaking tokens', async () => {
    for (const [status, code] of [[401, 'AUTH_INVALID'], [403, 'AUTH_PERMISSION_DENIED']] as const) {
      const server = Bun.serve({
        port: 0,
        fetch() {
          return Response.json({ token: 'tok-runtime' }, { status })
        },
      })
      try {
        const { stdout, exitCode } = await runGenerated(['purge', '--org', 'acme-corp', '--json'], {
          ACME_API_BASE_URL: server.url.origin,
          ACME_TOKEN: 'tok-runtime',
        })
        expect(exitCode).toBe(1)
        expect(stdout).toContain(code)
        expect(stdout).not.toContain('tok-runtime')
      } finally {
        server.stop(true)
      }
    }
  })

  test('CI invocation without a token source fails with AUTH_CI_TOKEN_MISSING', async () => {
    const { stdout, exitCode } = await runGenerated(['purge', '--json'], {
      CI: 'true',
      ACME_ORG_ID: 'env-org',
    })
    expect(exitCode).toBe(1)
    expect(stdout).toContain('AUTH_CI_TOKEN_MISSING')
  })

  test('missing config-backed remote base URL fails before transport', async () => {
    writeFileSync(modulePath, generate(optionalConfigRemoteProduct()), 'utf8')

    const { stdout, exitCode } = await runGenerated(['ping', '--json'])

    expect(exitCode).toBe(1)
    const body = JSON.parse(stdout)
    expect(body.error).toMatchObject({
      code: 'REMOTE_CONFIG_MISSING_BASE_URL',
      code_actions: [{ title: 'Inspect config', argv: ['config', 'doctor'] }],
      suggested_fix: 'Set apiBaseUrl in config before retrying.',
    })
    expect(stdout).not.toContain('REMOTE_NETWORK')
  })

  test('generated doctor reports auth, session, and context readiness without leaking token values', async () => {
    writeFileSync(modulePath, generate(oauthProduct()), 'utf8')

    const { stdout, exitCode } = await runGenerated(['doctor', '--json'], {
      PATH: '/tmp/project/node_modules/.bin',
      ACME_TOKEN: 'tok-runtime',
    })

    expect(exitCode).toBe(0)
    const body = JSON.parse(stdout)
    const checks = body.data.checks as Array<{ id: string; status: string; details?: Record<string, unknown> }>
    const byId = Object.fromEntries(checks.map((check) => [check.id, check]))
    expect(checks.map((check) => check.id)).toEqual([
      'path.present',
      'path.local-bin',
      'package-manager.bun',
      'product.catalog',
      'product.config',
      'remote.base-url',
      'auth.provider',
      'auth.env.ACME_TOKEN',
      'auth.env.ACME_CI_TOKEN',
      'auth.session-store',
      'context.org',
      'agent.commands',
      'notices.updates',
      'notices.channels',
      'notices.yanks',
      'release.metadata',
    ])
    expect(byId['remote.base-url']).toMatchObject({
      status: 'pass',
      details: { source: 'schema-default' },
    })
    expect(byId['auth.provider']).toMatchObject({
      status: 'pass',
      details: { providerId: 'acme', kind: 'oauthDevice' },
    })
    expect(byId['auth.env.ACME_TOKEN']).toMatchObject({
      status: 'pass',
      details: { envVar: 'ACME_TOKEN', mode: 'any' },
    })
    expect(byId['auth.env.ACME_CI_TOKEN']).toMatchObject({
      status: 'warn',
      details: { envVar: 'ACME_CI_TOKEN', mode: 'ci' },
    })
    expect(byId['auth.session-store']).toMatchObject({
      status: 'pass',
      details: { profiles: true, refresh: false },
    })
    expect(byId['context.org']).toMatchObject({
      status: 'warn',
      details: { envVar: 'ACME_ORG_ID', flag: 'org' },
    })
    expect(byId['agent.commands']).toMatchObject({
      status: 'warn',
      details: { visible: ['auth.whoami', 'purge'], underAnnotated: ['purge'] },
    })
    expect(byId['release.metadata']).toMatchObject({ status: 'warn' })
    expect(body.data.summary).toEqual({ pass: 10, warn: 5, fail: 1 })
    expect(JSON.stringify(body)).not.toContain('tok-runtime')
  })

  test('--llms --json command manifest does not expose core auth metadata', async () => {
    const { stdout, exitCode } = await runGenerated(['--llms', '--json'])
    expect(exitCode).toBe(0)
    const manifest = JSON.parse(stdout)
    const purge = manifest.commands.find((c: { name: string }) => c.name === 'purge')
    expect(purge).toBeDefined()
    expect(purge.auth).toBeUndefined()
    expect(JSON.stringify(purge)).not.toContain('tok-runtime')
  })

  test('MCP tools/list does not expose core auth metadata', async () => {
    const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const { stdout, exitCode } = await runGenerated(['--mcp'], {}, asyncIter([`${request}\n`]))
    expect(exitCode).toBe(0)
    const response = JSON.parse(stdout.trim())
    const purge = response.result.tools.find((tool: { name: string }) => tool.name === 'purge')
    expect(purge).toBeDefined()
    expect(purge.auth).toBeUndefined()
    expect(JSON.stringify(purge)).not.toContain('tok-runtime')
  })

  test('generated OAuth login/whoami/switch/logout round-trip through file sessions', async () => {
    writeFileSync(modulePath, generate(oauthProduct()), 'utf8')
    process.env.LICHE_HOME = join(dir, 'home')
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/device')) {
        expect(init?.method).toBe('POST')
        return Response.json({
          device_code: 'device-1',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.example.test/activate',
          expires_in: 60,
          interval: 1,
        })
      }
      if (url.endsWith('/token')) {
        return Response.json({ access_token: 'oauth-token', expires_in: 3600, scope: 'cache.write' })
      }
      if (url.endsWith('/me')) {
        expect((init?.headers as Headers).get('authorization')).toBe('Bearer oauth-token')
        return Response.json({ id: 'u_1', email: 'dev@example.test' })
      }
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch
    try {
      const login = await runGenerated(['login', '--json'], {}, undefined, true)
      expect(login.exitCode).toBe(0)
      expect(JSON.stringify(JSON.parse(login.stdout))).not.toContain('oauth-token')

      const switched = await runGenerated(['switch', '--org', 'org_1', '--json'])
      expect(switched.exitCode).toBe(0)
      expect(JSON.parse(switched.stdout).data).toMatchObject({ profile: 'default', contexts: { org: 'org_1' } })

      const whoami = await runGenerated(['whoami', '--json'])
      expect(whoami.exitCode).toBe(0)
      expect(JSON.parse(whoami.stdout).data).toMatchObject({
        authenticated: true,
        source: 'session',
        profile: 'default',
        account: { id: 'u_1', label: 'dev@example.test' },
        contexts: { org: 'org_1' },
      })
      expect(whoami.stdout).not.toContain('oauth-token')

      const logout = await runGenerated(['logout', '--json'])
      expect(logout.exitCode).toBe(0)
      expect(JSON.parse(logout.stdout).data).toMatchObject({ authenticated: false, deleted: 1, profile: 'default' })

      const after = await runGenerated(['whoami', '--json'])
      expect(JSON.parse(after.stdout).data).toEqual({ authenticated: false })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('generated MCP path never uses stored session implicitly and hides interactive auth commands', async () => {
    writeFileSync(modulePath, generate(oauthProduct()), 'utf8')
    process.env.LICHE_HOME = join(dir, 'home')
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/device')) {
        return Response.json({
          device_code: 'device-1',
          user_code: 'ABCD-EFGH',
          verification_uri: 'https://auth.example.test/activate',
          expires_in: 60,
          interval: 1,
        })
      }
      if (url.endsWith('/token')) return Response.json({ access_token: 'oauth-token', expires_in: 3600 })
      if (url.endsWith('/me')) return Response.json({ id: 'u_1', email: 'dev@example.test' })
      throw new Error(`unexpected fetch ${url}`)
    }) as typeof fetch
    try {
      expect((await runGenerated(['login', '--json'], {}, undefined, true)).exitCode).toBe(0)
      const listRequest = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      const list = await runGenerated(['--mcp'], {}, asyncIter([`${listRequest}\n`]))
      const toolNames = JSON.parse(list.stdout).result.tools.map((tool: { name: string }) => tool.name)
      expect(toolNames).toContain('whoami')
      expect(toolNames).toContain('purge')
      expect(toolNames).not.toContain('login')
      expect(toolNames).not.toContain('logout')
      expect(toolNames).not.toContain('switch')

      const callRequest = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'purge',
          arguments: { options: { org: 'org_1' } },
        },
      })
      const call = await runGenerated(['--mcp'], {}, asyncIter([`${callRequest}\n`]))
      const response = JSON.parse(call.stdout)
      expect(response.result.isError).toBe(true)
      expect(JSON.parse(response.result.content[0].text).code).toBe('AUTH_MISSING')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
