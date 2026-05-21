import { describe, expect, test } from 'bun:test'
import * as Api from '../src/index.js'

const FROZEN_PUBLIC_VALUES = [
  'BuildRecordSchema',
  'TARGETS',
  'TARGET_PRESETS',
  'buildBinaries',
  'canonicalDigest',
  'canonicalize',
  'compileEntrypoint',
  'compileFlagsDigest',
  'createCompileFlagProfile',
  'createCompilePlan',
  'isTargetPreset',
  'parseBuildRecord',
  'renderCompileEntrypoint',
  'resolveTargets',
].sort()

describe('public API snapshot', () => {
  test('packages/build public value exports match the frozen surface', () => {
    expect(Object.keys(Api).sort()).toEqual(FROZEN_PUBLIC_VALUES)
  })
})
