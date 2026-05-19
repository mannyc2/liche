import { describe, expect, test } from 'bun:test'
import { isSecretString, secret } from '../../src/auth/secret.js'

const RAW = 'token-value-shhh-12345'

describe('SecretString', () => {
  test('reveal() returns the original value', () => {
    const s = secret(RAW)
    expect(s.reveal()).toBe(RAW)
  })

  test('kind is "lili.secret" brand', () => {
    expect(secret(RAW).kind).toBe('lili.secret')
  })

  test('toString() returns "[redacted]" and never the raw value', () => {
    const s = secret(RAW)
    expect(s.toString()).toBe('[redacted]')
    expect(String(s)).toBe('[redacted]')
    expect(`${s}`).toBe('[redacted]')
    expect(String(s)).not.toContain(RAW)
  })

  test('JSON serialization redacts via toJSON()', () => {
    const wrapped = { auth: secret(RAW), other: 'visible' }
    const json = JSON.stringify(wrapped)
    expect(json).toContain('[redacted]')
    expect(json).not.toContain(RAW)
    expect(JSON.parse(json)).toEqual({ auth: '[redacted]', other: 'visible' })
  })

  test('nested deep JSON.stringify still redacts', () => {
    const nested = { a: { b: { c: [secret(RAW), secret(RAW)] } } }
    expect(JSON.stringify(nested)).not.toContain(RAW)
  })

  test('structuredClone refuses to leak (functions are not cloneable)', () => {
    const s = secret(RAW)
    expect(() => structuredClone(s)).toThrow()
  })

  test('console.log default formatter still redacts via toString', () => {
    const s = secret(RAW)
    const out = `${s}`
    expect(out).toBe('[redacted]')
  })

  test('isSecretString narrows correctly', () => {
    expect(isSecretString(secret(RAW))).toBe(true)
    expect(isSecretString({ kind: 'lili.secret' })).toBe(false)
    expect(isSecretString(null)).toBe(false)
    expect(isSecretString('plain-string')).toBe(false)
    expect(isSecretString({ kind: 'other', reveal: () => 'x' })).toBe(false)
  })

  test('two secrets with the same raw value are independent objects', () => {
    const a = secret(RAW)
    const b = secret(RAW)
    expect(a).not.toBe(b)
    expect(a.reveal()).toBe(b.reveal())
  })
})
