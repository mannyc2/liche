import { describe, expect, test } from 'bun:test'
import {
  AUTH_CODES,
  type AuthErrorDetails,
  authCiTokenMissing,
  authContextRequired,
  authExpired,
  authInvalid,
  authInteractiveRequired,
  authMissing,
  authPermissionDenied,
  authSessionCorrupt,
  authSessionLocked,
  authScopeMissing,
} from '../../src/auth/errors.js'
import { LiliError, errorToObject } from '../../src/errors/error.js'

const detailsOf = (e: LiliError) => e.details as AuthErrorDetails | undefined

describe('AUTH_* error factories', () => {
  test('every factory returns a LiliError with the right code and exitCode 1', () => {
    const samples = [
      authMissing({ providerId: 'acme', envVars: ['ACME_TOKEN'] }),
      authCiTokenMissing({ providerId: 'acme', envVars: ['ACME_TOKEN'] }),
      authContextRequired({ providerId: 'acme', contexts: [{ id: 'org', envVar: 'ACME_ORG_ID', flag: 'org' }] }),
      authScopeMissing({ providerId: 'acme', missingScopes: ['deployments:write'] }),
      authPermissionDenied({ providerId: 'acme', requiredPermissions: ['admin'] }),
      authInvalid({ providerId: 'acme' }),
      authExpired({ providerId: 'acme' }),
      authInteractiveRequired({ providerId: 'acme' }),
      authSessionCorrupt({ providerId: 'acme', profile: 'default' }),
      authSessionLocked({ providerId: 'acme', profile: 'default' }),
    ]
    for (const e of samples) {
      expect(e).toBeInstanceOf(LiliError)
      expect(e.code.startsWith('AUTH_')).toBe(true)
      expect(e.exitCode).toBe(1)
    }
  })

  test('authMissing surfaces login command and env vars in the message and details', () => {
    const e = authMissing({
      providerId: 'acme',
      envVars: ['ACME_TOKEN'],
      loginCommand: 'acme login',
      requiredPermissions: ['deployments:write'],
    })
    expect(e.code).toBe(AUTH_CODES.MISSING)
    expect(e.shortMessage).toContain('acme login')
    expect(e.shortMessage).toContain('ACME_TOKEN')
    expect(e.details).toEqual({
      providerId: 'acme',
      envVars: ['ACME_TOKEN'],
      loginCommand: 'acme login',
      requiredPermissions: ['deployments:write'],
    })
    expect(e.suggested_fix).toContain('acme login')
    expect(e.code_actions).toEqual([
      { title: 'Log in', command: 'acme login' },
      { title: 'Set auth environment', description: 'Set ACME_TOKEN before retrying.' },
    ])
  })

  test('authMissing without login command only mentions env vars', () => {
    const e = authMissing({ providerId: 'acme', envVars: ['ACME_TOKEN'] })
    expect(e.shortMessage).toContain('ACME_TOKEN')
    expect(e.shortMessage).not.toContain('login')
  })

  test('authCiTokenMissing includes only env var names', () => {
    const e = authCiTokenMissing({ providerId: 'acme', envVars: ['ACME_TOKEN', 'ACME_CI_TOKEN'] })
    expect(e.code).toBe(AUTH_CODES.CI_TOKEN_MISSING)
    expect(e.shortMessage).toContain('ACME_TOKEN')
    expect(e.shortMessage).toContain('ACME_CI_TOKEN')
    expect(e.details).toEqual({
      providerId: 'acme',
      envVars: ['ACME_TOKEN', 'ACME_CI_TOKEN'],
    })
  })

  test('authContextRequired lists each context with env and flag', () => {
    const e = authContextRequired({
      providerId: 'acme',
      contexts: [
        { id: 'org', envVar: 'ACME_ORG_ID', flag: 'org' },
        { id: 'project', envVar: 'ACME_PROJECT_ID', flag: 'project' },
      ],
    })
    expect(e.code).toBe(AUTH_CODES.CONTEXT_REQUIRED)
    expect(e.shortMessage).toContain('org')
    expect(e.shortMessage).toContain('project')
    expect(detailsOf(e)?.requiredContexts).toHaveLength(2)
  })

  test('authScopeMissing names only the missing scopes, not the credential', () => {
    const e = authScopeMissing({
      providerId: 'acme',
      missingScopes: ['deployments:write'],
      requiredPermissions: ['deployments:write'],
    })
    expect(e.code).toBe(AUTH_CODES.SCOPE_MISSING)
    expect(e.shortMessage).toContain('deployments:write')
    expect(detailsOf(e)?.missingScopes).toEqual(['deployments:write'])
  })

  test('authPermissionDenied defaults status to 403 and does not include secrets', () => {
    const e = authPermissionDenied({ providerId: 'acme', requiredPermissions: ['admin'] })
    expect(e.code).toBe(AUTH_CODES.PERMISSION_DENIED)
    expect(detailsOf(e)?.status).toBe(403)
    expect(JSON.stringify(e.details)).not.toMatch(/token|secret|bearer/i)
  })

  test('authInvalid defaults status to 401', () => {
    const e = authInvalid({ providerId: 'acme' })
    expect(detailsOf(e)?.status).toBe(401)
  })

  test('errorToObject propagates AUTH_* details into CommandError envelope', () => {
    const e = authMissing({ providerId: 'acme', envVars: ['ACME_TOKEN'], loginCommand: 'acme login' })
    const envelope = errorToObject(e)
    expect(envelope.code).toBe('AUTH_MISSING')
    expect(envelope.exitCode).toBe(1)
    expect(envelope.details).toEqual({
      providerId: 'acme',
      envVars: ['ACME_TOKEN'],
      loginCommand: 'acme login',
      requiredPermissions: undefined,
    })
    expect(envelope.suggested_fix).toContain('acme login')
    expect(envelope.code_actions).toEqual([
      { title: 'Log in', command: 'acme login' },
      { title: 'Set auth environment', description: 'Set ACME_TOKEN before retrying.' },
    ])
  })

  test('AUTH_CODES contains every required 3D-A code', () => {
    expect(Object.values(AUTH_CODES)).toEqual(
      expect.arrayContaining([
        'AUTH_MISSING',
        'AUTH_CI_TOKEN_MISSING',
        'AUTH_INVALID',
        'AUTH_EXPIRED',
        'AUTH_CONTEXT_REQUIRED',
        'AUTH_SCOPE_MISSING',
        'AUTH_PERMISSION_DENIED',
        'AUTH_INTERACTIVE_REQUIRED',
        'AUTH_SESSION_CORRUPT',
        'AUTH_SESSION_LOCKED',
      ]),
    )
  })
})
