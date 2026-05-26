import { describe, expect, test } from 'bun:test'
import { resolveConsent } from '../src/internal/consent.js'

const base = { cliName: 'shipyard', invocation: 'cli' as const }

describe('precedence — DO_NOT_TRACK kill switch', () => {
  test('DO_NOT_TRACK=1 overrides every other enable', () => {
    expect(
      resolveConsent({
        ...base,
        env: { DO_NOT_TRACK: '1', LICHE_TELEMETRY: '1', SHIPYARD_TELEMETRY: '1', LICHE_TELEMETRY_CLI: '1' },
      }),
    ).toEqual({ enabled: false, reason: 'do-not-track', source: 'DO_NOT_TRACK' })
  })

  test('DO_NOT_TRACK=0 does NOT kill (consoledonottrack.com semantics)', () => {
    expect(resolveConsent({ ...base, env: { DO_NOT_TRACK: '0', LICHE_TELEMETRY: '1' } })).toMatchObject({ enabled: true })
  })

  test('DO_NOT_TRACK="" does NOT kill', () => {
    expect(resolveConsent({ ...base, env: { DO_NOT_TRACK: '', LICHE_TELEMETRY: '1' } })).toMatchObject({ enabled: true })
  })

  test('respectDoNotTrack=false ignores DO_NOT_TRACK', () => {
    expect(resolveConsent({ ...base, respectDoNotTrack: false, env: { DO_NOT_TRACK: '1', LICHE_TELEMETRY: '1' } })).toMatchObject({ enabled: true })
  })
})

describe('precedence — disable wins', () => {
  test('LICHE_TELEMETRY=0 kills despite ${CLI}_TELEMETRY=1', () => {
    expect(resolveConsent({ ...base, env: { LICHE_TELEMETRY: '0', SHIPYARD_TELEMETRY: '1' } })).toMatchObject({
      enabled: false,
      reason: 'liche-disabled',
    })
  })

  test('${CLI}_TELEMETRY=0 kills despite LICHE_TELEMETRY=1', () => {
    expect(resolveConsent({ ...base, env: { LICHE_TELEMETRY: '1', SHIPYARD_TELEMETRY: '0' } })).toMatchObject({
      enabled: false,
      reason: 'cli-disabled',
    })
  })

  test('LICHE_TELEMETRY_CLI=0 kills despite ${CLI}_TELEMETRY=1', () => {
    expect(
      resolveConsent({
        ...base,
        env: { LICHE_TELEMETRY: '1', SHIPYARD_TELEMETRY: '1', LICHE_TELEMETRY_CLI: '0' },
      }),
    ).toMatchObject({ enabled: false, reason: 'invocation-disabled' })
  })
})

describe('precedence — enable paths', () => {
  test('LICHE_TELEMETRY=1 enables for cli invocation', () => {
    expect(resolveConsent({ ...base, env: { LICHE_TELEMETRY: '1' } })).toMatchObject({
      enabled: true,
      reason: 'liche-enabled',
    })
  })

  test('${CLI}_TELEMETRY=1 enables for cli invocation', () => {
    expect(resolveConsent({ ...base, env: { SHIPYARD_TELEMETRY: '1' } })).toMatchObject({
      enabled: true,
      reason: 'cli-enabled',
    })
  })

  test('LICHE_TELEMETRY_CLI=1 enables for cli invocation', () => {
    expect(resolveConsent({ ...base, env: { LICHE_TELEMETRY_CLI: '1' } })).toMatchObject({
      enabled: true,
      reason: 'invocation-enabled',
    })
  })
})

describe('invocation defaults', () => {
  test('ci default disabled even with LICHE_TELEMETRY=1', () => {
    expect(resolveConsent({ ...base, invocation: 'ci', env: { LICHE_TELEMETRY: '1' } })).toMatchObject({
      enabled: false,
      reason: 'invocation-not-allowed',
    })
  })

  test('agent default disabled even with ${CLI}_TELEMETRY=1', () => {
    expect(resolveConsent({ ...base, invocation: 'agent', env: { SHIPYARD_TELEMETRY: '1' } })).toMatchObject({
      enabled: false,
      reason: 'invocation-not-allowed',
    })
  })

  test('mcp default disabled', () => {
    expect(resolveConsent({ ...base, invocation: 'mcp', env: { LICHE_TELEMETRY: '1' } })).toMatchObject({
      enabled: false,
      reason: 'invocation-not-allowed',
    })
  })

  test('LICHE_TELEMETRY_CI=1 explicit override enables ci', () => {
    expect(resolveConsent({ ...base, invocation: 'ci', env: { LICHE_TELEMETRY_CI: '1' } })).toMatchObject({
      enabled: true,
      reason: 'invocation-enabled',
    })
  })

  test('allowedInvocations override widens defaults', () => {
    expect(
      resolveConsent({
        ...base,
        invocation: 'agent',
        allowedInvocations: ['cli', 'agent'],
        env: { LICHE_TELEMETRY: '1' },
      }),
    ).toMatchObject({ enabled: true, reason: 'liche-enabled' })
  })
})

describe('default state — no env vars set', () => {
  test('empty env → disabled, no-consent', () => {
    expect(resolveConsent({ ...base, env: {} })).toEqual({ enabled: false, reason: 'no-consent' })
  })
})

describe('value vocabulary', () => {
  test('truthy forms: 1, true, yes, on (case-insensitive)', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'YES', 'on', 'On']) {
      expect(resolveConsent({ ...base, env: { LICHE_TELEMETRY: v } }).enabled).toBe(true)
    }
  })

  test('falsy forms: 0, false, off, no, "" (case-insensitive)', () => {
    for (const v of ['0', 'false', 'FALSE', 'off', 'no', '']) {
      expect(resolveConsent({ ...base, env: { LICHE_TELEMETRY: v } })).toMatchObject({
        enabled: false,
        reason: 'liche-disabled',
      })
    }
  })

  test('unrecognized values treated as unset (disabled, no-consent)', () => {
    expect(resolveConsent({ ...base, env: { LICHE_TELEMETRY: 'maybe' } })).toMatchObject({
      enabled: false,
      reason: 'no-consent',
    })
  })
})

describe('CLI name normalization', () => {
  test('lowercase + dash → uppercase + underscore', () => {
    expect(
      resolveConsent({ env: { 'MY_CLI_TELEMETRY': '1' }, cliName: 'my-cli', invocation: 'cli' }),
    ).toMatchObject({ enabled: true, reason: 'cli-enabled' })
  })
})
