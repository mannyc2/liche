import { describe, expect, test } from 'bun:test'
import { createRedactionPolicy } from '../src/internal/redact.js'

const policy = createRedactionPolicy()
const r = (v: unknown): unknown => policy.redact(v)

describe('string-pattern rules', () => {
  test('bearer (RFC 6750)', () => {
    expect(r('Authorization: Bearer abc.def-ghi/jkl+mno=')).toBe('Authorization: [redacted]')
  })

  test('JWT (RFC 7519)', () => {
    expect(r('token=eyJhbGciOi.eyJzdWIiOi.SflKxwRJSM')).toBe('token=[redacted]')
  })

  test('GitHub PAT classic (ghp_/gho_/ghu_/ghs_/ghr_)', () => {
    expect(r('ghp_1234567890abcdefghijklmnopqrstuvwxyz')).toBe('[redacted]')
    expect(r('gho_1234567890abcdefghijklmnopqrstuvwxyz')).toBe('[redacted]')
    expect(r('ghs_1234567890abcdefghijklmnopqrstuvwxyz')).toBe('[redacted]')
  })

  test('GitHub fine-grained PAT', () => {
    const tok = 'github_pat_' + 'A'.repeat(82)
    expect(r(`use ${tok} for auth`)).toBe('use [redacted] for auth')
  })

  test('AWS Access Key ID (AKIA / ASIA)', () => {
    expect(r('AKIAIOSFODNN7EXAMPLE')).toBe('[redacted]')
    expect(r('ASIAY34FZKBOKMUTVV7A')).toBe('[redacted]')
  })

  test('Stripe sk_live_ / sk_test_ / rk_live_', () => {
    expect(r(`sk_${'live'}_4eC39HqLyjWDarjtT1zdp7dc`)).toBe('[redacted]')
    expect(r(`sk_${'test'}_4eC39HqLyjWDarjtT1zdp7dc`)).toBe('[redacted]')
    expect(r(`rk_${'live'}_4eC39HqLyjWDarjtT1zdp7dc`)).toBe('[redacted]')
  })

  test('Slack tokens (xoxb-/xoxp-/xoxe./xapp-)', () => {
    expect(r('xoxb-1234567890-abcdefghijklm')).toBe('[redacted]')
    expect(r('xoxp-1234567890-abcdefghijklm')).toBe('[redacted]')
    expect(r('xapp-A1234567890-abc')).toBe('[redacted]')
  })

  test('Google API key (AIza)', () => {
    expect(r('AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe')).toBe('[redacted]')
  })

  test('OpenAI keys (sk-/sk-proj-/sk-svcacct-)', () => {
    expect(r('sk-' + 'A'.repeat(48))).toBe('[redacted]')
    expect(r('sk-proj-' + 'A'.repeat(48))).toBe('[redacted]')
    expect(r('sk-svcacct-' + 'A'.repeat(48))).toBe('[redacted]')
  })

  test('npm tokens (npm_)', () => {
    expect(r('npm_' + 'a'.repeat(36))).toBe('[redacted]')
  })

  test('inline-secret-value (quoted)', () => {
    expect(r('config = { "apiKey": "supersecret" }')).toContain('"[redacted]"')
    expect(r('config = { "apiKey": "supersecret" }')).not.toContain('supersecret')
  })
})

describe('field-name redaction (key match)', () => {
  test('top-level secret-shaped keys collapse value', () => {
    expect(r({ token: 'plain', authorization: 'plain', apiKey: 'plain', api_key: 'plain', password: 'plain', secret: 'plain', privateKey: 'plain' })).toEqual({
      token: '[redacted]',
      authorization: '[redacted]',
      apiKey: '[redacted]',
      api_key: '[redacted]',
      password: '[redacted]',
      secret: '[redacted]',
      privateKey: '[redacted]',
    })
  })

  test('nested secret-shaped keys', () => {
    expect(r({ outer: { inner: { token: 'plain' } } })).toEqual({ outer: { inner: { token: '[redacted]' } } })
  })

  test('non-secret keys pass through but their string values still get pattern-redacted', () => {
    expect(r({ message: 'Bearer abc.def-ghi' })).toEqual({ message: '[redacted]' })
  })
})

