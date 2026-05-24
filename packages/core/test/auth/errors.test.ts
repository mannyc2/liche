import { describe, expect, test } from 'bun:test'
import {
  AUTH_CODES,
  type AuthErrorDetails,
  authInvalid,
  authPermissionDenied,
} from '../../src/auth/errors.js'
import { LicheError } from '../../src/errors/error.js'

const detailsOf = (e: LicheError) => e.details as AuthErrorDetails | undefined

describe('AUTH_* error factories', () => {
  test('every factory returns a LicheError with the right code and exitCode 1', () => {
    const samples = [
      authPermissionDenied({ providerId: 'acme', requiredPermissions: ['admin'] }),
      authInvalid({ providerId: 'acme' }),
    ]
    for (const e of samples) {
      expect(e).toBeInstanceOf(LicheError)
      expect(e.code.startsWith('AUTH_')).toBe(true)
      expect(e.exitCode).toBe(1)
    }
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

  test('AUTH_CODES contains the http-classification codes', () => {
    expect(Object.values(AUTH_CODES)).toEqual(
      expect.arrayContaining(['AUTH_INVALID', 'AUTH_PERMISSION_DENIED']),
    )
  })
})
