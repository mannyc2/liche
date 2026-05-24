import { describe, expect, test } from 'bun:test'
import { secret } from '../../src/auth/secret.js'
import { applyAuth } from '../../src/auth/resolve.js'
import type { AuthCredential } from '../../src/auth/types.js'

function bearer(token: string, header?: string): AuthCredential {
  return {
    providerId: 'acme',
    source: 'env',
    kind: 'bearer',
    secret: secret(token),
    ...(header ? { header } : {}),
    refreshAvailable: false,
  }
}

function apiKey(token: string, header?: string): AuthCredential {
  return {
    providerId: 'acme',
    source: 'env',
    kind: 'apiKey',
    secret: secret(token),
    ...(header ? { header } : {}),
    refreshAvailable: false,
  }
}

describe('applyAuth', () => {
  test('bearer credential writes Authorization: Bearer <token>', () => {
    const headers = new Headers()
    applyAuth(headers, bearer('tok-2'))
    expect(headers.get('authorization')).toBe('Bearer tok-2')
  })

  test('bearer credential honors a custom header when provider declares one', () => {
    const headers = new Headers()
    applyAuth(headers, bearer('v', 'X-Bearer'))
    expect(headers.get('x-bearer')).toBe('Bearer v')
  })

  test('apiKey credential writes raw value into the declared header', () => {
    const headers = new Headers()
    applyAuth(headers, apiKey('k-1', 'x-api-key'))
    expect(headers.get('x-api-key')).toBe('k-1')
  })

  test('apiKey credential without a declared header falls back to x-api-key', () => {
    const headers = new Headers()
    applyAuth(headers, apiKey('v'))
    expect(headers.get('x-api-key')).toBe('v')
  })
})
