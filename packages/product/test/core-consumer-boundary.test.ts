import { describe, expect, test } from 'bun:test'
import * as Core from '@liche/core'

// Frozen public surface of @liche/core, mirrored from packages/core/test/api-snapshot.test.ts
// and docs/api-boundary.md. Asserts package-level resolution (not just source-relative
// imports) so generated code in @liche/product can only depend on the approved API.
const FROZEN_PUBLIC_VALUES = [
  'arg',
  'checkCommandSurface',
  'collectCommandContracts',
  'commandError',
  'createLifecycleEvent',
  'emitLifecycleEvent',
  'eventCommand',
  'execute',
  'Formatter',
  'buildHelpModel',
  'defaultHelpRenderer',
  'defineCli',
  'defineCommand',
  'defineExtension',
  'defineGlobal',
  'defineOutputRenderer',
  'dispatch',
  'fail',
  'getCliState',
  'manifest',
  'manifestEnvelope',
  'mcpToolName',
  'mergeHooks',
  'middleware',
  'nonInteractiveStdio',
  'ok',
  'outputControls',
  'parseInvocation',
  'parseSchema',
  'parseSchemaAsync',
  'LicheError',
  'ParseError',
  'reflectionControls',
  'run',
  'selectCommand',
  'secret',
  'streamKinds',
  'ValidationError',
  'z',
].sort()

describe('@liche/core package consumer boundary', () => {
  test('package-level import exposes only the frozen surface', () => {
    expect(Object.keys(Core).sort()).toEqual(FROZEN_PUBLIC_VALUES)
  })
})
