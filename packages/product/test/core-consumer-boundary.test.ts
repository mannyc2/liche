import { describe, expect, test } from 'bun:test'
import * as Core from '@lili/core'

// Frozen public surface of @lili/core, mirrored from packages/core/test/api-snapshot.test.ts
// and docs/core-api-boundary.md. Asserts package-level resolution (not just source-relative
// imports) so generated code in @lili/product can only depend on the approved API.
const FROZEN_PUBLIC_VALUES = [
  'commandError',
  'createConfig',
  'Formatter',
  'applyAuth',
  'authSwitch',
  'authWhoami',
  'callHttpOperation',
  'createFileSessionStore',
  'createLocalTelemetrySink',
  'defineCli',
  'defineCommand',
  'fail',
  'logoutAuthSession',
  'middleware',
  'oauthDeviceLogin',
  'ok',
  'resolveAuth',
  'resolveContext',
  'runLocalDoctor',
  'serializeHttpOperationRequest',
  'secret',
  'z',
].sort()

describe('@lili/core package consumer boundary', () => {
  test('package-level import exposes only the frozen surface', () => {
    expect(Object.keys(Core).sort()).toEqual(FROZEN_PUBLIC_VALUES)
  })
})