describe('type-preserving redaction', () => {
  test('string-typed secret → string sentinel', () => {
    expect(r({ token: 'plain' })).toEqual({ token: '[redacted]' })
  })

  test('array-typed secret → [sentinel]', () => {
    expect(r({ token: ['a', 'b'] })).toEqual({ token: ['[redacted]'] })
  })

  test('object-typed secret → { [sentinel]: true }', () => {
    expect(r({ token: { nested: 1 } })).toEqual({ token: { '[redacted]': true } })
  })

  test('number/boolean-typed secret → string sentinel (best-effort fallback)', () => {
    expect(r({ token: 12345 })).toEqual({ token: '[redacted]' })
    expect(r({ token: true })).toEqual({ token: '[redacted]' })
  })
})

describe('structural integrity', () => {
  test('arrays preserved', () => {
    expect(r({ items: ['ok', 'Bearer abc.def', 'also-ok'] })).toEqual({ items: ['ok', '[redacted]', 'also-ok'] })
  })

  test('idempotent — running redact twice yields same result', () => {
    const input = { token: 'plain', message: 'Bearer abc.def', nested: { apiKey: 'k' } }
    const once = r(input)
    const twice = r(once)
    expect(twice).toEqual(once)
  })

  test('non-secret data passes through unchanged', () => {
    const input = { name: 'shipyard', count: 42, ok: true, items: ['a', 'b'] }
    expect(r(input)).toEqual(input)
  })

  test('null and undefined preserved', () => {
    expect(r(null)).toBe(null)
    expect(r(undefined)).toBe(undefined)
    expect(r({ a: null, b: undefined })).toEqual({ a: null, b: undefined })
  })
})

describe('extension API', () => {
  test('extraSecretKeys extends key matcher', () => {
    const p = createRedactionPolicy({ extraSecretKeys: [/^customSecret$/i] })
    expect(p.redact({ customSecret: 'x', other: 'y' })).toEqual({ customSecret: '[redacted]', other: 'y' })
  })

  test('extraStringPatterns extends string matcher (RegExp form)', () => {
    const p = createRedactionPolicy({ extraStringPatterns: [/CUSTOM-[A-Z0-9]{8}/g] })
    expect(p.redact('id=CUSTOM-ABCD1234 ok')).toBe('id=[redacted] ok')
  })

  test('extraStringPatterns extends string matcher (StringRule form, named)', () => {
    const p = createRedactionPolicy({ extraStringPatterns: [{ name: 'my-prefix', pattern: /MY-[A-Z]{4}/g }] })
    expect(p.ruleNames).toContain('my-prefix')
    expect(p.redact('MY-ABCD')).toBe('[redacted]')
  })

  test('custom redactor runs AFTER built-ins (cannot weaken)', () => {
    const p = createRedactionPolicy({
      redactor: (v) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const c = { ...(v as Record<string, unknown>) }
          c['runCount'] = ((c['runCount'] as number) ?? 0) + 1
          return c
        }
        return v
      },
    })
    const out = p.redact({ token: 'plain', runCount: 0 }) as Record<string, unknown>
    expect(out['token']).toBe('[redacted]')
    expect(out['runCount']).toBe(1)
  })
})

describe('ruleNames disclosure (for release manifest)', () => {
  test('lists every built-in rule plus field-name', () => {
    const p = createRedactionPolicy()
    expect(p.ruleNames).toContain('bearer')
    expect(p.ruleNames).toContain('jwt')
    expect(p.ruleNames).toContain('github-pat-classic')
    expect(p.ruleNames).toContain('github-pat-fine-grained')
    expect(p.ruleNames).toContain('aws-akia')
    expect(p.ruleNames).toContain('stripe')
    expect(p.ruleNames).toContain('slack')
    expect(p.ruleNames).toContain('google-api')
    expect(p.ruleNames).toContain('openai')
    expect(p.ruleNames).toContain('npm')
    expect(p.ruleNames).toContain('inline-secret-value')
    expect(p.ruleNames).toContain('field-name-secrets')
  })
})
