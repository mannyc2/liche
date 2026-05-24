import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  authSwitch,
  authWhoami,
  createFileSessionStore,
  logoutAuthSession,
  oauthDeviceLogin,
} from '../../src/auth/index.js'
import { secret } from '../../src/auth/secret.js'
import type { AuthProviderRuntime } from '../../src/auth/types.js'

const provider: AuthProviderRuntime = {
  id: 'acme',
  kind: 'oauthDevice',
  tokenKind: 'bearer',
  tokenSources: [
    { kind: 'env', envVar: 'ACME_TOKEN' },
    { kind: 'session', profiles: true },
  ],
  oauthDevice: {
    clientId: 'acme-cli',
    endpoints: {
      deviceAuthorization: 'https://auth.example.test/device',
      token: 'https://auth.example.test/token',
    },
    scopes: ['cache.write'],
  },
  identity: {
    http: { method: 'GET', path: '/me' },
    subject: 'id',
    label: 'email',
  },
  session: { enabled: true, profiles: true },
  commands: { login: 'login', logout: 'logout', switch: 'switch', whoami: 'whoami' },
}

async function withStore<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'liche-device-'))
  try {
    return await fn(root)
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
}

describe('OAuth device auth helpers', () => {
  test('explicit login polls the device flow, probes identity, and stores an access-token session', async () => {
    await withStore(async (root) => {
      const store = createFileSessionStore({ root })
      const calls: string[] = []
      const fetcher = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push(String(url))
        if (String(url).endsWith('/device')) {
          expect(init?.method).toBe('POST')
          return Response.json({
            device_code: 'dev_123',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://auth.example.test/activate',
            expires_in: 60,
            interval: 1,
          })
        }
        if (String(url).endsWith('/token')) {
          return Response.json({ access_token: 'oauth-token', expires_in: 3600, scope: 'cache.write' })
        }
        if (String(url).endsWith('/me')) {
          expect((init?.headers as Headers).get('authorization')).toBe('Bearer oauth-token')
          return Response.json({ id: 'u_1', email: 'dev@example.test' })
        }
        throw new Error(`unexpected fetch ${String(url)}`)
      }

      const result = await oauthDeviceLogin({
        baseUrl: 'https://api.example.test',
        env: {},
        fetch: fetcher,
        global: {},
        interactive: true,
        invocation: 'cli',
        loginCommand: 'acme login',
        productId: 'acme',
        provider,
        sessionStore: store,
      })

      expect(calls).toEqual([
        'https://auth.example.test/device',
        'https://auth.example.test/token',
        'https://api.example.test/me',
      ])
      expect(result).toMatchObject({
        authenticated: true,
        source: 'session',
        profile: 'default',
        account: { id: 'u_1', label: 'dev@example.test' },
      })
      const stored = await store.loadProfile('acme', 'acme', 'default')
      expect(stored?.credential?.accessToken?.reveal()).toBe('oauth-token')
      expect(stored?.account).toEqual({ id: 'u_1', label: 'dev@example.test' })
    })
  })

  test('login refuses CI, agent, MCP, and non-interactive paths instead of printing device codes', async () => {
    await withStore(async (root) => {
      const store = createFileSessionStore({ root })
      for (const invocation of ['ci', 'agent', 'mcp'] as const) {
        await expect(oauthDeviceLogin({
          env: {},
          global: {},
          interactive: true,
          invocation,
          productId: 'acme',
          provider,
          sessionStore: store,
        })).rejects.toMatchObject({ code: 'AUTH_INTERACTIVE_REQUIRED' })
      }
      await expect(oauthDeviceLogin({
        env: {},
        global: { nonInteractive: true },
        interactive: true,
        invocation: 'cli',
        productId: 'acme',
        provider,
        sessionStore: store,
      })).rejects.toMatchObject({ code: 'AUTH_INTERACTIVE_REQUIRED' })
    })
  })

  test('whoami, switch, and logout operate on file sessions without exposing secrets', async () => {
    await withStore(async (root) => {
      const store = createFileSessionStore({ root })
      await store.saveProfile('acme', 'acme', 'work', {
        schemaVersion: 1,
        productId: 'acme',
        providerId: 'acme',
        profile: 'work',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        account: { id: 'u_1', label: 'dev@example.test' },
        credential: { kind: 'bearer', accessToken: secret('stored-token') },
      })
      await authSwitch({
        contexts: [{ id: 'org', flag: 'org', envVar: 'ACME_ORG_ID' }],
        env: {},
        global: { profile: 'work' },
        invocation: 'cli',
        productId: 'acme',
        provider,
        sessionStore: store,
        values: { org: 'org_1' },
      })

      const status = await authWhoami({
        env: {},
        global: { profile: 'work' },
        invocation: 'cli',
        productId: 'acme',
        provider,
        sessionStore: store,
      })
      expect(status).toMatchObject({
        authenticated: true,
        source: 'session',
        profile: 'work',
        account: { id: 'u_1', label: 'dev@example.test' },
        contexts: { org: 'org_1' },
      })
      expect(JSON.stringify(status)).not.toContain('stored-token')

      expect(await logoutAuthSession({
        env: {},
        global: { profile: 'work' },
        invocation: 'cli',
        productId: 'acme',
        provider,
        sessionStore: store,
      })).toEqual({ authenticated: false, deleted: 1, profile: 'work' })
      expect(await authWhoami({
        env: {},
        global: { profile: 'work' },
        invocation: 'cli',
        productId: 'acme',
        provider,
        sessionStore: store,
      })).toEqual({ authenticated: false })
    })
  })
})
