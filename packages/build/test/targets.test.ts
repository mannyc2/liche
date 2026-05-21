import { describe, expect, test } from 'bun:test'
import { TARGET_PRESETS, TARGETS, isTargetPreset, resolveTargets } from '../src/index.js'

describe('TARGETS table', () => {
  test('lists Bun compile targets with platform + arch facts', () => {
    expect(TARGETS['darwin-arm64']).toMatchObject({
      target: 'bun-darwin-arm64',
      platform: 'darwin',
      arch: 'arm64',
      ext: '',
    })
    expect(TARGETS['linux-x64']).toMatchObject({
      target: 'bun-linux-x64',
      platform: 'linux',
      arch: 'x64',
      libc: 'glibc',
      ext: '',
    })
    expect(TARGETS['linux-x64-musl']).toMatchObject({
      target: 'bun-linux-x64-musl',
      libc: 'musl',
    })
    expect(TARGETS['windows-x64']).toMatchObject({
      target: 'bun-windows-x64',
      platform: 'windows',
      arch: 'x64',
      ext: '.exe',
    })
  })

  test('baseline cpu variants are reachable by id', () => {
    expect(TARGETS['linux-x64-baseline']?.cpuVariant).toBe('baseline')
    expect(TARGETS['windows-x64-baseline']?.cpuVariant).toBe('baseline')
  })
})

describe('TARGET_PRESETS', () => {
  test("'all' preset covers the common multi-platform shape (no baseline variants)", () => {
    expect([...TARGET_PRESETS.all]).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-arm64-musl',
      'linux-x64',
      'linux-x64-musl',
      'windows-x64',
    ])
  })

  test("'homebrew' preset excludes musl + windows", () => {
    expect([...TARGET_PRESETS.homebrew]).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-x64',
    ])
  })

  test("'npm' preset includes musl Linux targets as first-class defaults", () => {
    expect([...TARGET_PRESETS.npm]).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-arm64',
      'linux-arm64-musl',
      'linux-x64',
      'linux-x64-musl',
      'windows-x64',
    ])
  })

  test("'scoop' preset is windows-only", () => {
    expect([...TARGET_PRESETS.scoop]).toEqual(['windows-x64'])
  })
})

describe('isTargetPreset', () => {
  test('recognizes preset names', () => {
    expect(isTargetPreset('all')).toBe(true)
    expect(isTargetPreset('homebrew')).toBe(true)
  })

  test('rejects non-preset strings', () => {
    expect(isTargetPreset('darwin-arm64')).toBe(false)
    expect(isTargetPreset('made-up')).toBe(false)
  })
})

describe('resolveTargets', () => {
  test('resolves a preset to descriptors in canonical order', () => {
    const result = resolveTargets('scoop')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.targets.map((t) => t.id)).toEqual(['windows-x64'])
  })

  test('resolves an explicit list', () => {
    const result = resolveTargets(['darwin-arm64', 'linux-x64'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.targets.map((t) => t.id)).toEqual(['darwin-arm64', 'linux-x64'])
  })

  test('reports unknown ids', () => {
    const result = resolveTargets(['darwin-arm64', 'made-up'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        code: 'TARGET_UNKNOWN',
        message: `target 'made-up' is not a known Bun compile target`,
        details: { id: 'made-up' },
      },
    ])
  })

  test('reports duplicates', () => {
    const result = resolveTargets(['darwin-arm64', 'darwin-arm64'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([
      {
        code: 'TARGET_DUPLICATE',
        message: `target 'darwin-arm64' appeared more than once in the selection`,
        details: { id: 'darwin-arm64' },
      },
    ])
  })

  test('reports an empty selection', () => {
    const result = resolveTargets([])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures[0]?.code).toBe('TARGET_PRESET_EMPTY')
  })
})
