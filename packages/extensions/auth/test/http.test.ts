import { describe, expect, test } from 'bun:test'
import { secret } from '@liche/core'
import { applyAuth, credentialHttpAuth } from '../src/index.js'
import type { AuthCredential } from '../src/index.js'

function bearer(token: string, header?: string): AuthCredential {
  return {
    providerId: 'acme',
    source: 'env',
    kind: 'bearer',
    secret: secret(token),
    ...(header ? { header } : undefined),
    refreshAvailable: false,
  }
}

function apiKey(token: string, header?: string): AuthCredential {
  return {
    providerId: 'acme',
    source: 'env',
    kind: 'apiKey',
    secret: secret(token),
    ...(header ? { header } : undefined),
    refreshAvailable: false,
  }
}

describe('@liche/auth HTTP helpers', () => {
  test('applyAuth writes bearer and api-key headers', () => {
    const bearerHeaders = new Headers()
    applyAuth(bearerHeaders, bearer('tok-2'))
    expect(bearerHeaders.get('authorization')).toBe('Bearer tok-2')

    const customBearer = new Headers()
    applyAuth(customBearer, bearer('v', 'X-Bearer'))
    expect(customBearer.get('x-bearer')).toBe('Bearer v')

    const apiHeaders = new Headers()
    applyAuth(apiHeaders, apiKey('k-1', 'x-api-key'))
    expect(apiHeaders.get('x-api-key')).toBe('k-1')

    const defaultApi = new Headers()
    applyAuth(defaultApi, apiKey('v'))
    expect(defaultApi.get('x-api-key')).toBe('v')
  })

  test('credentialHttpAuth returns core HTTP auth without exposing auth workflow types to core', () => {
    const auth = credentialHttpAuth(bearer('tok-3'), { requiredPermissions: ['deploy:write'] })

    expect(auth).toMatchObject({
      kind: 'resolved',
      headers: { authorization: 'Bearer tok-3' },
      secrets: ['tok-3'],
    })
    expect(auth.kind === 'resolved' && auth.statusErrors?.[401]?.code).toBe('AUTH_INVALID')
    expect(auth.kind === 'resolved' && auth.statusErrors?.[403]?.code).toBe('AUTH_PERMISSION_DENIED')
  })
})
