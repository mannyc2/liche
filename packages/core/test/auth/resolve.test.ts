import { describe, expect, test } from 'bun:test'
import { isSecretString } from '../../src/auth/secret.js'
import { applyAuth, authMetaFromCredential, resolveAuth, resolveContext } from '../../src/auth/resolve.js'
import type { AuthProviderRuntime, ContextRuntime } from '../../src/auth/types.js'
import { LiliError } from '../../src/errors/error.js'

const bearerProvider: AuthProviderRuntime = {
  id: 'acme',
  kind: 'bearer',
  tokenSources: [{ kind: 'env', envVar: 'ACME_TOKEN', label: 'Bearer token' }],
}

const apiKeyProvider: AuthProviderRuntime = {
  id: 'acme',
  kind: 'apiKey',
  header: 'x-api-key',
  tokenSources: [{ kind: 'env', envVar: 'ACME_API_KEY' }],
}

const noneProvider: AuthProviderRuntime = {
  id: 'public',
  kind: 'none',
  tokenSources: [],
}

const ciOnlyProvider: AuthProviderRuntime = {
  id: 'acme',
  kind: 'bearer',
  tokenSources: [
    { kind: 'env', envVar: 'ACME_CI_TOKEN', mode: 'ci' },
    { kind: 'env', envVar: 'ACME_TOKEN', mode: 'any' },
  ],
}

describe('resolveAuth (env-only, 3D-A)', () => {
  test('Auth.none returns undefined regardless of env or required flag', async () => {
    const a = await resolveAuth({ provider: noneProvider, required: false, invocation: 'cli' })
    const b = await resolveAuth({ provider: noneProvider, required: true, invocation: 'ci' })
    expect(a).toBeUndefined()
    expect(b).toBeUndefined()
  })

  test('bearer env credential wraps the raw value in a SecretString', async () => {
    const cred = await resolveAuth({
      provider: bearerProvider,
      required: true,
      invocation: 'cli',
      env: { ACME_TOKEN: 'tok-1' },
    })
    expect(cred).toBeDefined()
    expect(cred?.kind).toBe('bearer')
    expect(cred?.source).toBe('env')
    expect(isSecretString(cred?.secret)).toBe(true)
    expect(cred?.secret.reveal()).toBe('tok-1')
    expect(JSON.stringify(cred)).toContain('[redacted]')
    expect(JSON.stringify(cred)).not.toContain('tok-1')
  })

  test('apiKey credential preserves the declared header name', async () => {
    const cred = await resolveAuth({
      provider: apiKeyProvider,
      required: true,
      invocation: 'cli',
      env: { ACME_API_KEY: 'key-1' },
    })
    expect(cred?.kind).toBe('apiKey')
    expect(cred?.header).toBe('x-api-key')
  })

  test('missing env credential in CLI invocation → AUTH_MISSING', async () => {
    let caught: unknown
    try {
      await resolveAuth({ provider: bearerProvider, required: true, invocation: 'cli', env: {} })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(LiliError)
    expect((caught as LiliError).code).toBe('AUTH_MISSING')
    expect((caught as LiliError).details).toMatchObject({ envVars: ['ACME_TOKEN'] })
  })

  test('missing env credential in CI invocation → AUTH_CI_TOKEN_MISSING', async () => {
    let caught: unknown
    try {
      await resolveAuth({ provider: bearerProvider, required: true, invocation: 'ci', env: {} })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(LiliError)
    expect((caught as LiliError).code).toBe('AUTH_CI_TOKEN_MISSING')
  })

  test('not-required returns undefined silently when env is missing', async () => {
    const cred = await resolveAuth({ provider: bearerProvider, required: false, invocation: 'cli', env: {} })
    expect(cred).toBeUndefined()
  })

  test('mode "ci" source is skipped under CLI invocation; mode "any" still wins', async () => {
    const cred = await resolveAuth({
      provider: ciOnlyProvider,
      required: true,
      invocation: 'cli',
      env: { ACME_CI_TOKEN: 'ci-only', ACME_TOKEN: 'human-token' },
    })
    expect(cred?.secret.reveal()).toBe('human-token')
  })

  test('mode "ci" source is preferred under CI invocation', async () => {
    const cred = await resolveAuth({
      provider: ciOnlyProvider,
      required: true,
      invocation: 'ci',
      env: { ACME_CI_TOKEN: 'ci-only', ACME_TOKEN: 'human-token' },
    })
    expect(cred?.secret.reveal()).toBe('ci-only')
  })

  test('empty env var string is treated as missing', async () => {
    let caught: unknown
    try {
      await resolveAuth({ provider: bearerProvider, required: true, invocation: 'cli', env: { ACME_TOKEN: '' } })
    } catch (e) {
      caught = e
    }
    expect((caught as LiliError).code).toBe('AUTH_MISSING')
  })

  test('source order is respected: first declared env wins when both are set', async () => {
    const provider: AuthProviderRuntime = {
      id: 'acme',
      kind: 'bearer',
      tokenSources: [
        { kind: 'env', envVar: 'FIRST' },
        { kind: 'env', envVar: 'SECOND' },
      ],
    }
    const cred = await resolveAuth({
      provider,
      required: true,
      invocation: 'cli',
      env: { FIRST: 'first-value', SECOND: 'second-value' },
    })
    expect(cred?.secret.reveal()).toBe('first-value')
  })
})

describe('resolveContext (env+flag, 3D-A)', () => {
  const contexts: ContextRuntime[] = [
    { id: 'org', label: 'Organization', flag: 'org', envVar: 'ACME_ORG_ID' },
    { id: 'project', label: 'Project', flag: 'project', envVar: 'ACME_PROJECT_ID' },
  ]

  test('explicit flag beats env var', async () => {
    const out = await resolveContext({
      contexts,
      required: ['org'],
      explicit: { org: 'flag-org' },
      env: { ACME_ORG_ID: 'env-org' },
    })
    expect(out).toEqual({ org: 'flag-org' })
  })

  test('falls back to env var when no flag is set', async () => {
    const out = await resolveContext({
      contexts,
      required: ['org'],
      explicit: {},
      env: { ACME_ORG_ID: 'env-org' },
    })
    expect(out).toEqual({ org: 'env-org' })
  })

  test('missing context throws AUTH_CONTEXT_REQUIRED naming each missing id and its env/flag', async () => {
    let caught: unknown
    try {
      await resolveContext({
        contexts,
        required: ['org', 'project'],
        explicit: {},
        env: {},
        providerId: 'acme',
      })
    } catch (e) {
      caught = e
    }
    expect((caught as LiliError).code).toBe('AUTH_CONTEXT_REQUIRED')
    const details = (caught as LiliError).details as { requiredContexts: { id: string; envVar?: string; flag?: string }[] }
    expect(details.requiredContexts).toEqual([
      { id: 'org', envVar: 'ACME_ORG_ID', flag: 'org' },
      { id: 'project', envVar: 'ACME_PROJECT_ID', flag: 'project' },
    ])
  })

  test('unknown required context is reported as missing without env/flag info', async () => {
    let caught: unknown
    try {
      await resolveContext({ contexts, required: ['workspace'], explicit: {}, env: {} })
    } catch (e) {
      caught = e
    }
    expect((caught as LiliError).code).toBe('AUTH_CONTEXT_REQUIRED')
  })

  test('returns empty object when no contexts are required', async () => {
    const out = await resolveContext({ contexts, required: [], explicit: {}, env: {} })
    expect(out).toEqual({})
  })
})

describe('applyAuth', () => {
  test('bearer credential writes Authorization: Bearer <token>', async () => {
    const cred = await resolveAuth({
      provider: bearerProvider,
      required: true,
      invocation: 'cli',
      env: { ACME_TOKEN: 'tok-2' },
    })
    const headers = new Headers()
    applyAuth(headers, cred!)
    expect(headers.get('authorization')).toBe('Bearer tok-2')
  })

  test('bearer credential honors a custom header when provider declares one', async () => {
    const provider: AuthProviderRuntime = {
      id: 'acme',
      kind: 'bearer',
      header: 'X-Bearer',
      tokenSources: [{ kind: 'env', envVar: 'TOK' }],
    }
    const cred = await resolveAuth({ provider, required: true, invocation: 'cli', env: { TOK: 'v' } })
    const headers = new Headers()
    applyAuth(headers, cred!)
    expect(headers.get('x-bearer')).toBe('Bearer v')
  })

  test('apiKey credential writes raw value into the declared header', async () => {
    const cred = await resolveAuth({
      provider: apiKeyProvider,
      required: true,
      invocation: 'cli',
      env: { ACME_API_KEY: 'k-1' },
    })
    const headers = new Headers()
    applyAuth(headers, cred!)
    expect(headers.get('x-api-key')).toBe('k-1')
  })

  test('apiKey credential without a declared header falls back to x-api-key', async () => {
    const provider: AuthProviderRuntime = {
      id: 'acme',
      kind: 'apiKey',
      tokenSources: [{ kind: 'env', envVar: 'K' }],
    }
    const cred = await resolveAuth({ provider, required: true, invocation: 'cli', env: { K: 'v' } })
    const headers = new Headers()
    applyAuth(headers, cred!)
    expect(headers.get('x-api-key')).toBe('v')
  })
})

describe('authMetaFromCredential', () => {
  test('undefined credential → { kind: "none" }', () => {
    expect(authMetaFromCredential(undefined)).toEqual({ kind: 'none' })
  })

  test('resolved credential strips the SecretString and exposes only safe metadata', async () => {
    const cred = await resolveAuth({
      provider: bearerProvider,
      required: true,
      invocation: 'cli',
      env: { ACME_TOKEN: 'shh' },
    })
    const meta = authMetaFromCredential(cred)
    expect(meta).toEqual({
      kind: 'resolved',
      providerId: 'acme',
      source: 'env',
      profile: undefined,
      account: undefined,
      scopes: undefined,
      expiresAt: undefined,
    })
    expect(JSON.stringify(meta)).not.toContain('shh')
    expect(JSON.stringify(meta)).not.toContain('redacted')
  })
})
